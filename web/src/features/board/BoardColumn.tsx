/**
 * BoardColumn.tsx — one status column: header with count, sortable cards,
 * "Load more", and an empty-column drop zone.
 *
 * Pagination: the board query loads the first page of every column; "Load more"
 * fetches the NEXT page of THIS column only (ColumnMore query, `taskStatus(id)`),
 * and the cache appends it to the same list (apollo/cache.ts) — no other column
 * is refetched.
 */
import { useApolloClient } from '@apollo/client/react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import type { BoardQuery, TaskCardFieldsFragment, TaskFilter } from '../../gql/graphql';
import { cx } from '../../lib/cx';
import { describeError } from '../../lib/errors';
import { ColumnMoreQuery, PAGE_SIZE } from './documents';
import { SortableTaskCard } from './TaskCard';

export type BoardStatus = NonNullable<BoardQuery['project']>['statuses'][number];

export function BoardColumn({
  status,
  total,
  filter,
  canEdit,
}: {
  status: BoardStatus;
  /** Matching tasks in this column (from the summary), which can exceed what's loaded. */
  total: number | undefined;
  filter: TaskFilter | null;
  canEdit: boolean;
}) {
  const client = useApolloClient();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status.id}`,
    data: { type: 'column', statusId: status.id },
    disabled: !canEdit,
  });

  // De-duplicate defensively: a card dropped at the end of a partially loaded
  // column can also arrive in the next page.
  const tasks = useMemo(() => {
    const seen = new Set<string>();
    return status.tasks.edges
      .map((edge) => edge.node)
      .filter(
        (task): task is TaskCardFieldsFragment => !seen.has(task.id) && Boolean(seen.add(task.id)),
      );
  }, [status.tasks.edges]);
  const ids = useMemo(() => tasks.map((task) => task.id), [tasks]);

  async function loadMore() {
    setLoadingMore(true);
    setLoadError(null);
    try {
      await client.query({
        query: ColumnMoreQuery,
        variables: {
          statusId: status.id,
          filter,
          pageSize: PAGE_SIZE,
          after: status.tasks.pageInfo.endCursor,
        },
        fetchPolicy: 'network-only',
      });
    } catch (error) {
      setLoadError(describeError(error));
    } finally {
      setLoadingMore(false);
    }
  }

  const headingId = `column-${status.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-surface-2"
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2.5 rounded-full" style={{ background: status.color }} aria-hidden />
        <h2 id={headingId} className="text-sm font-medium">
          {status.name}
        </h2>
        <span
          className="text-xs text-ink-2 tabular-nums"
          aria-label={`${total ?? tasks.length} tasks`}
        >
          {(total ?? tasks.length).toLocaleString()}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={cx(
          'min-h-24 flex-1 overflow-y-auto rounded-md px-2 pb-2 transition-colors',
          isOver && 'bg-accent/10 ring-2 ring-accent/40 ring-inset',
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {tasks.map((task) => (
              <SortableTaskCard key={task.id} task={task} statusId={status.id} canEdit={canEdit} />
            ))}
          </ol>
        </SortableContext>

        {tasks.length === 0 && <p className="py-8 text-center text-xs text-muted">No tasks</p>}

        {status.tasks.pageInfo.hasNextPage && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 hover:border-line-strong disabled:opacity-60"
          >
            {loadingMore
              ? 'Loading…'
              : `Load more${total ? ` (${total - tasks.length} more)` : ''}`}
          </button>
        )}
        {loadError && (
          <p role="alert" className="mt-2 text-xs text-ink">
            {loadError}
          </p>
        )}
      </div>
    </section>
  );
}
