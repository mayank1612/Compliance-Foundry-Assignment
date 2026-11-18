/**
 * TaskBoard.test.tsx — the board's states, rendered with Apollo's MockedProvider
 * and the app's real cache configuration.
 *
 * Covers: loading skeleton → columns, cards and summary; a failed load with Retry;
 * the two empty states (no tasks vs. no matches, with Clear filters); and the
 * read-only badge for viewers.
 */
import type { MockLink } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createCache } from '../../apollo/cache';
import { boardResult, PROJECT_ID, summaryResult } from '../../test/fixtures';
import { BoardQuery, BoardSummaryQuery, PAGE_SIZE } from './documents';
import { TaskBoard } from './TaskBoard';

const LABEL_ID = '01a1ed8d-be52-7005-96a9-00000000beef';

function boardMock(
  filter: object | null,
  data: ReturnType<typeof boardResult>,
): MockLink.MockedResponse {
  return {
    request: {
      query: BoardQuery,
      variables: { projectId: PROJECT_ID, filter, pageSize: PAGE_SIZE },
    },
    result: { data },
  };
}
function summaryMock(
  filter: object | null,
  data: ReturnType<typeof summaryResult>,
): MockLink.MockedResponse {
  return {
    request: { query: BoardSummaryQuery, variables: { projectId: PROJECT_ID, filter } },
    result: { data },
  };
}

function renderBoard(mocks: MockLink.MockedResponse[]) {
  return render(
    <MockedProvider mocks={mocks} cache={createCache()}>
      <TaskBoard projectId={PROJECT_ID} />
    </MockedProvider>,
  );
}

describe('<TaskBoard />', () => {
  it('shows a skeleton, then the columns, cards and summary', async () => {
    renderBoard([boardMock(null, boardResult()), summaryMock(null, summaryResult())]);

    expect(screen.getByRole('status', { name: 'Loading board' })).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Website Relaunch' })).toBeInTheDocument();
    const todo = screen.getByRole('region', { name: 'Todo' });
    expect(within(todo).getByRole('article', { name: /Fix login flow/ })).toBeInTheDocument();
    expect(within(todo).getByText('Overdue ·')).toBeInTheDocument(); // icon + text, not color alone
    expect(within(todo).getByRole('img', { name: 'Priority: Urgent' })).toBeInTheDocument();

    const summary = await screen.findByRole('region', { name: 'Board summary' });
    expect(within(summary).getByText('Total tasks').parentElement).toHaveTextContent('3');
    expect(within(summary).getByText('Overdue').parentElement).toHaveTextContent('1');
    // The chart's numbers are available as a table for screen readers.
    const table = await within(summary).findByRole('table', { name: 'Tasks by priority' }); // lazy-loaded chart
    expect(within(table).getByRole('row', { name: 'Medium 2' })).toBeInTheDocument();
  });

  it('shows an error with Retry, and recovers', async () => {
    const user = userEvent.setup();
    renderBoard([
      { request: boardMock(null, boardResult()).request, error: new Error('connection refused') },
      boardMock(null, boardResult()),
      summaryMock(null, summaryResult()),
    ]);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The board could not be loaded');
    expect(alert).toHaveTextContent('Cannot reach the API');

    await user.click(within(alert).getByRole('button', { name: /Retry/ }));
    expect(await screen.findByRole('heading', { name: 'Website Relaunch' })).toBeInTheDocument();
  });

  it('distinguishes an empty project from filters that match nothing', async () => {
    renderBoard([
      boardMock(null, boardResult({ empty: true })),
      summaryMock(null, summaryResult({ empty: true })),
    ]);
    expect(await screen.findByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers to clear filters that match nothing, and clearing restores the board', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/?label=${LABEL_ID}`);
    const filter = { labelIds: [LABEL_ID] };
    renderBoard([
      boardMock(filter, boardResult({ empty: true })),
      summaryMock(filter, summaryResult({ empty: true })),
      boardMock(null, boardResult()),
      summaryMock(null, summaryResult()),
    ]);

    const empty = await screen.findByRole('heading', { name: 'No tasks match these filters' });
    await user.click(
      within(empty.parentElement as HTMLElement).getByRole('button', { name: 'Clear filters' }),
    );

    expect(window.location.search).toBe('');
    expect(await screen.findByRole('region', { name: 'Todo' })).toBeInTheDocument();
  });

  it('marks the board read-only for viewers', async () => {
    renderBoard([
      boardMock(null, boardResult({ viewerRole: 'VIEWER' })),
      summaryMock(null, summaryResult()),
    ]);
    expect(await screen.findByText(/View only/)).toBeInTheDocument();
  });
});
