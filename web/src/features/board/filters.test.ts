/**
 * filters.test.ts — URL ⇄ filters ⇄ GraphQL TaskFilter (pure functions).
 */
import { describe, expect, it } from 'vitest';
import { filtersFromParams, isFiltered, NO_FILTERS, toTaskFilter, writeFilters } from './filters';

const UUID_A = '01a1ed8d-be52-7005-96a9-1d53c9eb559a';
const UUID_B = '01a1ed8d-be52-7005-96a9-1d53c9eb559b';

describe('board filters', () => {
  it('round-trips through the URL in a stable order', () => {
    const params = new URLSearchParams('project=p1');
    writeFilters(params, {
      ...NO_FILTERS,
      assigneeIds: [UUID_B, UUID_A],
      includeUnassigned: true,
      priorities: ['URGENT', 'HIGH'],
      dueFrom: '2026-11-01',
      overdue: true,
    });
    // project untouched; lists sorted so equal filters give equal (cacheable, shareable) URLs
    expect(params.toString()).toBe(
      `project=p1&assignee=${UUID_A}%2C${UUID_B}%2Cnone&priority=HIGH%2CURGENT&from=2026-11-01&overdue=1`,
    );
    expect(filtersFromParams(params)).toEqual({
      ...NO_FILTERS,
      assigneeIds: [UUID_A, UUID_B],
      includeUnassigned: true,
      priorities: ['HIGH', 'URGENT'],
      dueFrom: '2026-11-01',
      overdue: true,
    });
  });

  it('drops malformed values instead of sending them to the API', () => {
    const filters = filtersFromParams(
      new URLSearchParams(
        'assignee=not-a-uuid&priority=HIGH,SUPER&from=yesterday&label=x&overdue=yes',
      ),
    );
    expect(filters).toEqual({ ...NO_FILTERS, priorities: ['HIGH'] });
  });

  it('maps to the GraphQL TaskFilter, and to null when nothing is filtered', () => {
    expect(toTaskFilter(NO_FILTERS)).toBeNull();
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(
      toTaskFilter({
        ...NO_FILTERS,
        includeUnassigned: true,
        dueTo: '2026-12-31',
        labelIds: [UUID_A],
      }),
    ).toEqual({
      includeUnassigned: true,
      labelIds: [UUID_A],
      dueDate: { from: null, to: '2026-12-31' },
    });
  });

  it('clearing removes every filter key and nothing else', () => {
    const params = new URLSearchParams(`project=p1&priority=HIGH&overdue=1&label=${UUID_A}`);
    writeFilters(params, NO_FILTERS);
    expect(params.toString()).toBe('project=p1');
  });
});
