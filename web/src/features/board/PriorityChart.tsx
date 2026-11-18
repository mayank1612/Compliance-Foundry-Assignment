/**
 * PriorityChart.tsx — "Tasks by priority": the board's data visualization.
 *
 * Form (dataviz method): ONE series (task count) over five ordered categories →
 * horizontal bars, one hue, each row = name + bar + figure. No legend (the title
 * names the single series); value at each bar tip; no axis line or grid (every
 * value is labelled, so they'd be ink without information).
 * Marks: 16px bars (≤ 24px cap), 4px rounded data-end, square at the baseline.
 * Color: the validated series blue (`--series-1`, light and dark steps checked for
 * contrast/lightness on their surfaces). Text uses ink tokens, never the bar color.
 * Interaction: hovering a row shows count + share; screen readers get a table.
 */
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TaskPriority } from '../../gql/graphql';
import { PRIORITIES } from './filters';

const LABELS: Record<TaskPriority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  NONE: 'No priority',
};

interface Row {
  label: string;
  count: number;
}

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';

function RowTooltip({
  active,
  row,
  total,
}: {
  active: boolean;
  row: Row | undefined;
  total: number;
}) {
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md">
      <div className="flex items-center gap-1.5">
        <span className="size-2 rounded-sm bg-series" aria-hidden />
        <span className="font-medium text-ink">{row.label}</span>
      </div>
      <div className="mt-0.5 text-ink-2">
        {row.count} tasks · {percent(row.count, total)}
      </div>
    </div>
  );
}

export function PriorityChart({
  data,
}: {
  data: readonly { priority: TaskPriority; count: number }[];
}) {
  const rows: Row[] = PRIORITIES.map((priority) => ({
    label: LABELS[priority],
    count: data.find((entry) => entry.priority === priority)?.count ?? 0,
  }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <figure className="rounded-lg border border-line bg-surface p-4">
      <figcaption>
        <span className="block text-sm font-medium">Tasks by priority</span>
        <span className="block text-xs text-ink-2">
          {total.toLocaleString()} tasks matching the current filters
        </span>
      </figcaption>

      {/* The chart is for sighted users; the table below carries the same numbers. */}
      <div className="mt-3 h-40" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 44, bottom: 0, left: 0 }}
            barCategoryGap={6}
          >
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis
              type="category"
              dataKey="label"
              width={84}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--ink-2)', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              isAnimationActive={false}
              content={({ active, payload }) => (
                <RowTooltip
                  active={active}
                  row={payload[0]?.payload as Row | undefined}
                  total={total}
                />
              )}
            />
            <Bar
              dataKey="count"
              fill="var(--series-1)"
              barSize={16}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList dataKey="count" position="right" fill="var(--ink-2)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>Tasks by priority</caption>
        <thead>
          <tr>
            <th scope="col">Priority</th>
            <th scope="col">Tasks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
