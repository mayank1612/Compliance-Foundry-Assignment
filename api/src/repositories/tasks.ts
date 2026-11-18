/**
 * tasks.ts — every SQL query the Task Board needs, in one place.
 *
 * Who calls it: the GraphQL resolvers (graphql/resolvers.ts) and loaders
 * (graphql/loaders.ts), always with the operation's transaction — so every query
 * here runs as `app_user` under row-level security; tenant isolation never depends
 * on remembering a WHERE clause.
 *
 * Table aliases used throughout: t = tasks, p = projects, s = organization_settings
 * (s supplies the organization's time zone, i.e. what "today" — and so "overdue" —
 * means), col = task_statuses when paging board columns.
 */
import { generateKeyBetween } from 'fractional-indexing';
import { sql, type RawBuilder, type SqlBool, type Transaction } from 'kysely';
import type { DB, OrganizationRole, TaskPriority } from '../db/types.js';
import { apiError, notFound } from '../graphql/errors.js';
import type { AssigneeCountModel, TaskModel, TaskSummaryModel } from '../graphql/models.js';
import type { TaskFilter, TaskListArgs, TaskOrder } from '../graphql/validation.js';
import { decodeCursor, encodeCursor, toPage, type Cursor, type Page } from './pagination.js';

type Db = Transaction<DB>;

// -----------------------------------------------------------------------------
// Reusable SQL fragments
// -----------------------------------------------------------------------------

/** `t.<column>` — camelCase here, rewritten to snake_case by Kysely's CamelCasePlugin. */
const tCol = (column: string) => sql.ref(`t.${column}`);

/** Today's date in the task's organization's time zone. */
const TODAY = sql`(now() AT TIME ZONE ${sql.ref('s.timezone')})::date`;

/** Open = not completed/canceled. Same text as tasks_open_assigned_due_idx's predicate. */
const IS_OPEN = sql<SqlBool>`${tCol('statusCategory')} NOT IN ('completed', 'canceled')`;

/** Overdue = open and due before today (NULL when there's no due date). */
const IS_OVERDUE = sql<SqlBool>`(${tCol('dueDate')} < ${TODAY} AND ${IS_OPEN})`;

/** Computed fields that would otherwise cost a lookup per card (finding N1). */
const IDENTIFIER = sql<string>`${sql.ref('p.key')} || '-' || ${tCol('number')}`;
const IS_OVERDUE_FLAG = sql<boolean>`coalesce(${IS_OVERDUE}, false)`;

// -----------------------------------------------------------------------------
// Filtering
// -----------------------------------------------------------------------------

/**
 * TaskFilter → WHERE conditions (AND between fields, OR within a list), as the
 * schema documents. Lists are sent as ONE array parameter (`= ANY($1::uuid[])`),
 * so the SQL text — and Postgres's cached plan — doesn't change with list length.
 */
export function filterConditions(filter: TaskFilter): RawBuilder<SqlBool>[] {
  if (!filter) return [];
  const conditions: RawBuilder<SqlBool>[] = [];

  if (filter.statusIds?.length) {
    conditions.push(sql`${tCol('statusId')} = ANY(${filter.statusIds}::uuid[])`);
  }
  if (filter.statusCategories?.length) {
    conditions.push(
      sql`${tCol('statusCategory')} = ANY(${filter.statusCategories}::status_category[])`,
    );
  }

  const assigneeIds = filter.assigneeIds ?? [];
  if (assigneeIds.length > 0 && filter.includeUnassigned) {
    conditions.push(
      sql`(${tCol('assigneeId')} = ANY(${assigneeIds}::uuid[]) OR ${tCol('assigneeId')} IS NULL)`,
    );
  } else if (assigneeIds.length > 0) {
    conditions.push(sql`${tCol('assigneeId')} = ANY(${assigneeIds}::uuid[])`);
  } else if (filter.includeUnassigned) {
    conditions.push(sql`${tCol('assigneeId')} IS NULL`);
  }

  if (filter.priorities?.length) {
    conditions.push(sql`${tCol('priority')} = ANY(${filter.priorities}::task_priority[])`);
  }
  if (filter.labelIds?.length) {
    // A semi-join: the planner picks its direction from the label's statistics
    // (verified in Task 1.2: rare label 20 buffers, common label 269).
    conditions.push(sql`EXISTS (
      SELECT 1 FROM task_labels tl
       WHERE tl.task_id = ${tCol('id')} AND tl.label_id = ANY(${filter.labelIds}::uuid[]))`);
  }
  if (filter.dueDate?.from)
    conditions.push(sql`${tCol('dueDate')} >= ${filter.dueDate.from}::date`);
  if (filter.dueDate?.to) conditions.push(sql`${tCol('dueDate')} <= ${filter.dueDate.to}::date`);
  if (filter.overdue === true) conditions.push(IS_OVERDUE);
  if (filter.overdue === false) conditions.push(sql`NOT ${IS_OVERDUE_FLAG}`);

  return conditions;
}

