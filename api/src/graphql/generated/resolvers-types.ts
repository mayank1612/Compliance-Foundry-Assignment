import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { UserModel, ViewerModel, OrganizationModel, OrganizationSettingsModel, OrganizationMemberModel, ProjectModel, TaskStatusModel, LabelModel, TaskModel, TaskSummaryModel, StatusCountModel, AssigneeCountModel } from '../models.js';
import type { GraphQLContext } from '../context.js';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A calendar date with no time or zone: `YYYY-MM-DD`. */
  Date: { input: string; output: string; }
  /** An instant in time: ISO-8601 with offset, e.g. `2026-11-16T09:30:00Z`. */
  DateTime: { input: Date; output: Date | string; }
};

export type AssigneeCount = {
  __typename?: 'AssigneeCount';
  assignee?: Maybe<User>;
  count: Scalars['Int']['output'];
};

/** An inclusive date range; either end may be omitted. */
export type DateRange = {
  from?: InputMaybe<Scalars['Date']['input']>;
  to?: InputMaybe<Scalars['Date']['input']>;
};

export type Label = {
  __typename?: 'Label';
  color: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type MoveTaskInput = {
  afterTaskId?: InputMaybe<Scalars['ID']['input']>;
  beforeTaskId?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
  statusId: Scalars['ID']['input'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /**
   * Board drag-and-drop: put the task into `statusId`, between `afterTaskId` and
   * `beforeTaskId` (both optional: neither = end of column). The server computes
   * the new rank, so clients never deal with ordering keys.
   */
  moveTask: TaskPayload;
};


export type MutationMoveTaskArgs = {
  input: MoveTaskInput;
};

export type Organization = {
  __typename?: 'Organization';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  labels: Array<Label>;
  members: OrganizationMemberConnection;
  name: Scalars['String']['output'];
  projects: ProjectConnection;
  settings: OrganizationSettings;
  slug: Scalars['String']['output'];
  /** The signed-in user's role here — drives which controls the UI shows. */
  viewerRole: OrganizationRole;
};


export type OrganizationMembersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};


export type OrganizationProjectsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  includeArchived?: InputMaybe<Scalars['Boolean']['input']>;
};

export type OrganizationMember = {
  __typename?: 'OrganizationMember';
  joinedAt: Scalars['DateTime']['output'];
  organization: Organization;
  role: OrganizationRole;
  user: User;
};

export type OrganizationMemberConnection = {
  __typename?: 'OrganizationMemberConnection';
  edges: Array<OrganizationMemberEdge>;
  pageInfo: PageInfo;
};

export type OrganizationMemberEdge = {
  __typename?: 'OrganizationMemberEdge';
  cursor: Scalars['String']['output'];
  node: OrganizationMember;
};

export type OrganizationRole =
  | 'admin'
  | 'member'
  | 'owner'
  | 'viewer';

export type OrganizationSettings = {
  __typename?: 'OrganizationSettings';
  membersCanCreateProjects: Scalars['Boolean']['output'];
  timezone: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  weekStartsOn: Scalars['Int']['output'];
};

/** Cursor pagination state. Cursors are opaque; pass `endCursor` as `after`. */
export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

export type PriorityCount = {
  __typename?: 'PriorityCount';
  count: Scalars['Int']['output'];
  priority: TaskPriority;
};

export type Project = {
  __typename?: 'Project';
  archivedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  createdBy?: Maybe<User>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  key: Scalars['String']['output'];
  name: Scalars['String']['output'];
  organization: Organization;
  /** The board's columns, in display order. */
  statuses: Array<TaskStatus>;
  /** Counts for the summary panel and charts, honouring the same filter as `tasks`. */
  taskSummary: TaskSummary;
  /** All live tasks of the project, filtered and sorted. Default order: newest first. */
  tasks: TaskConnection;
  updatedAt: Scalars['DateTime']['output'];
};


export type ProjectTaskSummaryArgs = {
  filter?: InputMaybe<TaskFilter>;
};


export type ProjectTasksArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<TaskFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<TaskOrder>;
};

export type ProjectConnection = {
  __typename?: 'ProjectConnection';
  edges: Array<ProjectEdge>;
  pageInfo: PageInfo;
};

export type ProjectEdge = {
  __typename?: 'ProjectEdge';
  cursor: Scalars['String']['output'];
  node: Project;
};

