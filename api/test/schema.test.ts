/**
 * schema.test.ts — proves the v1 schema (api/db/migrations/0001–0005) enforces what
 * the design claims, on a real Postgres 18 (embedded PGlite).
 *
 * Structure:
 *   1. integrity  — constraints, composite FKs and triggers, exercised as the schema
 *                   OWNER (no RLS), so these guarantees hold for ANY writer.
 *   2. activity   — the audit trail records who changed what, and is immutable.
 *   3. access     — row-level security + column grants, exercised as `app_user`
 *                   through withUserContext, exactly like an API request.
 *   4. design SDL — docs/part1/schema.graphql is valid and agrees with Postgres.
 *
 * Fixtures: two tenants. "Acme" has one user per role (+ a second member);
 * "Globex" has an owner who must never see Acme data, and vice versa.
 * Tests that change shared configuration restore it, or use their own organization.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSchema, GraphQLEnumType } from 'graphql';
import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/db/database.js';
import { migrateToLatest } from '../src/db/migrator.js';
import { withUserContext } from '../src/db/request-context.js';
import type { DB, OrganizationRole, TaskPriority } from '../src/db/types.js';
import { API_ROOT } from '../src/paths.js';

// ---------------------------------------------------------------------------
// Fixture helpers (all run as the schema owner, bypassing RLS)
// ---------------------------------------------------------------------------

let database: Database;
let db: Kysely<DB>;

/** Fixture ids, filled in by beforeAll. */
const id = {
  alice: '', // Acme owner
  bob: '', // Acme admin
  carol: '', // Acme member
  mallory: '', // Acme member (a second one, for "not your comment" checks)
  dave: '', // Acme viewer
  erin: '', // Globex owner
  acme: '',
  globex: '',
  web: '', // Acme project
  ops: '', // Globex project
  acmeLabel: '',
  globexLabel: '',
};