// -----------------------------------------------------------------------------
// Sorting + keyset pagination
// -----------------------------------------------------------------------------

interface SortSpec {
  column: 'rank' | 'priority' | 'dueDate' | 'number';
  /** Only due_date can be NULL; NULLs always sort last. */
  nullable: boolean;
  /** Postgres type of the cursor value, so `$1` compares correctly (enum order, dates). */
  cast: 'text' | 'task_priority' | 'date' | 'int4';
  direction: 'asc' | 'desc';
}

const SORT_COLUMNS: Record<NonNullable<TaskOrder>['field'], Omit<SortSpec, 'direction'>> = {
  RANK: { column: 'rank', nullable: false, cast: 'text' },
  PRIORITY: { column: 'priority', nullable: false, cast: 'task_priority' },
  DUE_DATE: { column: 'dueDate', nullable: true, cast: 'date' },
  // Finding S1: nothing indexes created_at, but task numbers are handed out in
  // creation order and (project_id, number) IS indexed — so "newest first" is
  // served from the number. It also keeps timestamps out of cursors.
  CREATED_AT: { column: 'number', nullable: false, cast: 'int4' },
  NUMBER: { column: 'number', nullable: false, cast: 'int4' },
};

export function sortSpec(order: TaskOrder, fallback: NonNullable<TaskOrder>): SortSpec {
  const { field, direction } = order ?? fallback;
  return { ...SORT_COLUMNS[field], direction: direction === 'ASC' ? 'asc' : 'desc' };
}

/**
 * ORDER BY key, then id as the unique tie-breaker. NULLS LAST only for the nullable
 * key: on NOT NULL columns it would stop a DESC sort from using an index backwards.
 */
function orderExpressions(spec: SortSpec): RawBuilder<unknown>[] {
  const direction = sql.raw(spec.direction);
  const nulls = sql.raw(spec.nullable ? ' NULLS LAST' : '');
  return [sql`${tCol(spec.column)} ${direction}${nulls}`, sql`${tCol('id')} ${direction}`];
}

/** "Rows after the cursor" in the sort order, including the NULLS LAST tail. */
function keysetCondition(spec: SortSpec, cursor: Cursor): RawBuilder<SqlBool> {
  const expectedType = spec.cast === 'int4' ? 'number' : 'string';
  if (cursor.value !== null && typeof cursor.value !== expectedType) {
    throw apiError('BAD_USER_INPUT', 'Cursor does not match the requested sort order');
  }
  if (cursor.value === null && !spec.nullable) {
    throw apiError('BAD_USER_INPUT', 'Cursor does not match the requested sort order');
  }

  const key = tCol(spec.column);
  const id = tCol('id');
  const after = sql.raw(spec.direction === 'asc' ? '>' : '<');
  const cursorId = sql`${cursor.id}::uuid`;

  // Inside the NULL tail, only the id decides.
  if (cursor.value === null) return sql`(${key} IS NULL AND ${id} ${after} ${cursorId})`;

  const value = sql`${cursor.value}::${sql.raw(spec.cast)}`;
  if (!spec.nullable) {
    // A row comparison is an index condition on (…, key, id) — verified to stay one
    // under row-level security in Task 1.3 (critique finding S2, refuted).
    return sql`(${key}, ${id}) ${after} (${value}, ${cursorId})`;
  }
  return sql`(${key} ${after} ${value} OR (${key} = ${value} AND ${id} ${after} ${cursorId}) OR ${key} IS NULL)`;
}