export type Query = {
  __typename?: 'Query';
  /**
   * Tasks assigned to the viewer across every project (and, unless
   * `organizationId` is given, every organization) they belong to.
   * "My overdue tasks": `myTasks(filter: { overdue: true })`.
   */
  myTasks: TaskConnection;
  /** An organization the viewer belongs to; null otherwise. */
  organization?: Maybe<Organization>;
  project?: Maybe<Project>;
  task?: Maybe<Task>;
  /**
   * One board column. Lets a client load more cards for a single column: the
   * column is cached by id, so its pages merge with the board query's list.
   * (Added in Part 2 — see docs/part1/schema-changelog.md.)
   */
  taskStatus?: Maybe<TaskStatus>;
  /** The signed-in user. UNAUTHENTICATED without a valid token. */
  viewer: Viewer;
};


export type QueryMyTasksArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<TaskFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<TaskOrder>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrganizationArgs = {
  slug: Scalars['String']['input'];
};


export type QueryProjectArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTaskArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTaskStatusArgs = {
  id: Scalars['ID']['input'];
};

export type SortDirection =
  | 'ASC'
  | 'DESC';

export type StatusCategory =
  | 'backlog'
  | 'canceled'
  | 'completed'
  | 'started'
  | 'unstarted';

export type StatusCount = {
  __typename?: 'StatusCount';
  count: Scalars['Int']['output'];
  status: TaskStatus;
};

