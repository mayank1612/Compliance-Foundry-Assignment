/**
 * models.ts — the server-side objects that back each GraphQL type.
 *
 * What: for every GraphQL object type, the shape a resolver returns BEFORE its
 *       field resolvers run. GraphQL Code Generator ("mappers" in codegen.ts) wires
 *       these into the generated resolver types, so e.g. `Task.assignee` receives a
 *       TaskModel (with `assigneeId`) and must return a UserModel.
 * Why:  rows come straight from Kysely (camelCase via CamelCasePlugin); relations
 *       are resolved lazily by field resolvers through DataLoaders. Keeping these
 *       models close to the database rows means no mapping layer to maintain.
 */
import type { Selectable } from 'kysely';
import type {
  Labels,
  OrganizationMembers,
  Organizations,
  OrganizationSettings,
  Projects,
  TaskPriority,
  Tasks,
  TaskStatuses,
  Users,
} from '../db/types.js';

export type UserModel = Selectable<Users>;
export type OrganizationModel = Selectable<Organizations>;
export type OrganizationSettingsModel = Selectable<OrganizationSettings>;
export type OrganizationMemberModel = Selectable<OrganizationMembers>;
export type ProjectModel = Selectable<Projects>;
export type TaskStatusModel = Selectable<TaskStatuses>;
export type LabelModel = Selectable<Labels>;

/**
 * A task row plus two fields computed in the same SQL query (see repositories/tasks.ts):
 * `identifier` needs the project key, `isOverdue` needs "today" in the organization's
 * time zone. Computing them in SQL avoids one extra lookup per card (finding N1).
 */
export type TaskModel = Selectable<Tasks> & { identifier: string; isOverdue: boolean };

/** `viewer` resolves to just the authenticated user's id; fields load the rest. */
export interface ViewerModel {
  userId: string;
}

/** One-pass aggregation result (repositories/tasks.ts › taskSummary). */
export interface TaskSummaryModel {
  total: number;
  overdue: number;
  byStatus: StatusCountModel[];
  byPriority: { priority: TaskPriority; count: number }[];
  byAssignee: AssigneeCountModel[];
}
export interface StatusCountModel {
  statusId: string;
  count: number;
}
export interface AssigneeCountModel {
  assigneeId: string | null;
  count: number;
}
