/**
 * fixtures.ts — typed query results for component tests.
 *
 * Typed against the GENERATED operation types, so a fixture that drifts from the
 * schema fails to compile. Every object carries __typename (Apollo's cache needs it
 * to normalise; codegen's nonOptionalTypename makes it mandatory here too).
 */
import type {
  BoardQuery,
  BoardSummaryQuery,
  OrganizationRole,
  TaskCardFieldsFragment,
  TaskPriority,
} from '../gql/graphql';

export const PROJECT_ID = '01a1ed8d-be52-7005-96a9-1d53c9eb559a';
export const STATUS_IDS = {
  todo: '01a1ed8d-be52-7005-96a9-000000000001',
  doing: '01a1ed8d-be52-7005-96a9-000000000002',
  done: '01a1ed8d-be52-7005-96a9-000000000003',
} as const;

export function task(
  id: string,
  statusId: string,
  overrides: Partial<Omit<TaskCardFieldsFragment, '__typename' | 'status'>> = {},
): TaskCardFieldsFragment {
  return {
    __typename: 'Task',
    id,
    identifier: `WEB-${id.slice(-2)}`,
    title: `Task ${id.slice(-2)}`,
    priority: 'MEDIUM' satisfies TaskPriority,
    dueDate: null,
    isOverdue: false,
    status: { __typename: 'TaskStatus', id: statusId },
    assignee: null,
    labels: [],
    ...overrides,
  };
}

type Status = NonNullable<BoardQuery['project']>['statuses'][number];

function column(
  id: string,
  name: string,
  category: Status['category'],
  tasks: TaskCardFieldsFragment[],
): Status {
  return {
    __typename: 'TaskStatus',
    id,
    name,
    category,
    color: '#64748b',
    position: 0,
    tasks: {
      __typename: 'TaskConnection',
      edges: tasks.map((node) => ({ __typename: 'TaskEdge', cursor: `c-${node.id}`, node })),
      pageInfo: {
        __typename: 'PageInfo',
        hasNextPage: false,
        endCursor: tasks.at(-1) ? `c-${tasks.at(-1)?.id}` : null,
      },
    },
  };
}

export function boardResult(
  options: { empty?: boolean; viewerRole?: OrganizationRole } = {},
): BoardQuery {
  const cards = options.empty
    ? { todo: [], doing: [], done: [] }
    : {
        todo: [
          task('0000000000-0000-7000-8000-000000000011', STATUS_IDS.todo, {
            title: 'Fix login flow',
            priority: 'URGENT',
            dueDate: '2026-11-01',
            isOverdue: true,
            assignee: { __typename: 'User', id: 'u-carol', displayName: 'Carol Diaz' },
          }),
          task('0000000000-0000-7000-8000-000000000012', STATUS_IDS.todo, {
            title: 'Write release notes',
          }),
        ],
        doing: [
          task('0000000000-0000-7000-8000-000000000021', STATUS_IDS.doing, {
            title: 'Design dark mode',
          }),
        ],
        done: [],
      };
  return {
    __typename: 'Query',
    project: {
      __typename: 'Project',
      id: PROJECT_ID,
      key: 'WEB',
      name: 'Website Relaunch',
      organization: {
        __typename: 'Organization',
        id: 'org-acme',
        viewerRole: options.viewerRole ?? 'MEMBER',
        members: {
          __typename: 'OrganizationMemberConnection',
          edges: [
            {
              __typename: 'OrganizationMemberEdge',
              node: {
                __typename: 'OrganizationMember',
                role: 'MEMBER',
                user: { __typename: 'User', id: 'u-carol', displayName: 'Carol Diaz' },
              },
            },
          ],
        },
        labels: [{ __typename: 'Label', id: 'l-bug', name: 'bug', color: '#ef4444' }],
      },
      statuses: [
        column(STATUS_IDS.todo, 'Todo', 'UNSTARTED', cards.todo),
        column(STATUS_IDS.doing, 'In Progress', 'STARTED', cards.doing),
        column(STATUS_IDS.done, 'Done', 'COMPLETED', cards.done),
      ],
    },
  };
}

export function summaryResult(options: { empty?: boolean } = {}): BoardSummaryQuery {
  const counts = options.empty ? [0, 0, 0] : [2, 1, 0];
  const total = counts.reduce((sum, n) => sum + n, 0);
  return {
    __typename: 'Query',
    project: {
      __typename: 'Project',
      id: PROJECT_ID,
      taskSummary: {
        __typename: 'TaskSummary',
        total,
        overdue: options.empty ? 0 : 1,
        byStatus: [
          {
            __typename: 'StatusCount',
            count: counts[0] ?? 0,
            status: { __typename: 'TaskStatus', id: STATUS_IDS.todo, category: 'UNSTARTED' },
          },
          {
            __typename: 'StatusCount',
            count: counts[1] ?? 0,
            status: { __typename: 'TaskStatus', id: STATUS_IDS.doing, category: 'STARTED' },
          },
          {
            __typename: 'StatusCount',
            count: counts[2] ?? 0,
            status: { __typename: 'TaskStatus', id: STATUS_IDS.done, category: 'COMPLETED' },
          },
        ],
        byPriority: (['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((priority) => ({
          __typename: 'PriorityCount' as const,
          priority,
          count: options.empty ? 0 : priority === 'URGENT' ? 1 : priority === 'MEDIUM' ? 2 : 0,
        })),
        byAssignee: options.empty
          ? []
          : [
              { __typename: 'AssigneeCount', count: 2, assignee: null },
              {
                __typename: 'AssigneeCount',
                count: 1,
                assignee: { __typename: 'User', id: 'u-carol' },
              },
            ],
      },
    },
  };
}