/** The cursor for a row, from the same column it is sorted by. */
export function cursorFor(spec: SortSpec) {
  return (task: TaskModel) => encodeCursor(task[spec.column], task.id);
}

// -----------------------------------------------------------------------------
// Task lists
// -----------------------------------------------------------------------------

/** Live tasks with their computed fields; every list starts here. */
function tasksBase(db: Db) {
  return db
    .selectFrom('tasks as t')
    .innerJoin('projects as p', 'p.id', 't.projectId')
    .innerJoin('organizationSettings as s', 's.organizationId', 't.organizationId')
    .selectAll('t')
    .select([IDENTIFIER.as('identifier'), IS_OVERDUE_FLAG.as('isOverdue')])
    .where('t.deletedAt', 'is', null);
}

async function runPage(
  query: ReturnType<typeof tasksBase>,
  spec: SortSpec,
  args: TaskListArgs,
): Promise<Page<TaskModel>> {
  let q = query;
  for (const condition of filterConditions(args.filter)) q = q.where(condition);
  if (args.after) q = q.where(keysetCondition(spec, decodeCursor(args.after)));
  for (const expression of orderExpressions(spec)) q = q.orderBy(expression);
  return toPage(await q.limit(args.first + 1).execute(), args.first);
}

/** `Project.tasks` — default order: newest first. */
export const PROJECT_DEFAULT_ORDER = { field: 'CREATED_AT', direction: 'DESC' } as const;
export function listProjectTasks(db: Db, projectId: string, args: TaskListArgs, spec: SortSpec) {
  return runPage(tasksBase(db).where('t.projectId', '=', projectId), spec, args);
}

/**
 * `Query.myTasks` — the viewer's tasks across projects and organizations. With
 * `overdue: true` the query matches tasks_open_assigned_due_idx (Task 1.2 §2.1).
 */
export const MY_TASKS_DEFAULT_ORDER = { field: 'DUE_DATE', direction: 'ASC' } as const;
export function listAssignedTasks(
  db: Db,
  viewerId: string,
  organizationId: string | null,
  args: TaskListArgs,
  spec: SortSpec,
) {
  let query = tasksBase(db).where('t.assigneeId', '=', viewerId);
  if (organizationId) query = query.where('t.organizationId', '=', organizationId);
  return runPage(query, spec, args);
}

/** One task with its computed fields (null if missing, deleted or not visible). */
export async function getTask(db: Db, id: string): Promise<TaskModel | null> {
  return (await tasksBase(db).where('t.id', '=', id).executeTakeFirst()) ?? null;
}

/**
 * `TaskStatus.tasks` for MANY columns in ONE query (findings N1/N2). A plain
 * `WHERE status_id = ANY(…)` can't apply "first N per column"; LATERAL runs the
 * limited, ordered page query once per column — each one a short range scan of
 * tasks_board_idx — inside a single round trip.
 */
export const COLUMN_DEFAULT_ORDER = { field: 'RANK', direction: 'ASC' } as const;
export async function columnPages(
  db: Db,
  statusIds: readonly string[],
  args: TaskListArgs,
  spec: SortSpec,
): Promise<Map<string, Page<TaskModel>>> {
  const cursor = args.after ? decodeCursor(args.after) : null;

  let query = db
    .selectFrom('taskStatuses as col')
    .innerJoin('projects as p', 'p.id', 'col.projectId')
    .innerJoin('organizationSettings as s', 's.organizationId', 'p.organizationId')
    .innerJoinLateral(
      (eb) => {
        let page = eb
          .selectFrom('tasks as t')
          .selectAll('t')
          .whereRef('t.projectId', '=', 'col.projectId')
          .whereRef('t.statusId', '=', 'col.id')
          .where('t.deletedAt', 'is', null);
        for (const condition of filterConditions(args.filter)) page = page.where(condition);
        if (cursor) page = page.where(keysetCondition(spec, cursor));
        for (const expression of orderExpressions(spec)) page = page.orderBy(expression);
        return page.limit(args.first + 1).as('t');
      },
      (join) => join.onTrue(),
    )
    .select('col.id as columnId')
    .selectAll('t')
    .select([IDENTIFIER.as('identifier'), IS_OVERDUE_FLAG.as('isOverdue')])
    .where('col.id', 'in', [...statusIds])
    .orderBy('col.id');
  for (const expression of orderExpressions(spec)) query = query.orderBy(expression);

  const byColumn = new Map<string, TaskModel[]>();
  for (const { columnId, ...task } of await query.execute()) {
    const rows = byColumn.get(columnId) ?? [];
    rows.push(task);
    byColumn.set(columnId, rows);
  }
  return new Map(statusIds.map((id) => [id, toPage(byColumn.get(id) ?? [], args.first)]));
}

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high', 'urgent'];

