/**
 * loaders.ts — per-operation DataLoaders: the cure for N+1 (critique finding N1).
 *
 * What: each loader collects every `.load(key)` made while resolving one tick of a
 *       GraphQL operation and answers them with ONE query (`WHERE id = ANY(…)`).
 *       A board of 6 columns × 50 cards resolves assignees with 1 query, not 300.
 * Why per operation: loaders cache what they load. They are created with the
 *       operation's transaction (row-level security already applied for this
 *       viewer), so a cache shared across requests would serve one user's rows to
 *       another — a cross-tenant leak. Created in transaction-plugin.ts, discarded
 *       when the operation ends.
 */
import DataLoader from 'dataloader';
import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import { columnPages, COLUMN_DEFAULT_ORDER, sortSpec } from '../repositories/tasks.js';
import type { Page } from '../repositories/pagination.js';
import type {
  LabelModel,
  OrganizationMemberModel,
  OrganizationModel,
  OrganizationSettingsModel,
  ProjectModel,
  TaskModel,
  TaskStatusModel,
  UserModel,
} from './models.js';
import type { TaskListArgs } from './validation.js';

/** DataLoader contract: results in the same order as keys; missing → null. */
function byId<T extends { id: string }>(load: (ids: string[]) => Promise<T[]>) {
  return new DataLoader<string, T | null>(async (ids) => {
    const rows = await load([...ids]);
    const found = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => found.get(id) ?? null);
  });
}

/** One-to-many: every key gets a (possibly empty) list, in query order. */
function groupedBy<T>(load: (keys: string[]) => Promise<(T & { groupKey: string })[]>) {
  return new DataLoader<string, T[]>(async (keys) => {
    const groups = new Map<string, T[]>(keys.map((key) => [key, []]));
    for (const { groupKey, ...row } of await load([...keys])) {
      groups.get(groupKey)?.push(row as T);
    }
    return keys.map((key) => groups.get(key) ?? []);
  });
}

/** Key for one board column page: the column plus the arguments of that page. */
export interface ColumnPageKey {
  statusId: string;
  args: TaskListArgs;
}

export function createLoaders(db: Transaction<DB>, viewerId: string | null) {
  return {
    user: byId<UserModel>((ids) =>
      db.selectFrom('users').selectAll().where('id', 'in', ids).execute(),
    ),

    organization: byId<OrganizationModel>((ids) =>
      db.selectFrom('organizations').selectAll().where('id', 'in', ids).execute(),
    ),

    project: byId<ProjectModel>((ids) =>
      db.selectFrom('projects').selectAll().where('id', 'in', ids).execute(),
    ),

    status: byId<TaskStatusModel>((ids) =>
      db.selectFrom('taskStatuses').selectAll().where('id', 'in', ids).execute(),
    ),

    /** A project's board columns, in display order. */
    statusesByProject: groupedBy<TaskStatusModel>((projectIds) =>
      db
        .selectFrom('taskStatuses')
        .selectAll()
        .select('projectId as groupKey')
        .where('projectId', 'in', projectIds)
        .orderBy('position')
        .orderBy('id')
        .execute(),
    ),

    /** A task's labels, alphabetically. */
    labelsByTask: groupedBy<LabelModel>((taskIds) =>
      db
        .selectFrom('taskLabels as tl')
        .innerJoin('labels as l', 'l.id', 'tl.labelId')
        .selectAll('l')
        .select('tl.taskId as groupKey')
        .where('tl.taskId', 'in', taskIds)
        .orderBy('l.name')
        .execute(),
    ),

    settings: new DataLoader<string, OrganizationSettingsModel | null>(async (organizationIds) => {
      const rows = await db
        .selectFrom('organizationSettings')
        .selectAll()
        .where('organizationId', 'in', [...organizationIds])
        .execute();
      const found = new Map(rows.map((row) => [row.organizationId, row]));
      return organizationIds.map((id) => found.get(id) ?? null);
    }),

    /** The viewer's own membership per organization (for `viewerRole`). */
    viewerMembership: new DataLoader<string, OrganizationMemberModel | null>(
      async (organizationIds) => {
        if (!viewerId) return organizationIds.map(() => null);
        const rows = await db
          .selectFrom('organizationMembers')
          .selectAll()
          .where('userId', '=', viewerId)
          .where('organizationId', 'in', [...organizationIds])
          .execute();
        const found = new Map(rows.map((row) => [row.organizationId, row]));
        return organizationIds.map((id) => found.get(id) ?? null);
      },
    ),

    /**
     * Board columns: every `TaskStatus.tasks` resolved in the same tick is batched
     * into one LATERAL query per distinct argument set (finding N2: the batch key
     * includes filter, order and cursor). A normal board load = ONE query.
     */
    columnTasks: new DataLoader<ColumnPageKey, Page<TaskModel>, string>(
      async (keys) => {
        const groups = new Map<string, ColumnPageKey[]>();
        for (const key of keys) {
          const argsKey = JSON.stringify(key.args);
          groups.set(argsKey, [...(groups.get(argsKey) ?? []), key]);
        }
        const pages = new Map<string, Page<TaskModel>>();
        for (const [argsKey, group] of groups) {
          const args = group[0]?.args;
          if (!args) continue; // groups are created with one key, so never empty
          const spec = sortSpec(args.orderBy, COLUMN_DEFAULT_ORDER);
          const result = await columnPages(
            db,
            group.map((key) => key.statusId),
            args,
            spec,
          );
          for (const [statusId, page] of result) pages.set(`${statusId}|${argsKey}`, page);
        }
        return keys.map(
          (key) =>
            pages.get(`${key.statusId}|${JSON.stringify(key.args)}`) ?? {
              rows: [],
              hasNextPage: false,
            },
        );
      },
      { cacheKeyFn: (key) => `${key.statusId}|${JSON.stringify(key.args)}` },
    ),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
