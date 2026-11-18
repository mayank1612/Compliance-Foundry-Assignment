/**
 * FilterBar.tsx — assignee, priority, label, due-date and overdue filters.
 *
 * Controlled by the URL (filters.ts): every change is a new history entry, so the
 * Back button undoes it and the filtered board is a shareable link. Filters apply to
 * the columns AND the summary/chart, which always describe what's on screen.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDownIcon, CloseIcon } from '../../components/icons';
import type { BoardQuery, TaskPriority } from '../../gql/graphql';
import { cx } from '../../lib/cx';
import { PRIORITIES, type BoardFilters } from './filters';

type Organization = NonNullable<BoardQuery['project']>['organization'];

const PRIORITY_SHORT: Record<TaskPriority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  NONE: 'None',
};

interface Option {
  value: string;
  label: string;
  swatch?: string;
}

/** A button + checkbox list; closes on outside click or Escape. */
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className={cx(
          'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm',
          selected.length > 0
            ? 'border-accent text-ink'
            : 'border-line-strong text-ink-2 hover:text-ink',
        )}
      >
        {label}
        {selected.length > 0 && (
          <span className="rounded bg-accent/15 px-1 text-xs tabular-nums">{selected.length}</span>
        )}
        <ChevronDownIcon className="size-3.5" />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => {
                  toggle(option.value);
                }}
                className="accent-accent"
              />
              {option.swatch && (
                <span
                  className="size-2 rounded-full"
                  style={{ background: option.swatch }}
                  aria-hidden
                />
              )}
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterBar({
  organization,
  filters,
  filtered,
  updating,
  onChange,
  onClear,
}: {
  organization: Organization;
  filters: BoardFilters;
  filtered: boolean;
  updating: boolean;
  onChange: (change: Partial<BoardFilters>) => void;
  onClear: () => void;
}) {
  const assigneeOptions: Option[] = [
    { value: 'none', label: 'Unassigned' },
    ...organization.members.edges
      .map((edge) => ({ value: edge.node.user.id, label: edge.node.user.displayName }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const labelOptions: Option[] = organization.labels.map((label) => ({
    value: label.id,
    label: label.name,
    swatch: label.color,
  }));

  return (
    <div role="toolbar" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <MultiSelect
        label="Assignee"
        options={assigneeOptions}
        selected={[...filters.assigneeIds, ...(filters.includeUnassigned ? ['none'] : [])]}
        onChange={(values) => {
          onChange({
            assigneeIds: values.filter((value) => value !== 'none'),
            includeUnassigned: values.includes('none'),
          });
        }}
      />

      <div
        role="group"
        aria-label="Priority"
        className="inline-flex overflow-hidden rounded-md border border-line-strong"
      >
        {PRIORITIES.map((priority) => {
          const pressed = filters.priorities.includes(priority);
          return (
            <button
              key={priority}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                onChange({
                  priorities: pressed
                    ? filters.priorities.filter((p) => p !== priority)
                    : [...filters.priorities, priority],
                });
              }}
              className={cx(
                'border-l border-line px-2.5 py-1.5 text-sm first:border-l-0',
                pressed ? 'bg-accent/15 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              )}
            >
              {PRIORITY_SHORT[priority]}
            </button>
          );
        })}
      </div>

      <MultiSelect
        label="Label"
        options={labelOptions}
        selected={filters.labelIds}
        onChange={(labelIds) => {
          onChange({ labelIds });
        }}
      />

      <div className="inline-flex items-center gap-1.5 text-sm text-ink-2">
        <label className="inline-flex items-center gap-1.5">
          Due
          <input
            type="date"
            aria-label="Due from"
            value={filters.dueFrom ?? ''}
            max={filters.dueTo ?? undefined}
            onChange={(event) => {
              onChange({ dueFrom: event.target.value || null });
            }}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-ink"
          />
        </label>
        <span aria-hidden>–</span>
        <input
          type="date"
          aria-label="Due to"
          value={filters.dueTo ?? ''}
          min={filters.dueFrom ?? undefined}
          onChange={(event) => {
            onChange({ dueTo: event.target.value || null });
          }}
          className="rounded-md border border-line-strong bg-surface px-2 py-1 text-ink"
        />
      </div>

      <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink-2">
        <input
          type="checkbox"
          checked={filters.overdue}
          onChange={(event) => {
            onChange({ overdue: event.target.checked });
          }}
          className="accent-accent"
        />
        Overdue only
      </label>

      {filtered && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <CloseIcon className="size-3.5" /> Clear filters
        </button>
      )}

      <span role="status" className="ml-auto text-xs text-ink-2">
        {updating ? 'Updating…' : ''}
      </span>
    </div>
  );
}