/** GROUPING(status, priority, assignee) bitmask → which breakdown a row belongs to. */
const GROUPING = { total: 7, byStatus: 3, byPriority: 5, byAssignee: 6 } as const;
const TOP_ASSIGNEES = 50;

/**
 * `Project.taskSummary` in ONE scan: GROUPING SETS computes the total and the
 * by-status, by-priority and by-assignee breakdowns together (Task 1.2 §2.3).
 * Zero counts are filled in, so charts always show every status and priority.
 */
export async function taskSummary(
  db: Db,
  projectId: string,
  statusIdsInOrder: string[],
  filter: TaskFilter,
): Promise<TaskSummaryModel> {
  let query = db
    .selectFrom('tasks as t')
    .innerJoin('organizationSettings as s', 's.organizationId', 't.organizationId')
    .where('t.projectId', '=', projectId)
    .where('t.deletedAt', 'is', null);
  for (const condition of filterConditions(filter)) query = query.where(condition);

  const rows = await query
    .select([
      sql<number>`grouping(${tCol('statusId')}, ${tCol('priority')}, ${tCol('assigneeId')})`.as(
        'groupingSet',
      ),
      't.statusId',
      't.priority',
      't.assigneeId',
      sql<number>`count(*)::int`.as('tasks'),
      sql<number>`(count(*) FILTER (WHERE ${IS_OVERDUE}))::int`.as('overdue'),
    ])
    .groupBy(
      sql`GROUPING SETS ((), (${tCol('statusId')}), (${tCol('priority')}), (${tCol('assigneeId')}))`,
    )
    .execute();

  const total = rows.find((row) => row.groupingSet === GROUPING.total);
  const countWhere = (set: number, match: (row: (typeof rows)[number]) => boolean) =>
    rows.find((row) => row.groupingSet === set && match(row))?.tasks ?? 0;

  const byAssignee: AssigneeCountModel[] = rows
    .filter((row) => row.groupingSet === GROUPING.byAssignee)
    .map((row) => ({ assigneeId: row.assigneeId, count: row.tasks }))
    .sort(
      (a, b) => b.count - a.count || Number(a.assigneeId === null) - Number(b.assigneeId === null),
    )
    .slice(0, TOP_ASSIGNEES);

  return {
    total: total?.tasks ?? 0,
    overdue: total?.overdue ?? 0,
    byStatus: statusIdsInOrder.map((statusId) => ({
      statusId,
      count: countWhere(GROUPING.byStatus, (row) => row.statusId === statusId),
    })),
    byPriority: PRIORITIES.map((priority) => ({
      priority,
      count: countWhere(GROUPING.byPriority, (row) => row.priority === priority),
    })),
    byAssignee,
  };
}

// -----------------------------------------------------------------------------
// moveTask
// -----------------------------------------------------------------------------

const ROLE_ORDER: OrganizationRole[] = ['viewer', 'member', 'admin', 'owner'];

export interface MoveTaskInput {
  id: string;
  statusId: string;
  afterTaskId?: string | null | undefined;
  beforeTaskId?: string | null | undefined;
}

interface Column {
  projectId: string;
  statusId: string;
  /** The card being moved — excluded from neighbour lookups. */
  movingId: string;
}

/** Rank of a neighbour card that must sit in the target column (else the board is stale). */
async function rankOf(db: Db, column: Column, taskId: string): Promise<string> {
  const row = await db
    .selectFrom('tasks')
    .select('rank')
    .where('id', '=', taskId)
    .where('projectId', '=', column.projectId)
    .where('statusId', '=', column.statusId)
    .where('deletedAt', 'is', null)
    .where('id', '<>', column.movingId)
    .executeTakeFirst();
  if (!row) {
    throw apiError('CONFLICT', 'A neighbouring card moved or left that column; reload the board');
  }
  return row.rank;
}