export type Task = {
  __typename?: 'Task';
  assignee?: Maybe<User>;
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  createdBy?: Maybe<User>;
  description?: Maybe<Scalars['String']['output']>;
  dueDate?: Maybe<Scalars['Date']['output']>;
  id: Scalars['ID']['output'];
  /** Human identifier: project key + number, e.g. `WEB-42`. */
  identifier: Scalars['String']['output'];
  /** Open (not COMPLETED/CANCELED) and due before today in the organization's time zone. */
  isOverdue: Scalars['Boolean']['output'];
  labels: Array<Label>;
  number: Scalars['Int']['output'];
  priority: TaskPriority;
  project: Project;
  status: TaskStatus;
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type TaskConnection = {
  __typename?: 'TaskConnection';
  edges: Array<TaskEdge>;
  pageInfo: PageInfo;
};

export type TaskEdge = {
  __typename?: 'TaskEdge';
  cursor: Scalars['String']['output'];
  node: Task;
};

/** Filters combine with AND; values inside one list combine with OR. */
export type TaskFilter = {
  assigneeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  dueDate?: InputMaybe<DateRange>;
  /** Also (OR) match tasks with no assignee; on its own, matches unassigned tasks only. */
  includeUnassigned?: InputMaybe<Scalars['Boolean']['input']>;
  labelIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  overdue?: InputMaybe<Scalars['Boolean']['input']>;
  priorities?: InputMaybe<Array<TaskPriority>>;
  statusCategories?: InputMaybe<Array<StatusCategory>>;
  statusIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type TaskOrder = {
  direction?: SortDirection;
  field: TaskSortField;
};

export type TaskPayload = {
  __typename?: 'TaskPayload';
  task: Task;
};

export type TaskPriority =
  | 'high'
  | 'low'
  | 'medium'
  | 'none'
  | 'urgent';

export type TaskSortField =
  /** Newest first by default. Served from the per-project sequence number. */
  | 'CREATED_AT'
  | 'DUE_DATE'
  /** The per-project sequence number (WEB-1, WEB-2, …). */
  | 'NUMBER'
  | 'PRIORITY'
  /** Manual board order. Only meaningful within one status column. */
  | 'RANK';

/** A customizable status (board column) of one project. */
export type TaskStatus = {
  __typename?: 'TaskStatus';
  category: StatusCategory;
  color: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isDefault: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  position: Scalars['Int']['output'];
  project: Project;
  /** This column's tasks, in board order by default; each column pages independently. */
  tasks: TaskConnection;
};


/** A customizable status (board column) of one project. */
export type TaskStatusTasksArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<TaskFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<TaskOrder>;
};

/** Aggregates over the live tasks matching a filter, computed in one SQL pass. */
export type TaskSummary = {
  __typename?: 'TaskSummary';
  /** Busiest first (top 50). The entry with `assignee: null` counts unassigned tasks. */
  byAssignee: Array<AssigneeCount>;
  /** One entry per priority, NONE → URGENT — including zero counts. */
  byPriority: Array<PriorityCount>;
  /** One entry per status of the project, in column order — including zero counts. */
  byStatus: Array<StatusCount>;
  overdue: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type User = {
  __typename?: 'User';
  avatarUrl?: Maybe<Scalars['String']['output']>;
  displayName: Scalars['String']['output'];
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
};

/** The signed-in user and their organizations. */
export type Viewer = {
  __typename?: 'Viewer';
  memberships: Array<OrganizationMember>;
  user: User;
};

export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;

export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
  AssigneeCount: ResolverTypeWrapper<AssigneeCountModel>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  Date: ResolverTypeWrapper<Scalars['Date']['output']>;
  DateRange: DateRange;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Label: ResolverTypeWrapper<LabelModel>;
  MoveTaskInput: MoveTaskInput;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Organization: ResolverTypeWrapper<OrganizationModel>;
  OrganizationMember: ResolverTypeWrapper<OrganizationMemberModel>;
  OrganizationMemberConnection: ResolverTypeWrapper<Omit<OrganizationMemberConnection, 'edges'> & { edges: Array<ResolversTypes['OrganizationMemberEdge']> }>;
  OrganizationMemberEdge: ResolverTypeWrapper<Omit<OrganizationMemberEdge, 'node'> & { node: ResolversTypes['OrganizationMember'] }>;
  OrganizationRole: OrganizationRole;
  OrganizationSettings: ResolverTypeWrapper<OrganizationSettingsModel>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  PriorityCount: ResolverTypeWrapper<PriorityCount>;
  Project: ResolverTypeWrapper<ProjectModel>;
  ProjectConnection: ResolverTypeWrapper<Omit<ProjectConnection, 'edges'> & { edges: Array<ResolversTypes['ProjectEdge']> }>;
  ProjectEdge: ResolverTypeWrapper<Omit<ProjectEdge, 'node'> & { node: ResolversTypes['Project'] }>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  SortDirection: SortDirection;
  StatusCategory: StatusCategory;
  StatusCount: ResolverTypeWrapper<StatusCountModel>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Task: ResolverTypeWrapper<TaskModel>;
  TaskConnection: ResolverTypeWrapper<Omit<TaskConnection, 'edges'> & { edges: Array<ResolversTypes['TaskEdge']> }>;
  TaskEdge: ResolverTypeWrapper<Omit<TaskEdge, 'node'> & { node: ResolversTypes['Task'] }>;
  TaskFilter: TaskFilter;
  TaskOrder: TaskOrder;
  TaskPayload: ResolverTypeWrapper<Omit<TaskPayload, 'task'> & { task: ResolversTypes['Task'] }>;
  TaskPriority: TaskPriority;
  TaskSortField: TaskSortField;
  TaskStatus: ResolverTypeWrapper<TaskStatusModel>;
  TaskSummary: ResolverTypeWrapper<TaskSummaryModel>;
  User: ResolverTypeWrapper<UserModel>;
  Viewer: ResolverTypeWrapper<ViewerModel>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  AssigneeCount: AssigneeCountModel;
  Boolean: Scalars['Boolean']['output'];
  Date: Scalars['Date']['output'];
  DateRange: DateRange;
  DateTime: Scalars['DateTime']['output'];
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  Label: LabelModel;
  MoveTaskInput: MoveTaskInput;
  Mutation: Record<PropertyKey, never>;
  Organization: OrganizationModel;
  OrganizationMember: OrganizationMemberModel;
  OrganizationMemberConnection: Omit<OrganizationMemberConnection, 'edges'> & { edges: Array<ResolversParentTypes['OrganizationMemberEdge']> };
  OrganizationMemberEdge: Omit<OrganizationMemberEdge, 'node'> & { node: ResolversParentTypes['OrganizationMember'] };
  OrganizationSettings: OrganizationSettingsModel;
  PageInfo: PageInfo;
  PriorityCount: PriorityCount;
  Project: ProjectModel;
  ProjectConnection: Omit<ProjectConnection, 'edges'> & { edges: Array<ResolversParentTypes['ProjectEdge']> };
  ProjectEdge: Omit<ProjectEdge, 'node'> & { node: ResolversParentTypes['Project'] };
  Query: Record<PropertyKey, never>;
  StatusCount: StatusCountModel;
  String: Scalars['String']['output'];
  Task: TaskModel;
  TaskConnection: Omit<TaskConnection, 'edges'> & { edges: Array<ResolversParentTypes['TaskEdge']> };
  TaskEdge: Omit<TaskEdge, 'node'> & { node: ResolversParentTypes['Task'] };
  TaskFilter: TaskFilter;
  TaskOrder: TaskOrder;
  TaskPayload: Omit<TaskPayload, 'task'> & { task: ResolversParentTypes['Task'] };
  TaskStatus: TaskStatusModel;
  TaskSummary: TaskSummaryModel;
  User: UserModel;
  Viewer: ViewerModel;
}>;

export type AssigneeCountResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AssigneeCount'] = ResolversParentTypes['AssigneeCount']> = ResolversObject<{
  assignee?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  count?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
}>;

