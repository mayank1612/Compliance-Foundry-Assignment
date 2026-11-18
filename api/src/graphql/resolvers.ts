/**
 * resolvers.ts — maps every field of schema.graphql to data.
 *
 * Pattern:
 *   * Root fields (Query/Mutation) validate their arguments (zod, validation.ts),
 *     then call the repository (repositories/tasks.ts) — all SQL lives there.
 *   * Relation fields (Task.assignee, Task.labels, …) go through per-operation
 *     DataLoaders (loaders.ts), so a page of N cards costs a constant number of
 *     queries, not N (critique finding N1).
 *   * Every query runs in `ctx.db`: the operation's transaction as `app_user`, so
 *     row-level security decides visibility. Anything another tenant owns simply
 *     isn't there — resolved as null / NOT_FOUND, never "forbidden" (which would
 *     confirm it exists).
 * Types: `Resolvers` is generated from the SDL (codegen.ts) — a resolver that drifts
 * from the contract fails `tsc`.
 */
import { sql } from 'kysely';
import { decodeCursor, encodeCursor, toConnection, toPage } from '../repositories/pagination.js';
import {
  COLUMN_DEFAULT_ORDER,
  cursorFor,
  getTask,
  listAssignedTasks,
  listProjectTasks,
  moveTask,
  MY_TASKS_DEFAULT_ORDER,
  PROJECT_DEFAULT_ORDER,
  sortSpec,
  taskSummary,
} from '../repositories/tasks.js';
import { requireViewer } from './context.js';
import { notFound } from './errors.js';
import type { Resolvers } from './generated/resolvers-types.js';
import { DateScalar, DateTimeScalar } from './scalars.js';
import {
  MoveTaskInputSchema,
  PageSchema,
  parseArgs,
  TaskFilterSchema,
  TaskListArgsSchema,
  uuid,
} from './validation.js';

/** Relations backed by composite foreign keys always exist; null means "not visible". */
function must<T>(value: T | null, what: string): T {
  if (value === null) throw notFound(what);
  return value;
}

/** Malformed ids can't match anything — answer "not found" without asking Postgres. */
const isUuid = (value: string) => uuid.safeParse(value).success;

