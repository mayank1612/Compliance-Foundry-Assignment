/**
 * documents.ts — every GraphQL operation the task board sends.
 *
 * What: typed documents (via the generated `graphql()` in src/gql) for the board,
 *       one column's "load more", the summary panel, and the drag-and-drop move.
 * Why split the summary from the board: after a card moves, only the counts are
 *       refetched; the columns are updated locally in the cache (Part 3's problem
 *       statement is exactly "every status update refetches everything").
 * Cache identity: every object carries `id`, so Apollo normalises it once
 *       (Task:<id>, TaskStatus:<id>); `TaskStatus.tasks` pages from the board query
 *       and from ColumnMore merge into one list (see apollo/cache.ts).
 */
import { graphql } from '../../gql';

/** Cards per column per page (the API caps any page at 100). */
export const PAGE_SIZE = 25;

/** What a card shows. Colocated here, spread wherever a task is fetched. */
export const TaskCardFields = graphql(`
  fragment TaskCardFields on Task {
    id
    identifier
    title
    priority
    dueDate
    isOverdue
    status {
      id
    }
    assignee {
      id
      displayName
    }
    labels {
      id
      name
      color
    }
  }
`);

/** The signed-in user, their organizations and projects (header pickers). */
export const SessionQuery = graphql(`
  query Session {
    viewer {
      user {
        id
        displayName
      }
      memberships {
        role
        organization {
          id
          name
          projects(first: 50) {
            edges {
              node {
                id
                key
                name
              }
            }
          }
        }
      }
    }
  }
`);

/** The whole board: columns with their first page, plus what the filters need. */
export const BoardQuery = graphql(`
  query Board($projectId: ID!, $filter: TaskFilter, $pageSize: Int!) {
    project(id: $projectId) {
      id
      key
      name
      organization {
        id
        viewerRole
        members(first: 100) {
          edges {
            node {
              role
              user {
                id
                displayName
              }
            }
          }
        }
        labels {
          id
          name
          color
        }
      }
      statuses {
        id
        name
        category
        color
        position
        tasks(first: $pageSize, filter: $filter) {
          edges {
            cursor
            node {
              ...TaskCardFields
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`);

/** "Load more" for ONE column; merges into the same cached list as the board query. */
export const ColumnMoreQuery = graphql(`
  query ColumnMore($statusId: ID!, $filter: TaskFilter, $pageSize: Int!, $after: String) {
    taskStatus(id: $statusId) {
      id
      tasks(first: $pageSize, after: $after, filter: $filter) {
        edges {
          cursor
          node {
            ...TaskCardFields
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

/** Summary panel + chart: counts honour the same filter as the board. */
export const BoardSummaryQuery = graphql(`
  query BoardSummary($projectId: ID!, $filter: TaskFilter) {
    project(id: $projectId) {
      id
      taskSummary(filter: $filter) {
        total
        overdue
        byStatus {
          count
          status {
            id
            category
          }
        }
        byPriority {
          priority
          count
        }
        byAssignee {
          count
          assignee {
            id
          }
        }
      }
    }
  }
`);

/** Drag-and-drop. The server computes the rank between the given neighbours. */
export const MoveTaskMutation = graphql(`
  mutation MoveTask($input: MoveTaskInput!) {
    moveTask(input: $input) {
      task {
        ...TaskCardFields
      }
    }
  }
`);