export interface DateScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
  name: 'Date';
}

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type LabelResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Label'] = ResolversParentTypes['Label']> = ResolversObject<{
  color?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  moveTask?: Resolver<ResolversTypes['TaskPayload'], ParentType, ContextType, RequireFields<MutationMoveTaskArgs, 'input'>>;
}>;

export type OrganizationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Organization'] = ResolversParentTypes['Organization']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  labels?: Resolver<Array<ResolversTypes['Label']>, ParentType, ContextType>;
  members?: Resolver<ResolversTypes['OrganizationMemberConnection'], ParentType, ContextType, RequireFields<OrganizationMembersArgs, 'first'>>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  projects?: Resolver<ResolversTypes['ProjectConnection'], ParentType, ContextType, RequireFields<OrganizationProjectsArgs, 'first' | 'includeArchived'>>;
  settings?: Resolver<ResolversTypes['OrganizationSettings'], ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  viewerRole?: Resolver<ResolversTypes['OrganizationRole'], ParentType, ContextType>;
}>;

export type OrganizationMemberResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrganizationMember'] = ResolversParentTypes['OrganizationMember']> = ResolversObject<{
  joinedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  organization?: Resolver<ResolversTypes['Organization'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['OrganizationRole'], ParentType, ContextType>;
  user?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
}>;

export type OrganizationMemberConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrganizationMemberConnection'] = ResolversParentTypes['OrganizationMemberConnection']> = ResolversObject<{
  edges?: Resolver<Array<ResolversTypes['OrganizationMemberEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
}>;

export type OrganizationMemberEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrganizationMemberEdge'] = ResolversParentTypes['OrganizationMemberEdge']> = ResolversObject<{
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['OrganizationMember'], ParentType, ContextType>;
}>;

export type OrganizationRoleResolvers = { ADMIN: 'admin', MEMBER: 'member', OWNER: 'owner', VIEWER: 'viewer' };

export type OrganizationSettingsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrganizationSettings'] = ResolversParentTypes['OrganizationSettings']> = ResolversObject<{
  membersCanCreateProjects?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  timezone?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  weekStartsOn?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
}>;

export type PageInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = ResolversObject<{
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
}>;

export type PriorityCountResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PriorityCount'] = ResolversParentTypes['PriorityCount']> = ResolversObject<{
  count?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['TaskPriority'], ParentType, ContextType>;
}>;

export type ProjectResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Project'] = ResolversParentTypes['Project']> = ResolversObject<{
  archivedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  createdBy?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  key?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  organization?: Resolver<ResolversTypes['Organization'], ParentType, ContextType>;
  statuses?: Resolver<Array<ResolversTypes['TaskStatus']>, ParentType, ContextType>;
  taskSummary?: Resolver<ResolversTypes['TaskSummary'], ParentType, ContextType, Partial<ProjectTaskSummaryArgs>>;
  tasks?: Resolver<ResolversTypes['TaskConnection'], ParentType, ContextType, RequireFields<ProjectTasksArgs, 'first' | 'orderBy'>>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
}>;

export type ProjectConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectConnection'] = ResolversParentTypes['ProjectConnection']> = ResolversObject<{
  edges?: Resolver<Array<ResolversTypes['ProjectEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
}>;

export type ProjectEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProjectEdge'] = ResolversParentTypes['ProjectEdge']> = ResolversObject<{
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Project'], ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  myTasks?: Resolver<ResolversTypes['TaskConnection'], ParentType, ContextType, RequireFields<QueryMyTasksArgs, 'first' | 'orderBy'>>;
  organization?: Resolver<Maybe<ResolversTypes['Organization']>, ParentType, ContextType, RequireFields<QueryOrganizationArgs, 'slug'>>;
  project?: Resolver<Maybe<ResolversTypes['Project']>, ParentType, ContextType, RequireFields<QueryProjectArgs, 'id'>>;
  task?: Resolver<Maybe<ResolversTypes['Task']>, ParentType, ContextType, RequireFields<QueryTaskArgs, 'id'>>;
  taskStatus?: Resolver<Maybe<ResolversTypes['TaskStatus']>, ParentType, ContextType, RequireFields<QueryTaskStatusArgs, 'id'>>;
  viewer?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType>;
}>;