async function insertUser(handle: string): Promise<string> {
  const row = await db
    .insertInto('users')
    .values({ email: `${handle}@example.test`, displayName: handle })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertOrganization(
  slug: string,
  members: [userId: string, role: OrganizationRole][],
): Promise<string> {
  const { id: organizationId } = await db
    .insertInto('organizations')
    .values({ name: slug, slug })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('organizationMembers')
    .values(members.map(([userId, role]) => ({ organizationId, userId, role })))
    .execute();
  return organizationId;
}

async function insertProject(organizationId: string, key: string): Promise<string> {
  const row = await db
    .insertInto('projects')
    .values({ organizationId, key, name: `Project ${key}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function statusIdOf(projectId: string, name: string): Promise<string> {
  const row = await db
    .selectFrom('taskStatuses')
    .select('id')
    .where('projectId', '=', projectId)
    .where('name', '=', name)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Run `work` as `userId` under RLS — the same path every API request takes. */
const as = <T>(userId: string | null, work: (trx: Transaction<DB>) => Promise<T>) =>
  withUserContext(db, userId, work);

interface NewTask {
  organizationId: string;
  projectId: string;
  title?: string;
  statusId?: string;
  assigneeId?: string | null;
  priority?: TaskPriority;
  rank?: string;
}

/** Create a task as `userId` (RLS applies). */
const createTaskAs = (userId: string, task: NewTask) =>
  as(userId, (trx) =>
    trx
      .insertInto('tasks')
      .values({ title: 'A task', rank: 'a0', ...task })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );

/** Assert a promise rejects with a Postgres SQLSTATE (and optionally a message). */
async function expectPgError(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, 'expected the database to reject this').toBeInstanceOf(Error);
  expect(error).toMatchObject({ code });
  if (message) expect((error as Error).message).toMatch(message);
}

// Postgres error codes used below (https://www.postgresql.org/docs/current/errcodes-appendix.html)
const PG = {
  insufficientPrivilege: '42501', // permission denied / RLS WITH CHECK violation
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  invalidParameterValue: '22023', // e.g. unknown time zone
} as const;

beforeAll(async () => {
  database = await openDatabase(); // fresh in-memory Postgres for this file
  db = database.db;
  await migrateToLatest(db);

  id.alice = await insertUser('alice');
  id.bob = await insertUser('bob');
  id.carol = await insertUser('carol');
  id.mallory = await insertUser('mallory');
  id.dave = await insertUser('dave');
  id.erin = await insertUser('erin');

  id.acme = await insertOrganization('acme', [
    [id.alice, 'owner'],
    [id.bob, 'admin'],
    [id.carol, 'member'],
    [id.mallory, 'member'],
    [id.dave, 'viewer'],
  ]);
  id.globex = await insertOrganization('globex', [[id.erin, 'owner']]);

  id.web = await insertProject(id.acme, 'WEB');
  id.ops = await insertProject(id.globex, 'OPS');

  id.acmeLabel = (
    await db
      .insertInto('labels')
      .values({ organizationId: id.acme, name: 'bug' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  id.globexLabel = (
    await db
      .insertInto('labels')
      .values({ organizationId: id.globex, name: 'bug' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  // One task per tenant, so isolation tests have something to (not) see.
  await db
    .insertInto('tasks')
    .values([
      { organizationId: id.acme, projectId: id.web, title: 'Acme task', rank: 'a0' },
      { organizationId: id.globex, projectId: id.ops, title: 'Globex task', rank: 'a0' },
    ])
    .execute();
});

afterAll(async () => {
  await database.close();
});

// ---------------------------------------------------------------------------
// 1. Integrity
// ---------------------------------------------------------------------------

describe('integrity: constraints, composite keys, triggers', () => {
  it('gives every organization default settings and rejects unknown time zones', async () => {
    const settings = await db
      .selectFrom('organizationSettings')
      .selectAll()
      .where('organizationId', '=', id.acme)
      .executeTakeFirstOrThrow();
    expect(settings).toMatchObject({
      timezone: 'UTC',
      weekStartsOn: 1,
      membersCanCreateProjects: true,
    });

    await expectPgError(
      db
        .updateTable('organizationSettings')
        .set({ timezone: 'Mars/Olympus' })
        .where('organizationId', '=', id.acme)
        .execute(),
      PG.invalidParameterValue,
      /time zone "Mars\/Olympus" not recognized/,
    );
  });

  it('gives every new project a five-column board whose default status is open', async () => {
    const statuses = await db
      .selectFrom('taskStatuses')
      .select(['name', 'category', 'isDefault'])
      .where('projectId', '=', id.web)
      .orderBy('position')
      .execute();
    expect(statuses.map((s) => s.name)).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'Done',
      'Canceled',
    ]);
    expect(statuses.filter((s) => s.isDefault)).toEqual([
      { name: 'Todo', category: 'unstarted', isDefault: true },
    ]);

    // A completed status can never become the default.
    await expectPgError(
      db
        .updateTable('taskStatuses')
        .set({ isDefault: true })
        .where('id', '=', await statusIdOf(id.web, 'Done'))
        .execute(),
      PG.checkViolation,
    );
  });

  it('numbers tasks per project and applies the default status and author', async () => {
    const projectId = await insertProject(id.acme, 'NUM');
    const first = await createTaskAs(id.carol, { organizationId: id.acme, projectId });
    const second = await createTaskAs(id.carol, { organizationId: id.acme, projectId });

    expect([first.number, second.number]).toEqual([1, 2]);
    expect(first.statusId).toBe(await statusIdOf(projectId, 'Todo'));
    expect(first.statusCategory).toBe('unstarted');
    expect(first.createdBy).toBe(id.carol); // column default = the requesting user
  });

  it('keeps status_category and completed_at in sync with moves and category edits', async () => {
    const projectId = await insertProject(id.acme, 'SYNC');
    const task = await createTaskAs(id.carol, { organizationId: id.acme, projectId });
    const moveTo = async (status: string) =>
      db
        .updateTable('tasks')
        .set({ statusId: await statusIdOf(projectId, status) })
        .where('id', '=', task.id)
        .returning(['statusCategory', 'completedAt'])
        .executeTakeFirstOrThrow();

    const done = await moveTo('Done');
    expect(done.statusCategory).toBe('completed');
    expect(done.completedAt).toBeInstanceOf(Date);

    expect(await moveTo('In Progress')).toEqual({ statusCategory: 'started', completedAt: null });

    // An admin re-categorises "In Progress" as completed: its tasks follow.
    await db
      .updateTable('taskStatuses')
      .set({ category: 'completed' })
      .where('id', '=', await statusIdOf(projectId, 'In Progress'))
      .execute();
    const after = await db
      .selectFrom('tasks')
      .select(['statusCategory', 'completedAt'])
      .where('id', '=', task.id)
      .executeTakeFirstOrThrow();
    expect(after.statusCategory).toBe('completed');
    expect(after.completedAt).toBeInstanceOf(Date);
  });

  it('refuses cross-tenant and cross-project references, even without RLS', async () => {
    const acmeTask = await db
      .selectFrom('tasks')
      .select(['id', 'organizationId'])
      .where('organizationId', '=', id.acme)
      .executeTakeFirstOrThrow();

    // A Globex project inside an Acme task.
    await expectPgError(
      db
        .insertInto('tasks')
        .values({ organizationId: id.acme, projectId: id.ops, title: 'x', rank: 'a0' })
        .execute(),
      PG.foreignKeyViolation,
      /does not exist in organization/,
    );
    // A status belonging to another project.
    await expectPgError(
      db
        .insertInto('tasks')
        .values({
          organizationId: id.acme,
          projectId: id.web,
          statusId: await statusIdOf(id.ops, 'Todo'),
          title: 'x',
          rank: 'a0',
        })
        .execute(),
      PG.foreignKeyViolation,
      /does not belong to project/,
    );
    // An assignee who is not a member of the task's organization.
    await expectPgError(
      db.updateTable('tasks').set({ assigneeId: id.erin }).where('id', '=', acmeTask.id).execute(),
      PG.foreignKeyViolation,
      /tasks_assignee_fk/,
    );
    // Another tenant's label on an Acme task.
    await expectPgError(
      db
        .insertInto('taskLabels')
        .values({ organizationId: id.acme, taskId: acmeTask.id, labelId: id.globexLabel })
        .execute(),
      PG.foreignKeyViolation,
      /task_labels_label_fk/,
    );
  });

  it('unassigns (only) the assignee when their membership ends', async () => {
    const frank = await insertUser('frank');
    await db
      .insertInto('organizationMembers')
      .values({ organizationId: id.acme, userId: frank, role: 'member' })
      .execute();
    const task = await createTaskAs(id.carol, {
      organizationId: id.acme,
      projectId: id.web,
      assigneeId: frank,
    });

    await db
      .deleteFrom('organizationMembers')
      .where('organizationId', '=', id.acme)
      .where('userId', '=', frank)
      .execute();

    const after = await db
      .selectFrom('tasks')
      .select(['assigneeId', 'organizationId'])
      .where('id', '=', task.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual({ assigneeId: null, organizationId: id.acme });
  });

  it('never leaves an organization without an owner, but allows a transfer in one transaction', async () => {
    const initech = await insertOrganization('initech', [
      [id.alice, 'owner'],
      [id.bob, 'admin'],
    ]);
    const setRole = (trx: Kysely<DB>, userId: string, role: OrganizationRole) =>
      trx
        .updateTable('organizationMembers')
        .set({ role })
        .where('organizationId', '=', initech)
        .where('userId', '=', userId)
        .execute();

    await expectPgError(setRole(db, id.alice, 'admin'), PG.checkViolation, /at least one owner/);
    await expectPgError(
      db
        .deleteFrom('organizationMembers')
        .where('organizationId', '=', initech)
        .where('userId', '=', id.alice)
        .execute(),
      PG.checkViolation,
    );

    // Promote-then-demote inside one transaction: checked only at COMMIT → allowed.
    await db.transaction().execute(async (trx) => {
      await setRole(trx, id.bob, 'owner');
      await setRole(trx, id.alice, 'admin');
    });
    const owners = await db
      .selectFrom('organizationMembers')
      .select('userId')
      .where('organizationId', '=', initech)
      .where('role', '=', 'owner')
      .execute();
    expect(owners).toEqual([{ userId: id.bob }]);
  });

  it('refuses new tasks in an archived project', async () => {
    const projectId = await insertProject(id.acme, 'OLD');
    await db
      .updateTable('projects')
      .set({ archivedAt: new Date() })
      .where('id', '=', projectId)
      .execute();
    await expectPgError(
      createTaskAs(id.carol, { organizationId: id.acme, projectId }),
      PG.foreignKeyViolation,
      /archived/,
    );
  });

  it('lets an owner delete an organization, cascading through every table', async () => {
    const doomed = await insertOrganization('doomed', [[id.alice, 'owner']]);
    const projectId = await insertProject(doomed, 'DOOM');
    const labelId = (
      await db
        .insertInto('labels')
        .values({ organizationId: doomed, name: 'x' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const task = await createTaskAs(id.alice, {
      organizationId: doomed,
      projectId,
      assigneeId: id.alice,
    });
    await as(id.alice, async (trx) => {
      await trx
        .insertInto('taskLabels')
        .values({ organizationId: doomed, taskId: task.id, labelId })
        .execute();
      await trx
        .insertInto('taskComments')
        .values({ organizationId: doomed, taskId: task.id, body: 'bye' })
        .execute();
    });

    const deleted = await as(id.alice, (trx) =>
      trx.deleteFrom('organizations').where('id', '=', doomed).executeTakeFirst(),
    );
    expect(deleted.numDeletedRows).toBe(1n);

    const leftovers = await sql<{ table: string; rows: number }>`
      select 'projects' as table, count(*) as rows from projects where organization_id = ${doomed}
      union all select 'task_statuses', count(*) from task_statuses where organization_id = ${doomed}
      union all select 'tasks', count(*) from tasks where organization_id = ${doomed}
      union all select 'task_labels', count(*) from task_labels where organization_id = ${doomed}
      union all select 'task_comments', count(*) from task_comments where organization_id = ${doomed}
      union all select 'task_activities', count(*) from task_activities where organization_id = ${doomed}
      union all select 'organization_members', count(*) from organization_members where organization_id = ${doomed}
      union all select 'organization_settings', count(*) from organization_settings where organization_id = ${doomed}
    `.execute(db);
    expect(leftovers.rows.filter((r) => r.rows > 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Activity history
// ---------------------------------------------------------------------------

describe('activity history', () => {
  it('records who changed what, from what, to what', async () => {
    const task = await createTaskAs(id.carol, { organizationId: id.acme, projectId: id.web });
    const inProgress = await statusIdOf(id.web, 'In Progress');

    await as(id.carol, async (trx) => {
      await trx
        .updateTable('tasks')
        .set({ priority: 'high', assigneeId: id.bob, statusId: inProgress, title: 'Renamed' })
        .where('id', '=', task.id)
        .execute();
      await trx
        .insertInto('taskLabels')
        .values({ organizationId: id.acme, taskId: task.id, labelId: id.acmeLabel })
        .execute();
      await trx.deleteFrom('taskLabels').where('taskId', '=', task.id).execute();
    });

    const activity = await db
      .selectFrom('taskActivities')
      .select(['kind', 'field', 'oldValue', 'newValue', 'actorId'])
      .where('taskId', '=', task.id)
      .orderBy('createdAt')
      .orderBy('id')
      .execute();

    expect(activity.every((a) => a.actorId === id.carol)).toBe(true);
    expect(activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'created' }),
        expect.objectContaining({ field: 'priority', oldValue: 'none', newValue: 'high' }),
        expect.objectContaining({ field: 'assignee', oldValue: null, newValue: id.bob }),
        expect.objectContaining({ field: 'title', oldValue: 'A task', newValue: 'Renamed' }),
        expect.objectContaining({
          field: 'status',
          oldValue: expect.objectContaining({ name: 'Todo', category: 'unstarted' }) as unknown,
          newValue: expect.objectContaining({
            name: 'In Progress',
            category: 'started',
          }) as unknown,
        }),
        expect.objectContaining({
          kind: 'label_added',
          newValue: expect.objectContaining({ name: 'bug' }) as unknown,
        }),
        expect.objectContaining({
          kind: 'label_removed',
          oldValue: expect.objectContaining({ name: 'bug' }) as unknown,
        }),
      ]),
    );
    expect(activity).toHaveLength(7);
  });

  it('does not record card reordering (rank-only updates)', async () => {
    const task = await createTaskAs(id.carol, { organizationId: id.acme, projectId: id.web });
    await as(id.carol, (trx) =>
      trx.updateTable('tasks').set({ rank: 'a5' }).where('id', '=', task.id).execute(),
    );
    const kinds = await db
      .selectFrom('taskActivities')
      .select('kind')
      .where('taskId', '=', task.id)
      .execute();
    expect(kinds).toEqual([{ kind: 'created' }]);
  });

  it('is append-only: the API role cannot write or rewrite history', async () => {
    const task = await createTaskAs(id.carol, { organizationId: id.acme, projectId: id.web });
    await expectPgError(
      as(id.carol, (trx) =>
        trx
          .insertInto('taskActivities')
          .values({ organizationId: id.acme, taskId: task.id, kind: 'created' })
          .execute(),
      ),
      PG.insufficientPrivilege,
    );
    await expectPgError(
      as(id.carol, (trx) =>
        trx
          .updateTable('taskActivities')
          .set({ actorId: null })
          .where('taskId', '=', task.id)
          .execute(),
      ),
      PG.insufficientPrivilege,
    );
    await expectPgError(
      as(id.carol, (trx) =>
        trx.deleteFrom('taskActivities').where('taskId', '=', task.id).execute(),
      ),
      PG.insufficientPrivilege,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Access control (RLS + grants), as app_user
// ---------------------------------------------------------------------------

describe('access control: tenant isolation and roles', () => {
  it("shows each user only their own organizations' data", async () => {
    const visibleTo = (userId: string) =>
      as(userId, async (trx) => ({
        taskOrgs: [
          ...new Set(
            (await trx.selectFrom('tasks').select('organizationId').execute()).map(
              (t) => t.organizationId,
            ),
          ),
        ],
        users: (await trx.selectFrom('users').select('displayName').execute())
          .map((u) => u.displayName)
          .sort(),
      }));

    const erin = await visibleTo(id.erin);
    expect(erin.taskOrgs).toEqual([id.globex]);
    expect(erin.users).toEqual(['erin']); // nobody from Acme

    const carol = await visibleTo(id.carol);
    expect(carol.taskOrgs).toEqual([id.acme]);
    expect(carol.users).not.toContain('erin');
    expect(carol.users).toEqual(expect.arrayContaining(['alice', 'bob', 'carol', 'dave']));
  });

  it('shows anonymous callers nothing (fails closed)', async () => {
    const seen = await as(null, async (trx) => ({
      tasks: await trx.selectFrom('tasks').select('id').execute(),
      organizations: await trx.selectFrom('organizations').select('id').execute(),
    }));
    expect(seen).toEqual({ tasks: [], organizations: [] });
  });

  it('lets viewers read but not write', async () => {
    const visible = await as(id.dave, (trx) =>
      trx.selectFrom('tasks').select('id').where('organizationId', '=', id.acme).execute(),
    );
    expect(visible.length).toBeGreaterThan(0);

    await expectPgError(
      createTaskAs(id.dave, { organizationId: id.acme, projectId: id.web }),
      PG.insufficientPrivilege,
      /row-level security/,
    );
    // UPDATE on a visible-but-not-writable row is silently skipped (0 rows);
    // the API maps that to FORBIDDEN.
    const updated = await as(id.dave, (trx) =>
      trx
        .updateTable('tasks')
        .set({ title: 'hijacked' })
        .where('organizationId', '=', id.acme)
        .executeTakeFirst(),
    );
    expect(updated.numUpdatedRows).toBe(0n);
  });

  it('never lets the API move a task to another organization or fake its author', async () => {
    const task = await createTaskAs(id.carol, { organizationId: id.acme, projectId: id.web });
    // organization_id / created_by are simply not granted for UPDATE.
    await expectPgError(
      as(id.carol, (trx) =>
        trx
          .updateTable('tasks')
          .set({ organizationId: id.globex })
          .where('id', '=', task.id)
          .execute(),
      ),
      PG.insufficientPrivilege,
    );
    await expectPgError(
      as(id.carol, (trx) =>
        trx.updateTable('tasks').set({ createdBy: id.alice }).where('id', '=', task.id).execute(),
      ),
      PG.insufficientPrivilege,
    );
    // …and a member cannot write into a tenant they don't belong to.
    await expectPgError(
      createTaskAs(id.carol, { organizationId: id.globex, projectId: id.ops }),
      PG.foreignKeyViolation, // the Globex status is invisible to carol → rejected
    );
  });

  it('lets admins manage members, but only owners manage owners', async () => {
    const roleOf = async (userId: string) =>
      (
        await db
          .selectFrom('organizationMembers')
          .select('role')
          .where('organizationId', '=', id.acme)
          .where('userId', '=', userId)
          .executeTakeFirstOrThrow()
      ).role;
    const setRoleAs = (actor: string, userId: string, role: OrganizationRole) =>
      as(actor, (trx) =>
        trx
          .updateTable('organizationMembers')
          .set({ role })
          .where('organizationId', '=', id.acme)
          .where('userId', '=', userId)
          .executeTakeFirst(),
      );

    // bob (admin) cannot touch the owner's row…
    expect((await setRoleAs(id.bob, id.alice, 'viewer')).numUpdatedRows).toBe(0n);
    expect(await roleOf(id.alice)).toBe('owner');
    // …nor promote anyone to owner…
    await expectPgError(setRoleAs(id.bob, id.carol, 'owner'), PG.insufficientPrivilege);
    // …but may change non-owner roles.
    try {
      expect((await setRoleAs(id.bob, id.carol, 'viewer')).numUpdatedRows).toBe(1n);
      expect(await roleOf(id.carol)).toBe('viewer');
    } finally {
      await setRoleAs(id.alice, id.carol, 'member'); // restore the fixture
    }
    // A member cannot change roles at all.
    expect((await setRoleAs(id.carol, id.dave, 'admin')).numUpdatedRows).toBe(0n);
  });

  it('lets members create projects only while the organization allows it', async () => {
    const createProjectAs = (userId: string, key: string) =>
      as(userId, (trx) =>
        trx
          .insertInto('projects')
          .values({ organizationId: id.acme, key, name: key })
          .returning('createdBy')
          .executeTakeFirstOrThrow(),
      );
    const allowMembers = (allowed: boolean) =>
      as(id.bob, (trx) =>
        trx
          .updateTable('organizationSettings')
          .set({ membersCanCreateProjects: allowed })
          .where('organizationId', '=', id.acme)
          .execute(),
      );

    expect(await createProjectAs(id.carol, 'MEM')).toEqual({ createdBy: id.carol });
    try {
      await allowMembers(false);
      await expectPgError(createProjectAs(id.carol, 'NOPE'), PG.insufficientPrivilege);
      expect(await createProjectAs(id.bob, 'ADM')).toEqual({ createdBy: id.bob }); // admins still can
    } finally {
      await allowMembers(true);
    }
  });

  it('lets authors edit their own comments and admins moderate', async () => {
    const task = await createTaskAs(id.carol, { organizationId: id.acme, projectId: id.web });
    const comment = await as(id.carol, (trx) =>
      trx
        .insertInto('taskComments')
        .values({ organizationId: id.acme, taskId: task.id, body: 'First!' })
        .returning(['id', 'authorId', 'editedAt'])
        .executeTakeFirstOrThrow(),
    );
    expect(comment).toMatchObject({ authorId: id.carol, editedAt: null });

    const editAs = (userId: string, body: string) =>
      as(userId, (trx) =>
        trx
          .updateTable('taskComments')
          .set({ body })
          .where('id', '=', comment.id)
          .executeTakeFirst(),
      );
    expect((await editAs(id.mallory, 'not yours')).numUpdatedRows).toBe(0n);
    expect((await editAs(id.carol, 'First! (edited)')).numUpdatedRows).toBe(1n);

    const moderated = await as(id.bob, (trx) =>
      trx
        .updateTable('taskComments')
        .set({ deletedAt: new Date() })
        .where('id', '=', comment.id)
        .returning(['body', 'editedAt'])
        .executeTakeFirstOrThrow(),
    );
    expect(moderated.body).toBe('First! (edited)');
    expect(moderated.editedAt).toBeInstanceOf(Date);
  });

  it('has row-level security enabled on every table (guards future migrations)', async () => {
    const unprotected = await sql<{ table: string }>`
      select c.relname as table
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and not c.relrowsecurity
         and c.relname not like 'kysely_migration%'`.execute(db);
    expect(unprotected.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. GraphQL design schema
// ---------------------------------------------------------------------------

describe('GraphQL design schema (docs/part1/schema.graphql)', () => {
  const sdlPath = resolve(API_ROOT, '..', 'docs', 'part1', 'schema.graphql');

  it('is a valid GraphQL schema', async () => {
    const schema = buildSchema(await readFile(sdlPath, 'utf8'));
    expect(schema.getQueryType()?.name).toBe('Query');
  });

  it('declares the same enum values as Postgres (API ↔ database contract)', async () => {
    const schema = buildSchema(await readFile(sdlPath, 'utf8'));
    const pairs = [
      ['OrganizationRole', 'organization_role'],
      ['TaskPriority', 'task_priority'],
      ['StatusCategory', 'status_category'],
    ] as const;

    for (const [graphqlName, postgresName] of pairs) {
      const type = schema.getType(graphqlName);
      expect(type).toBeInstanceOf(GraphQLEnumType);
      const graphqlValues = (type as GraphQLEnumType).getValues().map((v) => v.name.toLowerCase());
      // enum_range lists values in declaration order — order matters (role ranking, sort order).
      const { rows } = await sql<{ value: string }>`
        select unnest(enum_range(null::${sql.raw(postgresName)}))::text as value`.execute(db);
      expect(graphqlValues, graphqlName).toEqual(rows.map((r) => r.value));
    }
  });
});
