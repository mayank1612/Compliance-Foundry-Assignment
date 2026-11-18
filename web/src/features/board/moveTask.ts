/**
 * moveTask.ts — drag-and-drop: where a card lands, and how the cache follows it.
 *
 * The UX goal (and Part 3's complaint about the old board): a drop must feel
 * instant and must NOT refetch the board. So:
 *   1. the card moves immediately (Apollo `optimisticResponse`), and
 *   2. `applyMoveToCache` edits only the two affected column lists in the cache;
 *   3. only the small summary query is refetched (column counts, chart);
 *   4. if the server refuses, Apollo discards the optimistic layer and the card
 *      snaps back by itself (no manual rollback code).
 * The pure helpers are unit-tested in moveTask.test.ts.
 */
import type { ApolloCache, Reference } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useCallback } from 'react';
import type { TaskCardFieldsFragment } from '../../gql/graphql';
import { MoveTaskMutation } from './documents';

export interface MoveTarget {
  toStatusId: string;
  /** The card that will sit directly above (null = top of the column). */
  afterTaskId: string | null;
  /** The card that will sit directly below (null = bottom of the column). */
  beforeTaskId: string | null;
}

/**
 * Neighbours of a card dropped at `index` in a column (indexes as the column
 * looks WITHOUT the dragged card). The server turns them into a rank key.
 */
export function neighboursAt(
  columnIds: readonly string[],
  movingId: string,
  index: number,
): Pick<MoveTarget, 'afterTaskId' | 'beforeTaskId'> {
  const others = columnIds.filter((id) => id !== movingId);
  const position = Math.max(0, Math.min(index, others.length));
  return { afterTaskId: others[position - 1] ?? null, beforeTaskId: others[position] ?? null };
}

/** Where to insert, given the neighbours: after `after`, else before `before`, else at the end. */
export function insertionIndex(ids: readonly (string | undefined)[], target: MoveTarget): number {
  if (target.afterTaskId) {
    const after = ids.indexOf(target.afterTaskId);
    if (after >= 0) return after + 1;
  }
  if (target.beforeTaskId) {
    const before = ids.indexOf(target.beforeTaskId);
    if (before >= 0) return before;
  }
  return ids.length;
}

/** The shape relayStylePagination stores for a connection field. */
interface StoredConnection {
  edges: { cursor?: string; node: Reference }[];
}
function isStoredConnection(value: unknown): value is StoredConnection {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { edges?: unknown }).edges)
  );
}

/**
 * Move a card between (or within) cached column lists.
 *
 * The cache can hold several versions of a column's list: one per filter the user
 * has viewed (`tasks:{"filter":…}`). Filters never involve the status, so the card
 * belongs in exactly those versions of the TARGET column whose SOURCE version
 * contained it — the other versions are left alone. (A version that isn't cached
 * isn't touched; it will be fetched fresh when shown.)
 */
export function applyMoveToCache(
  cache: ApolloCache,
  move: MoveTarget & { taskId: string; fromStatusId: string },
): void {
  const versionsWithCard = new Set<string>();

  cache.modify({
    id: cache.identify({ __typename: 'TaskStatus', id: move.fromStatusId }),
    fields: {
      tasks(existing: unknown, { readField, storeFieldName }) {
        if (!isStoredConnection(existing)) return existing;
        const edges = existing.edges.filter((edge) => readField('id', edge.node) !== move.taskId);
        if (edges.length !== existing.edges.length) versionsWithCard.add(storeFieldName);
        return { ...existing, edges };
      },
    },
  });

  cache.modify({
    id: cache.identify({ __typename: 'TaskStatus', id: move.toStatusId }),
    fields: {
      tasks(existing: unknown, { readField, storeFieldName, toReference }) {
        if (!isStoredConnection(existing) || !versionsWithCard.has(storeFieldName)) return existing;
        const node = toReference({ __typename: 'Task', id: move.taskId });
        if (!node) return existing;
        const edges = existing.edges.filter((edge) => readField('id', edge.node) !== move.taskId);
        const ids = edges.map((edge) => readField<string>('id', edge.node));
        // Empty cursor: the column's pageInfo keeps the real endCursor for "load more".
        edges.splice(insertionIndex(ids, move), 0, { cursor: '', node });
        return { ...existing, edges };
      },
    },
  });
}

/** `moveTask(card, target)` — optimistic, cache-local, summary-only refetch. */
export function useMoveTask() {
  const [mutate] = useMutation(MoveTaskMutation);
  return useCallback(
    (card: TaskCardFieldsFragment, target: MoveTarget) =>
      mutate({
        variables: {
          input: {
            id: card.id,
            statusId: target.toStatusId,
            afterTaskId: target.afterTaskId,
            beforeTaskId: target.beforeTaskId,
          },
        },
        optimisticResponse: {
          __typename: 'Mutation',
          moveTask: {
            __typename: 'TaskPayload',
            task: { ...card, status: { __typename: 'TaskStatus', id: target.toStatusId } },
          },
        },
        update: (cache) => {
          applyMoveToCache(cache, { ...target, taskId: card.id, fromStatusId: card.status.id });
        },
        refetchQueries: ['BoardSummary'],
      }),
    [mutate],
  );
}
