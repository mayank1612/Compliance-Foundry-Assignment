/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  fragment TaskCardFields on Task {\n    id\n    identifier\n    title\n    priority\n    dueDate\n    isOverdue\n    status {\n      id\n    }\n    assignee {\n      id\n      displayName\n    }\n    labels {\n      id\n      name\n      color\n    }\n  }\n": typeof types.TaskCardFieldsFragmentDoc,
    "\n  query Session {\n    viewer {\n      user {\n        id\n        displayName\n      }\n      memberships {\n        role\n        organization {\n          id\n          name\n          projects(first: 50) {\n            edges {\n              node {\n                id\n                key\n                name\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.SessionDocument,
    "\n  query Board($projectId: ID!, $filter: TaskFilter, $pageSize: Int!) {\n    project(id: $projectId) {\n      id\n      key\n      name\n      organization {\n        id\n        viewerRole\n        members(first: 100) {\n          edges {\n            node {\n              role\n              user {\n                id\n                displayName\n              }\n            }\n          }\n        }\n        labels {\n          id\n          name\n          color\n        }\n      }\n      statuses {\n        id\n        name\n        category\n        color\n        position\n        tasks(first: $pageSize, filter: $filter) {\n          edges {\n            cursor\n            node {\n              ...TaskCardFields\n            }\n          }\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n        }\n      }\n    }\n  }\n": typeof types.BoardDocument,
    "\n  query ColumnMore($statusId: ID!, $filter: TaskFilter, $pageSize: Int!, $after: String) {\n    taskStatus(id: $statusId) {\n      id\n      tasks(first: $pageSize, after: $after, filter: $filter) {\n        edges {\n          cursor\n          node {\n            ...TaskCardFields\n          }\n        }\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n      }\n    }\n  }\n": typeof types.ColumnMoreDocument,
    "\n  query BoardSummary($projectId: ID!, $filter: TaskFilter) {\n    project(id: $projectId) {\n      id\n      taskSummary(filter: $filter) {\n        total\n        overdue\n        byStatus {\n          count\n          status {\n            id\n            category\n          }\n        }\n        byPriority {\n          priority\n          count\n        }\n        byAssignee {\n          count\n          assignee {\n            id\n          }\n        }\n      }\n    }\n  }\n": typeof types.BoardSummaryDocument,
    "\n  mutation MoveTask($input: MoveTaskInput!) {\n    moveTask(input: $input) {\n      task {\n        ...TaskCardFields\n      }\n    }\n  }\n": typeof types.MoveTaskDocument,
};
const documents: Documents = {
    "\n  fragment TaskCardFields on Task {\n    id\n    identifier\n    title\n    priority\n    dueDate\n    isOverdue\n    status {\n      id\n    }\n    assignee {\n      id\n      displayName\n    }\n    labels {\n      id\n      name\n      color\n    }\n  }\n": types.TaskCardFieldsFragmentDoc,
    "\n  query Session {\n    viewer {\n      user {\n        id\n        displayName\n      }\n      memberships {\n        role\n        organization {\n          id\n          name\n          projects(first: 50) {\n            edges {\n              node {\n                id\n                key\n                name\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": types.SessionDocument,
    "\n  query Board($projectId: ID!, $filter: TaskFilter, $pageSize: Int!) {\n    project(id: $projectId) {\n      id\n      key\n      name\n      organization {\n        id\n        viewerRole\n        members(first: 100) {\n          edges {\n            node {\n              role\n              user {\n                id\n                displayName\n              }\n            }\n          }\n        }\n        labels {\n          id\n          name\n          color\n        }\n      }\n      statuses {\n        id\n        name\n        category\n        color\n        position\n        tasks(first: $pageSize, filter: $filter) {\n          edges {\n            cursor\n            node {\n              ...TaskCardFields\n            }\n          }\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n        }\n      }\n    }\n  }\n": types.BoardDocument,
    "\n  query ColumnMore($statusId: ID!, $filter: TaskFilter, $pageSize: Int!, $after: String) {\n    taskStatus(id: $statusId) {\n      id\n      tasks(first: $pageSize, after: $after, filter: $filter) {\n        edges {\n          cursor\n          node {\n            ...TaskCardFields\n          }\n        }\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n      }\n    }\n  }\n": types.ColumnMoreDocument,
    "\n  query BoardSummary($projectId: ID!, $filter: TaskFilter) {\n    project(id: $projectId) {\n      id\n      taskSummary(filter: $filter) {\n        total\n        overdue\n        byStatus {\n          count\n          status {\n            id\n            category\n          }\n        }\n        byPriority {\n          priority\n          count\n        }\n        byAssignee {\n          count\n          assignee {\n            id\n          }\n        }\n      }\n    }\n  }\n": types.BoardSummaryDocument,
    "\n  mutation MoveTask($input: MoveTaskInput!) {\n    moveTask(input: $input) {\n      task {\n        ...TaskCardFields\n      }\n    }\n  }\n": types.MoveTaskDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment TaskCardFields on Task {\n    id\n    identifier\n    title\n    priority\n    dueDate\n    isOverdue\n    status {\n      id\n    }\n    assignee {\n      id\n      displayName\n    }\n    labels {\n      id\n      name\n      color\n    }\n  }\n"): (typeof documents)["\n  fragment TaskCardFields on Task {\n    id\n    identifier\n    title\n    priority\n    dueDate\n    isOverdue\n    status {\n      id\n    }\n    assignee {\n      id\n      displayName\n    }\n    labels {\n      id\n      name\n      color\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Session {\n    viewer {\n      user {\n        id\n        displayName\n      }\n      memberships {\n        role\n        organization {\n          id\n          name\n          projects(first: 50) {\n            edges {\n              node {\n                id\n                key\n                name\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query Session {\n    viewer {\n      user {\n        id\n        displayName\n      }\n      memberships {\n        role\n        organization {\n          id\n          name\n          projects(first: 50) {\n            edges {\n              node {\n                id\n                key\n                name\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Board($projectId: ID!, $filter: TaskFilter, $pageSize: Int!) {\n    project(id: $projectId) {\n      id\n      key\n      name\n      organization {\n        id\n        viewerRole\n        members(first: 100) {\n          edges {\n            node {\n              role\n              user {\n                id\n                displayName\n              }\n            }\n          }\n        }\n        labels {\n          id\n          name\n          color\n        }\n      }\n      statuses {\n        id\n        name\n        category\n        color\n        position\n        tasks(first: $pageSize, filter: $filter) {\n          edges {\n            cursor\n            node {\n              ...TaskCardFields\n            }\n          }\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query Board($projectId: ID!, $filter: TaskFilter, $pageSize: Int!) {\n    project(id: $projectId) {\n      id\n      key\n      name\n      organization {\n        id\n        viewerRole\n        members(first: 100) {\n          edges {\n            node {\n              role\n              user {\n                id\n                displayName\n              }\n            }\n          }\n        }\n        labels {\n          id\n          name\n          color\n        }\n      }\n      statuses {\n        id\n        name\n        category\n        color\n        position\n        tasks(first: $pageSize, filter: $filter) {\n          edges {\n            cursor\n            node {\n              ...TaskCardFields\n            }\n          }\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ColumnMore($statusId: ID!, $filter: TaskFilter, $pageSize: Int!, $after: String) {\n    taskStatus(id: $statusId) {\n      id\n      tasks(first: $pageSize, after: $after, filter: $filter) {\n        edges {\n          cursor\n          node {\n            ...TaskCardFields\n          }\n        }\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query ColumnMore($statusId: ID!, $filter: TaskFilter, $pageSize: Int!, $after: String) {\n    taskStatus(id: $statusId) {\n      id\n      tasks(first: $pageSize, after: $after, filter: $filter) {\n        edges {\n          cursor\n          node {\n            ...TaskCardFields\n          }\n        }\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query BoardSummary($projectId: ID!, $filter: TaskFilter) {\n    project(id: $projectId) {\n      id\n      taskSummary(filter: $filter) {\n        total\n        overdue\n        byStatus {\n          count\n          status {\n            id\n            category\n          }\n        }\n        byPriority {\n          priority\n          count\n        }\n        byAssignee {\n          count\n          assignee {\n            id\n          }\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query BoardSummary($projectId: ID!, $filter: TaskFilter) {\n    project(id: $projectId) {\n      id\n      taskSummary(filter: $filter) {\n        total\n        overdue\n        byStatus {\n          count\n          status {\n            id\n            category\n          }\n        }\n        byPriority {\n          priority\n          count\n        }\n        byAssignee {\n          count\n          assignee {\n            id\n          }\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MoveTask($input: MoveTaskInput!) {\n    moveTask(input: $input) {\n      task {\n        ...TaskCardFields\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation MoveTask($input: MoveTaskInput!) {\n    moveTask(input: $input) {\n      task {\n        ...TaskCardFields\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;