/** The nearest rank strictly above (`next`) or below (`previous`) the pivot. */
async function adjacentRank(
  db: Db,
  column: Column,
  direction: 'next' | 'previous',
  pivot: string | null,
): Promise<string | null> {
  let query = db
    .selectFrom('tasks')
    .select('rank')
    .where('projectId', '=', column.projectId)
    .where('statusId', '=', column.statusId)
    .where('deletedAt', 'is', null)
    .where('id', '<>', column.movingId);
  if (direction === 'next') {
    if (pivot !== null) query = query.where('rank', '>', pivot);
    query = query.orderBy(sql`rank ASC`);
  } else {
    if (pivot !== null) query = query.where('rank', '<', pivot);
    query = query.orderBy(sql`rank DESC`);
  }
  return (await query.limit(1).executeTakeFirst())?.rank ?? null;
}

/**
 * Board drag-and-drop. Validates visibility, role, archive state and the target
 * column, then computes a fractional rank between the neighbours and moves the
 * card — status change and new position in one UPDATE (history records the status
 * change; rank-only moves are not history by design).
 */
export async function moveTask(db: Db, viewerId: string, input: MoveTaskInput): Promise<TaskModel> {
  const task = await db
    .selectFrom('tasks as t')
    .innerJoin('projects as p', 'p.id', 't.projectId')
    .select(['t.id', 't.projectId', 't.organizationId', 't.statusId', 'p.archivedAt'])
    .where('t.id', '=', input.id)
    .where('t.deletedAt', 'is', null)
    .executeTakeFirst();
  if (!task) throw notFound('Task'); // missing, deleted, or another tenant's — indistinguishable

  // A clear FORBIDDEN instead of RLS's silent "0 rows updated" for viewers.
  const membership = await db
    .selectFrom('organizationMembers')
    .select('role')
    .where('organizationId', '=', task.organizationId)
    .where('userId', '=', viewerId)
    .executeTakeFirst();
  if (!membership || ROLE_ORDER.indexOf(membership.role) < ROLE_ORDER.indexOf('member')) {
    throw apiError('FORBIDDEN', 'Viewers cannot move tasks');
  }
  // Finding SEC4a (archived projects are writable at the database level) is enforced here.
  if (task.archivedAt) throw apiError('FORBIDDEN', 'Archived projects are read-only');

  const target = await db
    .selectFrom('taskStatuses')
    .select('id')
    .where('id', '=', input.statusId)
    .where('projectId', '=', task.projectId)
    .executeTakeFirst();
  if (!target) throw apiError('BAD_USER_INPUT', "statusId is not a column of this task's project");

  // Finding C3: two drops into the same gap must not compute the same key. One
  // rank computation at a time per column; the lock is released at commit/rollback.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.statusId}, 0))`.execute(db);

  const column: Column = { projectId: task.projectId, statusId: input.statusId, movingId: task.id };
  let lower: string | null;
  let upper: string | null;
  if (input.afterTaskId && input.beforeTaskId) {
    lower = await rankOf(db, column, input.afterTaskId);
    upper = await rankOf(db, column, input.beforeTaskId);
    if (!(lower < upper)) throw apiError('CONFLICT', 'The board changed; reload and try again');
  } else if (input.afterTaskId) {
    lower = await rankOf(db, column, input.afterTaskId);
    upper = await adjacentRank(db, column, 'next', lower);
  } else if (input.beforeTaskId) {
    upper = await rankOf(db, column, input.beforeTaskId);
    lower = await adjacentRank(db, column, 'previous', upper);
  } else {
    lower = await adjacentRank(db, column, 'previous', null); // end of the column
    upper = null;
  }
  const rank = generateKeyBetween(lower, upper);

  // Only write status_id when it changes: listing it would fire the status trigger
  // (a share lock on the status row) for a pure reorder.
  const changes = input.statusId === task.statusId ? { rank } : { rank, statusId: input.statusId };
  const result = await db
    .updateTable('tasks')
    .set(changes)
    .where('id', '=', task.id)
    .executeTakeFirst();
  if (result.numUpdatedRows === 0n) throw apiError('FORBIDDEN', 'Not allowed to move this task');

  const moved = await getTask(db, task.id);
  if (!moved) throw notFound('Task');
  return moved;
}