export const resolvers: Resolvers = {
  DateTime: DateTimeScalar,
  Date: DateScalar,

  // Public enum names ↔ the lower_case values stored in Postgres.
  OrganizationRole: { VIEWER: 'viewer', MEMBER: 'member', ADMIN: 'admin', OWNER: 'owner' },
  TaskPriority: { NONE: 'none', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', URGENT: 'urgent' },
  StatusCategory: {
    BACKLOG: 'backlog',
    UNSTARTED: 'unstarted',
    STARTED: 'started',
    COMPLETED: 'completed',
    CANCELED: 'canceled',
  },

  Query: {
    viewer: (_root, _args, ctx) => ({ userId: requireViewer(ctx) }),

    // RLS shows only the viewer's organizations: anyone else's slug → null.
    organization: async (_root, { slug }, ctx) =>
      (await ctx.db
        .selectFrom('organizations')
        .selectAll()
        .where('slug', '=', slug)
        .executeTakeFirst()) ?? null,

    project: (_root, { id }, ctx) => (isUuid(id) ? ctx.loaders.project.load(id) : null),

    task: (_root, { id }, ctx) => (isUuid(id) ? getTask(ctx.db, id) : null),

    // A single column, so a client can page one column ("load more") without
    // re-running every column's query (RLS: another tenant's status → null).
    taskStatus: (_root, { id }, ctx) => (isUuid(id) ? ctx.loaders.status.load(id) : null),

    myTasks: async (_root, args, ctx) => {
      const viewerId = requireViewer(ctx);
      const parsed = parseArgs(TaskListArgsSchema, args);
      const organizationId = parseArgs(uuid.nullish(), args.organizationId) ?? null;
      const spec = sortSpec(parsed.orderBy, MY_TASKS_DEFAULT_ORDER);
      const page = await listAssignedTasks(ctx.db, viewerId, organizationId, parsed, spec);
      return toConnection(page, cursorFor(spec));
    },
  },

  Mutation: {
    moveTask: async (_root, { input }, ctx) => {
      const viewerId = requireViewer(ctx);
      return { task: await moveTask(ctx.db, viewerId, parseArgs(MoveTaskInputSchema, input)) };
    },
  },

  Viewer: {
    user: async ({ userId }, _args, ctx) => must(await ctx.loaders.user.load(userId), 'User'),
    memberships: ({ userId }, _args, ctx) =>
      ctx.db
        .selectFrom('organizationMembers')
        .selectAll()
        .where('userId', '=', userId)
        .orderBy('createdAt')
        .execute(),
  },

  OrganizationMember: {
    organization: async (member, _args, ctx) =>
      must(await ctx.loaders.organization.load(member.organizationId), 'Organization'),
    user: async (member, _args, ctx) => must(await ctx.loaders.user.load(member.userId), 'User'),
    joinedAt: (member) => member.createdAt,
  },

  Organization: {
    viewerRole: async (organization, _args, ctx) =>
      must(await ctx.loaders.viewerMembership.load(organization.id), 'Membership').role,

    settings: async (organization, _args, ctx) =>
      must(await ctx.loaders.settings.load(organization.id), 'Organization settings'),

    // Keyset on user id: stable while members join or leave mid-scroll.
    members: async (organization, args, ctx) => {
      const { first, after } = parseArgs(PageSchema, args);
      let query = ctx.db
        .selectFrom('organizationMembers')
        .selectAll()
        .where('organizationId', '=', organization.id);
      if (after) query = query.where('userId', '>', decodeCursor(after).id);
      const rows = await query
        .orderBy('userId')
        .limit(first + 1)
        .execute();
      return toConnection(toPage(rows, first), (member) => encodeCursor(null, member.userId));
    },

    // Keyset on (key, id): projects listed alphabetically by their short key.
    projects: async (organization, args, ctx) => {
      const { first, after } = parseArgs(PageSchema, args);
      let query = ctx.db
        .selectFrom('projects')
        .selectAll()
        .where('organizationId', '=', organization.id);
      if (!args.includeArchived) query = query.where('archivedAt', 'is', null);
      if (after) {
        const cursor = decodeCursor(after);
        query = query.where(
          sql<boolean>`(key, id) > (${String(cursor.value)}, ${cursor.id}::uuid)`,
        );
      }
      const rows = await query
        .orderBy('key')
        .orderBy('id')
        .limit(first + 1)
        .execute();
      return toConnection(toPage(rows, first), (project) => encodeCursor(project.key, project.id));
    },

    labels: (organization, _args, ctx) =>
      ctx.db
        .selectFrom('labels')
        .selectAll()
        .where('organizationId', '=', organization.id)
        .orderBy('name')
        .execute(),
  },

  Project: {
    organization: async (project, _args, ctx) =>
      must(await ctx.loaders.organization.load(project.organizationId), 'Organization'),
    createdBy: (project, _args, ctx) =>
      project.createdBy ? ctx.loaders.user.load(project.createdBy) : null,
    statuses: (project, _args, ctx) => ctx.loaders.statusesByProject.load(project.id),

    tasks: async (project, args, ctx) => {
      const parsed = parseArgs(TaskListArgsSchema, args);
      const spec = sortSpec(parsed.orderBy, PROJECT_DEFAULT_ORDER);
      const page = await listProjectTasks(ctx.db, project.id, parsed, spec);
      return toConnection(page, cursorFor(spec));
    },

    taskSummary: async (project, { filter }, ctx) => {
      const statuses = await ctx.loaders.statusesByProject.load(project.id); // cached if also selected
      return taskSummary(
        ctx.db,
        project.id,
        statuses.map((status) => status.id),
        parseArgs(TaskFilterSchema, filter),
      );
    },
  },

  TaskStatus: {
    project: async (status, _args, ctx) =>
      must(await ctx.loaders.project.load(status.projectId), 'Project'),

    // Batched across all columns of the request by the columnTasks loader (N2).
    tasks: async (status, args, ctx) => {
      const parsed = parseArgs(TaskListArgsSchema, args);
      const spec = sortSpec(parsed.orderBy, COLUMN_DEFAULT_ORDER);
      const page = await ctx.loaders.columnTasks.load({ statusId: status.id, args: parsed });
      return toConnection(page, cursorFor(spec));
    },
  },

  Task: {
    project: async (task, _args, ctx) =>
      must(await ctx.loaders.project.load(task.projectId), 'Project'),
    status: async (task, _args, ctx) =>
      must(await ctx.loaders.status.load(task.statusId), 'Status'),
    assignee: (task, _args, ctx) =>
      task.assigneeId ? ctx.loaders.user.load(task.assigneeId) : null,
    labels: (task, _args, ctx) => ctx.loaders.labelsByTask.load(task.id),
    createdBy: (task, _args, ctx) =>
      task.createdBy ? ctx.loaders.user.load(task.createdBy) : null,
  },

  StatusCount: {
    status: async (entry, _args, ctx) =>
      must(await ctx.loaders.status.load(entry.statusId), 'Status'),
  },

  AssigneeCount: {
    assignee: (entry, _args, ctx) =>
      entry.assigneeId ? ctx.loaders.user.load(entry.assigneeId) : null,
  },
};
