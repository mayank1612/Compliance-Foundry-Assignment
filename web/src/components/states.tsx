/**
 * states.tsx — the three non-happy states every data view needs.
 *
 *   BoardSkeleton — loading: the board's shape in grey, so the layout doesn't jump
 *                   when data arrives; announced to screen readers as busy.
 *   ErrorState    — a failure with a plain-language reason and a Retry action.
 *   EmptyState    — nothing to show, with the next useful action (e.g. clear filters).
 */
import type { ReactNode } from 'react';
import { AlertIcon, BoardIcon, RefreshIcon } from './icons';

export function BoardSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading board"
      className="flex gap-3 overflow-hidden"
    >
      {Array.from({ length: columns }, (_, column) => (
        <div key={column} className="w-72 shrink-0 rounded-lg bg-surface-2 p-2">
          <div className="mb-3 h-4 w-24 animate-pulse rounded bg-line" />
          {Array.from({ length: 4 - (column % 3) }, (_, card) => (
            <div
              key={card}
              className="mb-2 h-20 animate-pulse rounded-md border border-line bg-surface"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto mt-12 max-w-md rounded-lg border border-line bg-surface p-6 text-center"
    >
      <AlertIcon className="mx-auto size-6 text-critical" />
      <h2 className="mt-3 font-medium">{title}</h2>
      <p className="mt-1 text-sm text-ink-2">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          <RefreshIcon /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto mt-12 max-w-md rounded-lg border border-dashed border-line-strong p-8 text-center">
      <BoardIcon className="mx-auto size-6 text-muted" />
      <h2 className="mt-3 font-medium">{title}</h2>
      <p className="mt-1 text-sm text-ink-2">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