export type StatusCategoryResolvers = { BACKLOG: 'backlog', CANCELED: 'canceled', COMPLETED: 'completed', STARTED: 'started', UNSTARTED: 'unstarted' };

export type StatusCountResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StatusCount'] = ResolversParentTypes['StatusCount']> = ResolversObject<{
  count?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['TaskStatus'], ParentType, ContextType>;
}>;

export type TaskResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Task'] = ResolversParentTypes['Task']> = ResolversObject<{
  assignee?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  completedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  createdBy?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  dueDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  identifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  isOverdue?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  labels?: Resolver<Array<ResolversTypes['Label']>, ParentType, ContextType>;
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['TaskPriority'], ParentType, ContextType>;
  project?: Resolver<ResolversTypes['Project'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['TaskStatus'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
}>;

export type TaskConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TaskConnection'] = ResolversParentTypes['TaskConnection']> = ResolversObject<{
  edges?: Resolver<Array<ResolversTypes['TaskEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
}>;

export type TaskEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TaskEdge'] = ResolversParentTypes['TaskEdge']> = ResolversObject<{
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Task'], ParentType, ContextType>;
}>;

export type TaskPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TaskPayload'] = ResolversParentTypes['TaskPayload']> = ResolversObject<{
  task?: Resolver<ResolversTypes['Task'], ParentType, ContextType>;
}>;

export type TaskPriorityResolvers = { HIGH: 'high', LOW: 'low', MEDIUM: 'medium', NONE: 'none', URGENT: 'urgent' };

export type TaskStatusResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TaskStatus'] = ResolversParentTypes['TaskStatus']> = ResolversObject<{
  category?: Resolver<ResolversTypes['StatusCategory'], ParentType, ContextType>;
  color?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isDefault?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  position?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  project?: Resolver<ResolversTypes['Project'], ParentType, ContextType>;
  tasks?: Resolver<ResolversTypes['TaskConnection'], ParentType, ContextType, RequireFields<TaskStatusTasksArgs, 'first' | 'orderBy'>>;
}>;

export type TaskSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TaskSummary'] = ResolversParentTypes['TaskSummary']> = ResolversObject<{
  byAssignee?: Resolver<Array<ResolversTypes['AssigneeCount']>, ParentType, ContextType>;
  byPriority?: Resolver<Array<ResolversTypes['PriorityCount']>, ParentType, ContextType>;
  byStatus?: Resolver<Array<ResolversTypes['StatusCount']>, ParentType, ContextType>;
  overdue?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
}>;

export type UserResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User']> = ResolversObject<{
  avatarUrl?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  displayName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export type ViewerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Viewer'] = ResolversParentTypes['Viewer']> = ResolversObject<{
  memberships?: Resolver<Array<ResolversTypes['OrganizationMember']>, ParentType, ContextType>;
  user?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
}>;

export type Resolvers<ContextType = GraphQLContext> = ResolversObject<{
  AssigneeCount?: AssigneeCountResolvers<ContextType>;
  Date?: GraphQLScalarType;
  DateTime?: GraphQLScalarType;
  Label?: LabelResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Organization?: OrganizationResolvers<ContextType>;
  OrganizationMember?: OrganizationMemberResolvers<ContextType>;
  OrganizationMemberConnection?: OrganizationMemberConnectionResolvers<ContextType>;
  OrganizationMemberEdge?: OrganizationMemberEdgeResolvers<ContextType>;
  OrganizationRole?: OrganizationRoleResolvers;
  OrganizationSettings?: OrganizationSettingsResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  PriorityCount?: PriorityCountResolvers<ContextType>;
  Project?: ProjectResolvers<ContextType>;
  ProjectConnection?: ProjectConnectionResolvers<ContextType>;
  ProjectEdge?: ProjectEdgeResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  StatusCategory?: StatusCategoryResolvers;
  StatusCount?: StatusCountResolvers<ContextType>;
  Task?: TaskResolvers<ContextType>;
  TaskConnection?: TaskConnectionResolvers<ContextType>;
  TaskEdge?: TaskEdgeResolvers<ContextType>;
  TaskPayload?: TaskPayloadResolvers<ContextType>;
  TaskPriority?: TaskPriorityResolvers;
  TaskStatus?: TaskStatusResolvers<ContextType>;
  TaskSummary?: TaskSummaryResolvers<ContextType>;
  User?: UserResolvers<ContextType>;
  Viewer?: ViewerResolvers<ContextType>;
}>;

