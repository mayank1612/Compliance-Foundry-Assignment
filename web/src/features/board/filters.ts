/**
 * filters.ts — the board's filters: URL ⇄ UI state ⇄ GraphQL `TaskFilter`.
 *
 * Pure functions (unit-tested in filters.test.ts) plus one hook. The URL is the
 * single source of truth (see lib/useSearchParams.ts):
 *   ?assignee=<id>,<id>,none&priority=URGENT,HIGH&label=<id>&from=2026-11-01&to=…&overdue=1
 * Unknown or malformed values are dropped, never sent to the API.
 */
import { useCallback, useMemo } from 'react';
import type { TaskFilter, TaskPriority } from '../../gql/graphql';
import { useSearchParams } from '../../lib/useSearchParams';

export interface BoardFilters {
  assigneeIds: string[];
  /** "Unassigned" is a choice in the assignee filter (stored as `none` in the URL). */
  includeUnassigned: boolean;
  priorities: TaskPriority[];
  labelIds: string[];
  dueFrom: string | null;
  dueTo: string | null;
  overdue: boolean;
}

export const NO_FILTERS: BoardFilters = {
  assigneeIds: [],
  includeUnassigned: false,
  priorities: [],
  labelIds: [],
  dueFrom: null,
  dueTo: null,
  overdue: false,
};

/** Most urgent first — the order the UI lists them in. */
export const PRIORITIES: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];

const UNASSIGNED = 'none';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const list = (value: string | null) => (value ? value.split(',').filter(Boolean) : []);

export function filtersFromParams(params: URLSearchParams): BoardFilters {
  const assignees = list(params.get('assignee'));
  const from = params.get('from');
  const to = params.get('to');
  return {
    assigneeIds: assignees.filter((id) => UUID.test(id)),
    includeUnassigned: assignees.includes(UNASSIGNED),
    priorities: list(params.get('priority')).filter((p): p is TaskPriority =>
      PRIORITIES.includes(p as TaskPriority),
    ),
    labelIds: list(params.get('label')).filter((id) => UUID.test(id)),
    dueFrom: from && ISO_DATE.test(from) ? from : null,
    dueTo: to && ISO_DATE.test(to) ? to : null,
    overdue: params.get('overdue') === '1',
  };
}

/** Writes only non-default filters, in a stable order, so equal filters = equal URLs. */
export function writeFilters(params: URLSearchParams, filters: BoardFilters): void {
  const set = (key: string, values: string[]) => {
    if (values.length > 0) params.set(key, [...values].sort().join(','));
    else params.delete(key);
  };
  set('assignee', [...filters.assigneeIds, ...(filters.includeUnassigned ? [UNASSIGNED] : [])]);
  set('priority', filters.priorities);
  set('label', filters.labelIds);
  set('from', filters.dueFrom ? [filters.dueFrom] : []);
  set('to', filters.dueTo ? [filters.dueTo] : []);
  set('overdue', filters.overdue ? ['1'] : []);
}

export function isFiltered(filters: BoardFilters): boolean {
  return (
    filters.assigneeIds.length > 0 ||
    filters.includeUnassigned ||
    filters.priorities.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.dueFrom !== null ||
    filters.dueTo !== null ||
    filters.overdue
  );
}

/**
 * UI filters → the API's TaskFilter. `null` when nothing is filtered, so the
 * unfiltered board always has the same query variables (and cache entry).
 */
export function toTaskFilter(filters: BoardFilters): TaskFilter | null {
  if (!isFiltered(filters)) return null;
  return {
    ...(filters.assigneeIds.length ? { assigneeIds: filters.assigneeIds } : {}),
    ...(filters.includeUnassigned ? { includeUnassigned: true } : {}),
    ...(filters.priorities.length ? { priorities: filters.priorities } : {}),
    ...(filters.labelIds.length ? { labelIds: filters.labelIds } : {}),
    ...(filters.dueFrom || filters.dueTo
      ? { dueDate: { from: filters.dueFrom, to: filters.dueTo } }
      : {}),
    ...(filters.overdue ? { overdue: true } : {}),
  };
}

/** The board's filters, read from and written to the URL. */
export function useBoardFilters() {
  const [params, update] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);

  const setFilters = useCallback(
    (change: Partial<BoardFilters>) => {
      update((next) => {
        writeFilters(next, { ...filtersFromParams(next), ...change });
      });
    },
    [update],
  );

  const clearFilters = useCallback(() => {
    update((next) => {
      writeFilters(next, NO_FILTERS);
    });
  }, [update]);

  return { filters, setFilters, clearFilters, filtered: isFiltered(filters) };
}
