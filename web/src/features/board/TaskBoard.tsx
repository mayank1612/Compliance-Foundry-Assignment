/**
 * TaskBoard.tsx — the Task Board feature (Task 2.2's main component).
 *
 * Architecture: this is the one container component. It owns
 *   * the URL-backed filters (useBoardFilters),
 *   * two queries: `Board` (columns + first page of cards) and `BoardSummary`
 *     (counts + chart data), both with the same filter,
 *   * the drag-and-drop move (useMoveTask: optimistic, cache-local).
 * Everything below it (FilterBar, SummaryPanel, Board → BoardColumn → TaskCard) is
 * presentational: props in, callbacks out. The only state they keep is UI state
 * (an open dropdown, a card being dragged, a "load more" spinner).
 *
 * States: skeleton while the first load runs; while filters change, the previous
 * board stays on screen dimmed with "Updating…" (no flash of empty columns); a
 * retryable error state; and two empty states — "no tasks yet" vs "no tasks match
 * these filters" (with Clear filters).
 */
import { useQuery } from '@apollo/client/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CloseIcon } from '../../components/icons';
import { BoardSkeleton, EmptyState, ErrorState } from '../../components/states';
import type { TaskCardFieldsFragment } from '../../gql/graphql';
import { cx } from '../../lib/cx';
import { describeError, errorCode } from '../../lib/errors';
import { Board } from './Board';
import { BoardQuery, BoardSummaryQuery, PAGE_SIZE } from './documents';
import { FilterBar } from './FilterBar';
import { toTaskFilter, useBoardFilters } from './filters';
import { useMoveTask, type MoveTarget } from './moveTask';
import { SummaryPanel } from './SummaryPanel';

export function TaskBoard({ projectId }: { projectId: string }) {
  const { filters, setFilters, clearFilters, filtered } = useBoardFilters();
  const filter = useMemo(() => toTaskFilter(filters), [filters]);

  const board = useQuery(BoardQuery, { variables: { projectId, filter, pageSize: PAGE_SIZE } });
  const summary = useQuery(BoardSummaryQuery, { variables: { projectId, filter } });
  const moveTask = useMoveTask();
  const { refetch: refetchBoard } = board;

  // Keep showing the previous result while new variables load (no flash).
  const project = (board.data ?? board.previousData)?.project;
  const taskSummary = (summary.data ?? summary.previousData)?.project?.taskSummary;
  const counts = useMemo(
    () =>
      taskSummary
        ? new Map(taskSummary.byStatus.map((entry) => [entry.status.id, entry.count]))
        : undefined,
    [taskSummary],
  );

  // A failed move: the optimistic card already snapped back; say why. On CONFLICT
  // (someone else reordered that column) reload the columns to show the truth.
  const [notice, setNotice] = useState<string | null>(null);
  const handleMove = useCallback(
    async (task: TaskCardFieldsFragment, target: MoveTarget) => {
      try {
        await moveTask(task, target);
      } catch (error) {
        setNotice(describeError(error));
        if (errorCode(error) === 'CONFLICT') await refetchBoard();
      }
    },
    [moveTask, refetchBoard],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice(null);
    }, 6000);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  // ---- first load / failure / no access -------------------------------------------
  if (board.error && !project) {
    return (
      <ErrorState
        title="The board could not be loaded"
        message={describeError(board.error)}
        onRetry={() => void refetchBoard()}
      />
    );
  }
  if (!project) {
    if (board.loading) return <BoardSkeleton />;
    return (
      <EmptyState
        title="Project not available"
        message="It may have been removed, or you are not a member of its organization."
      />
    );
  }

  const canEdit = project.organization.viewerRole !== 'VIEWER';
  const isEmpty = project.statuses.every((status) => status.tasks.edges.length === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">{project.name}</h1>
        <span className="text-sm text-ink-2">{project.key}</span>
        {!canEdit && (
          <span className="rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink-2">
            View only — your role can't move tasks
          </span>
        )}
      </div>

      <FilterBar
        organization={project.organization}
        filters={filters}
        filtered={filtered}
        updating={board.loading || summary.loading}
        onChange={setFilters}
        onClear={clearFilters}
      />

      {summary.error && !taskSummary ? (
        <p role="alert" className="text-sm text-ink-2">
          Summary unavailable: {describeError(summary.error)}
        </p>
      ) : (
        <SummaryPanel summary={taskSummary} />
      )}

      {(notice ??
        (board.error && 'The board could not be refreshed. Showing the last loaded data.')) && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
        >
          <span>{notice ?? 'The board could not be refreshed. Showing the last loaded data.'}</span>
          {notice && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setNotice(null);
              }}
              className="rounded p-1 hover:bg-surface-2"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      )}

      {isEmpty ? (
        filtered ? (
          <EmptyState
            title="No tasks match these filters"
            message="Try removing a filter to see more of the board."
            action={
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-2"
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState title="No tasks yet" message="This project doesn't have any tasks." />
        )
      ) : (
        <div
          aria-busy={board.loading}
          className={cx('transition-opacity', board.loading && 'opacity-60')}
        >
          <Board
            statuses={project.statuses}
            counts={counts}
            filter={filter}
            canEdit={canEdit}
            onMove={(task, target) => void handleMove(task, target)}
          />
        </div>
      )}
    </div>
  );
}
