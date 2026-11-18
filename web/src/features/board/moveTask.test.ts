/**
 * moveTask.test.ts — drop position maths + the optimistic cache update, against a
 * REAL Apollo cache configured exactly like the app's (apollo/cache.ts).
 */
import { describe, expect, it } from 'vitest';
import { createCache } from '../../apollo/cache';
import { boardResult, PROJECT_ID, STATUS_IDS, task } from '../../test/fixtures';
import { BoardQuery } from './documents';
import { applyMoveToCache, insertionIndex, neighboursAt } from './moveTask';

describe('neighboursAt', () => {
  const column = ['a', 'b', 'c', 'd'];
  it('computes the cards above and below the drop slot (dragged card excluded)', () => {
    expect(neighboursAt(column, 'x', 0)).toEqual({ afterTaskId: null, beforeTaskId: 'a' });
    expect(neighboursAt(column, 'x', 2)).toEqual({ afterTaskId: 'b', beforeTaskId: 'c' });
    expect(neighboursAt(column, 'x', 99)).toEqual({ afterTaskId: 'd', beforeTaskId: null });
  });
  it('matches arrayMove semantics within a column', () => {
    // a dropped on c (moving down) lands after c; d dropped on b (moving up) lands before b
    expect(neighboursAt(column, 'a', 2)).toEqual({ afterTaskId: 'c', beforeTaskId: 'd' });
    expect(neighboursAt(column, 'd', 1)).toEqual({ afterTaskId: 'a', beforeTaskId: 'b' });
  });
  it('inserts after "after", else before "before", else at the end', () => {
    const target = { toStatusId: 's' };
    expect(insertionIndex(['a', 'b'], { ...target, afterTaskId: 'a', beforeTaskId: 'b' })).toBe(1);
    expect(insertionIndex(['a', 'b'], { ...target, afterTaskId: null, beforeTaskId: 'a' })).toBe(0);
    expect(insertionIndex(['a', 'b'], { ...target, afterTaskId: 'gone', beforeTaskId: null })).toBe(
      2,
    );
  });
});

describe('applyMoveToCache', () => {
  const variables = { projectId: PROJECT_ID, filter: null, pageSize: 25 } as const;
  const columnIds = (
    cache: ReturnType<typeof createCache>,
    vars:
      | typeof variables
      | { projectId: string; filter: { priorities: ['URGENT'] }; pageSize: number },
  ) => {
    const data = cache.readQuery({ query: BoardQuery, variables: vars });
    return Object.fromEntries(
      (data?.project?.statuses ?? []).map((status) => [
        status.name,
        status.tasks.edges.map((edge) => edge.node.title),
      ]),
    );
  };

  it('moves a card between columns at the right position, without touching other cards', () => {
    const cache = createCache();
    cache.writeQuery({ query: BoardQuery, variables, data: boardResult() });
    const fixLogin = boardResult().project?.statuses[0]?.tasks.edges[0]?.node;
    if (!fixLogin) throw new Error('fixture missing');

    applyMoveToCache(cache, {
      taskId: fixLogin.id,
      fromStatusId: STATUS_IDS.todo,
      toStatusId: STATUS_IDS.doing,
      afterTaskId: null,
      beforeTaskId: '0000000000-0000-7000-8000-000000000021', // above "Design dark mode"
    });

    expect(columnIds(cache, variables)).toEqual({
      Todo: ['Write release notes'],
      'In Progress': ['Fix login flow', 'Design dark mode'],
      Done: [],
    });
  });

  it('only adds the card to filtered views that contained it', () => {
    const cache = createCache();
    cache.writeQuery({ query: BoardQuery, variables, data: boardResult() });
    // A cached "URGENT only" view in which the moved card does NOT appear.
    const urgentOnly = {
      projectId: PROJECT_ID,
      filter: { priorities: ['URGENT'] as ['URGENT'] },
      pageSize: 25,
    };
    const other = boardResult();
    for (const status of other.project?.statuses ?? []) {
      status.tasks.edges = status.tasks.edges.filter((edge) => edge.node.priority === 'URGENT');
    }
    cache.writeQuery({ query: BoardQuery, variables: urgentOnly, data: other });

    const writeNotes = task('0000000000-0000-7000-8000-000000000012', STATUS_IDS.todo);
    applyMoveToCache(cache, {
      taskId: writeNotes.id,
      fromStatusId: STATUS_IDS.todo,
      toStatusId: STATUS_IDS.done,
      afterTaskId: null,
      beforeTaskId: null,
    });

    expect(columnIds(cache, variables).Done).toEqual(['Write release notes']); // moved here
    expect(columnIds(cache, urgentOnly)).toEqual({
      Todo: ['Fix login flow'],
      'In Progress': [],
      Done: [],
    }); // untouched
  });
});
