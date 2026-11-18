/**
 * SummaryPanel.tsx — headline numbers + the priority chart, for the filtered board.
 *
 * Data: the `BoardSummary` query (one GROUPING SETS pass on the server). It is a
 * separate query from the board on purpose: after a drag-and-drop move only this
 * small query is refetched, never the columns.
 * Tiles: label · value · one line of context. "Overdue" carries the reserved status
 * color as an icon next to its label — the number itself stays in ink.
 */
import { lazy, Suspense } from 'react';
import { AlertIcon } from '../../components/icons';
import type { BoardSummaryQuery } from '../../gql/graphql';
import { cx } from '../../lib/cx';

// Code-split: Recharts is most of the bundle and the chart isn't needed to show the
// board, so the columns render first and the chart's code arrives in parallel.
const PriorityChart = lazy(() =>
  import('./PriorityChart').then((module) => ({ default: module.PriorityChart })),
);

export type TaskSummary = NonNullable<BoardSummaryQuery['project']>['taskSummary'];

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const format = (value: number) =>
  value >= 10_000 ? compact.format(value) : value.toLocaleString();
const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';

function StatTile({
  label,
  value,
  detail,
  critical = false,
}: {
  label: string;
  value: number;
  detail: string;
  critical?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-1.5 text-sm text-ink-2">
        {critical && <AlertIcon className="size-4 text-critical" />}
        {label}
      </div>
      <div className={cx('mt-1 text-2xl font-semibold', critical && 'text-ink')}>
        {format(value)}
      </div>
      <div className="mt-0.5 text-xs text-ink-2">{detail}</div>
    </div>
  );
}

export function SummaryPanel({ summary }: { summary: TaskSummary | undefined }) {
  if (!summary) {
    return (
      <div
        role="status"
        aria-label="Loading summary"
        className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
      >
        <div className="grid grid-cols-2 grid-rows-2 gap-3">
          {[0, 1, 2, 3].map((tile) => (
            <div
              key={tile}
              className="h-[5.5rem] animate-pulse rounded-lg border border-line bg-surface"
            />
          ))}
        </div>
        <div className="h-[5.5rem] animate-pulse rounded-lg border border-line bg-surface" />
      </div>
    );
  }

  const countWhere = (categories: string[]) =>
    summary.byStatus
      .filter((entry) => categories.includes(entry.status.category))
      .reduce((sum, entry) => sum + entry.count, 0);
  const open = countWhere(['BACKLOG', 'UNSTARTED', 'STARTED']);
  const completed = countWhere(['COMPLETED']);
  const unassigned = summary.byAssignee.find((entry) => entry.assignee === null)?.count ?? 0;

  return (
    <section
      aria-label="Board summary"
      className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
    >
      <div className="grid grid-cols-2 grid-rows-2 gap-3">
        <StatTile label="Total tasks" value={summary.total} detail={`${format(open)} open`} />
        <StatTile
          label="Overdue"
          value={summary.overdue}
          critical={summary.overdue > 0}
          detail={open > 0 ? `${percent(summary.overdue, open)} of open tasks` : 'No open tasks'}
        />
        <StatTile
          label="Completed"
          value={completed}
          detail={`${percent(completed, summary.total)} of all tasks`}
        />
        <StatTile
          label="Unassigned"
          value={unassigned}
          detail={`${percent(unassigned, summary.total)} of all tasks`}
        />
      </div>
      <Suspense
        fallback={<div className="h-56 animate-pulse rounded-lg border border-line bg-surface" />}
      >
        <PriorityChart data={summary.byPriority} />
      </Suspense>
    </section>
  );
}
