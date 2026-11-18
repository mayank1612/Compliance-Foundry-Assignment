/**
 * graphql.test.ts — the Task Board API (Task 2.1) end to end, in-process.
 *
 * Every assertion compares the API with ground truth computed by direct SQL as the
 * schema owner, on a seeded database (400-task "Website Relaunch" project).
 * Covers: authentication, tenant isolation, N+1 (query counting), keyset
 * pagination (incl. NULLS LAST), filter semantics, the one-pass summary, moveTask
 * (positioning, history, authorization, stale boards), and input limits.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';

let t: TestApp;
let web: string; // the large project
const statusId: Record<string, string> = {}; // WEB column name → id

beforeAll(async () => {
  t = await createTestApp();
  web = t.seed.projects.WEB!;
  for (const row of await t.ownerQuery<{ id: string; name: string }>(
    'SELECT id, name FROM task_statuses WHERE project_id = $1',
    web,
  )) {
    statusId[row.name] = row.id;
  }
});
afterAll(async () => {
  await t.close();
});

/** Ground truth: ids of a column in board order. */
const columnOrder = async (status: string) =>
  (
    await t.ownerQuery<{ id: string }>(
      'SELECT id FROM tasks WHERE status_id = $1 AND deleted_at IS NULL ORDER BY rank, id',
      statusId[status],
    )
  ).map((row) => row.id);

const codeOf = (response: { errors?: { extensions?: { code?: string } }[] }) =>
  response.errors?.[0]?.extensions?.code;

interface TaskPage {
  edges: { cursor: string; node: { id: string } }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

describe('authentication and tenant isolation', () => {
  it('requires a token for everything except introspection', async () => {
    expect(codeOf(await t.gql(null, '{ viewer { user { id } } }'))).toBe('UNAUTHENTICATED');
    expect((await t.gql(null, '{ __typename }')).data).toEqual({ __typename: 'Query' });

    const forged = await t.app.fetch('http://test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ query: '{ viewer { user { id } } }' }),
    });
    expect(forged.status).toBe(401);
  });

  it("returns the viewer's memberships with per-organization roles", async () => {
    const response = await t.gql<{
      viewer: {
        user: { displayName: string };
        memberships: { role: string; organization: { slug: string } }[];
      };
    }>('grace', '{ viewer { user { displayName } memberships { role organization { slug } } } }');
    expect(response.data?.viewer.user.displayName).toBe('Grace Kim');
    expect(
      response.data?.viewer.memberships.map((m) => `${m.organization.slug}:${m.role}`).sort(),
    ).toEqual(['acme:MEMBER', 'globex:ADMIN']);
  });

  it("never shows one tenant's data to another — not even that it exists", async () => {
    const [webTask] = await t.ownerQuery<{ id: string }>(
      'SELECT id FROM tasks WHERE project_id = $1 LIMIT 1',
      web,
    );
    const response = await t.gql<{ project: unknown; task: unknown; organization: unknown }>(
      'frank', // Globex owner, not an Acme member
      `query ($p: ID!, $t: ID!) { project(id: $p) { id } task(id: $t) { id } organization(slug: "acme") { id } }`,
      { p: web, t: webTask!.id },
    );
    expect(response.data).toEqual({ project: null, task: null, organization: null });

    const move = await t.gql(
      'frank',
      `mutation ($id: ID!, $s: ID!) { moveTask(input: { id: $id, statusId: $s }) { task { id } } }`,
      {
        id: webTask!.id,
        s: statusId.Done,
      },
    );
    expect(codeOf(move)).toBe('NOT_FOUND');
  });
});

describe('board queries', () => {
  const BOARD = `
    query Board($p: ID!, $first: Int!) {
      project(id: $p) {
        statuses {
          id
          tasks(first: $first) {
            pageInfo { hasNextPage endCursor }
            edges { node { id identifier title priority dueDate isOverdue
                           assignee { id displayName } labels { id name } status { id name } } }
          }
        }
        taskSummary { total overdue byPriority { priority count } byAssignee { assignee { id } count } }
      }
    }`;

  it('loads a whole board with a constant number of queries (no N+1)', async () => {
    let five: { project: { statuses: { tasks: { edges: unknown[] } }[] } } | undefined;
    const small = await t.countQueries(async () => {
      five = (await t.gql<NonNullable<typeof five>>('carol', BOARD, { p: web, first: 5 })).data;
    });
    const large = await t.countQueries(() => t.gql('carol', BOARD, { p: web, first: 50 }));

    expect(five?.project.statuses).toHaveLength(5);
    expect(five?.project.statuses.every((status) => status.tasks.edges.length <= 5)).toBe(true);
    // 10x more cards, same number of SQL statements: loaders + one LATERAL query.
    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(15);
  });

  it('pages a column in board order with no gaps or duplicates', async () => {
    const seen: string[] = [];
    let after: string | null = null;
    do {
      const response: Awaited<
        ReturnType<typeof t.gql<{ project: { statuses: { id: string; tasks: TaskPage }[] } }>>
      > = await t.gql(
        'carol',
        `query ($p: ID!, $after: String) { project(id: $p) { statuses { id
          tasks(first: 7, after: $after) { edges { cursor node { id } } pageInfo { hasNextPage endCursor } } } } }`,
        {
          p: web,
          after,
        },
      );
      const todo = response.data?.project.statuses.find(
        (status) => status.id === statusId.Todo,
      )?.tasks;
      seen.push(...(todo?.edges.map((edge) => edge.node.id) ?? []));
      after = todo?.pageInfo.hasNextPage ? todo.pageInfo.endCursor : null;
    } while (after);
    expect(seen).toEqual(await columnOrder('Todo'));
  });

  it('sorts by due date with undated tasks last, in both directions', async () => {
    for (const direction of ['ASC', 'DESC'] as const) {
      const seen: string[] = [];
      let after: string | null = null;
      do {
        const response: Awaited<ReturnType<typeof t.gql<{ project: { tasks: TaskPage } }>>> =
          await t.gql(
            'carol',
            `query ($p: ID!, $after: String, $dir: SortDirection!) { project(id: $p) {
             tasks(first: 37, after: $after, orderBy: { field: DUE_DATE, direction: $dir }) {
               edges { node { id } } pageInfo { hasNextPage endCursor } } } }`,
            { p: web, after, dir: direction },
          );
        const page = response.data?.project.tasks;
        seen.push(...(page?.edges.map((edge) => edge.node.id) ?? []));
        after = page?.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (after);
      const truth = await t.ownerQuery<{ id: string }>(
        `SELECT id FROM tasks WHERE project_id = $1 AND deleted_at IS NULL
          ORDER BY due_date ${direction} NULLS LAST, id ${direction}`,
        web,
      );
      expect(seen, direction).toEqual(truth.map((row) => row.id));
    }
  });

  it('applies filters with the documented AND/OR semantics', async () => {
    const carol = t.seed.users.carol!;
    const response = await t.gql<{ project: { tasks: TaskPage } }>(
      'carol',
      `query ($p: ID!, $carol: ID!) { project(id: $p) {
         tasks(first: 100, filter: { priorities: [HIGH, URGENT], assigneeIds: [$carol], includeUnassigned: true,
                                     dueDate: { from: "2026-11-01", to: "2026-12-31" } }) {
           edges { node { id } } pageInfo { hasNextPage } } } }`,
      { p: web, carol },
    );
    const truth = await t.ownerQuery<{ id: string }>(
      `SELECT id FROM tasks WHERE project_id = $1 AND deleted_at IS NULL
          AND priority IN ('high', 'urgent') AND (assignee_id = $2 OR assignee_id IS NULL)
          AND due_date BETWEEN '2026-11-01' AND '2026-12-31'`,
      web,
      carol,
    );
    expect(response.data?.project.tasks.pageInfo.hasNextPage).toBe(false);
    expect(response.data?.project.tasks.edges.map((edge) => edge.node.id).sort()).toEqual(
      truth.map((row) => row.id).sort(),
    );
  });

  it('summarizes a project in one pass, matching SQL ground truth', async () => {
    const response = await t.gql<{
      project: {
        taskSummary: {
          total: number;
          overdue: number;
          byStatus: { status: { name: string }; count: number }[];
          byPriority: { priority: string; count: number }[];
          byAssignee: { assignee: { id: string } | null; count: number }[];
        };
      };
    }>(
      'carol',
      `query ($p: ID!) { project(id: $p) { taskSummary { total overdue
        byStatus { status { name } count } byPriority { priority count } byAssignee { assignee { id } count } } } }`,
      {
        p: web,
      },
    );
    const summary = response.data?.project.taskSummary;
    const [truth] = await t.ownerQuery<{ total: number; overdue: number }>(
      `SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
                                  AND status_category NOT IN ('completed', 'canceled')))::int AS overdue
         FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`,
      web,
    );
    expect({ total: summary?.total, overdue: summary?.overdue }).toEqual(truth);
    expect(summary?.byStatus.map((entry) => entry.status.name)).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'Done',
      'Canceled',
    ]);
    expect(summary?.byPriority.map((entry) => entry.priority)).toEqual([
      'NONE',
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT',
    ]);
    for (const breakdown of [summary?.byStatus, summary?.byPriority, summary?.byAssignee]) {
      expect(breakdown?.reduce((sum, entry) => sum + entry.count, 0)).toBe(truth?.total);
    }
    expect(summary?.byAssignee.some((entry) => entry.assignee === null)).toBe(true); // unassigned bucket
  });

  it("returns the viewer's overdue tasks across organizations (myTasks)", async () => {
    const grace = t.seed.users.grace!;
    const response = await t.gql<{
      myTasks: {
        edges: {
          node: { id: string; isOverdue: boolean; project: { organization: { slug: string } } };
        }[];
      };
    }>(
      'grace',
      `{ myTasks(first: 100, filter: { overdue: true }) {
        edges { node { id isOverdue project { organization { slug } } } } } }`,
    );
    const truth = await t.ownerQuery<{ id: string }>(
      `SELECT t.id FROM tasks t JOIN organization_settings s ON s.organization_id = t.organization_id
        WHERE t.assignee_id = $1 AND t.deleted_at IS NULL
          AND t.status_category NOT IN ('completed', 'canceled')
          AND t.due_date < (now() AT TIME ZONE s.timezone)::date`,
      grace,
    );
    const edges = response.data?.myTasks.edges ?? [];
    expect(edges.map((edge) => edge.node.id).sort()).toEqual(truth.map((row) => row.id).sort());
    expect(edges.every((edge) => edge.node.isOverdue)).toBe(true);
    expect(new Set(edges.map((edge) => edge.node.project.organization.slug))).toEqual(
      new Set(['acme', 'globex']),
    );
  });
});

describe('moveTask', () => {
  const MOVE = `mutation ($input: MoveTaskInput!) { moveTask(input: $input) { task { id status { name } } } }`;

  it('places a card exactly between two neighbours and records the status change', async () => {
    const [a, b] = await columnOrder('In Progress');
    const [card] = await columnOrder('Todo');
    const response = await t.gql<{ moveTask: { task: { status: { name: string } } } }>(
      'carol',
      MOVE,
      {
        input: { id: card, statusId: statusId['In Progress'], afterTaskId: a, beforeTaskId: b },
      },
    );
    expect(response.data?.moveTask.task.status.name).toBe('In Progress');
    expect((await columnOrder('In Progress')).slice(0, 3)).toEqual([a, card, b]);

    const [history] = await t.ownerQuery<{ field: string; actor_id: string; to: string }>(
      `SELECT field, actor_id, new_value->>'name' AS to FROM task_activities
        WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      card,
    );
    expect(history).toEqual({ field: 'status', actor_id: t.seed.users.carol, to: 'In Progress' });
  });

  it('appends to the end of a column when no neighbour is given', async () => {
    const [card] = await columnOrder('Backlog');
    await t.gql('carol', MOVE, { input: { id: card, statusId: statusId.Done } });
    expect((await columnOrder('Done')).at(-1)).toBe(card);
  });

  it('refuses viewers, foreign columns and stale neighbours — and changes nothing', async () => {
    const [card] = await columnOrder('Todo');
    const [elsewhere] = await columnOrder('Done');
    const [mobileStatus] = await t.ownerQuery<{ id: string }>(
      "SELECT id FROM task_statuses WHERE project_id = $1 AND name = 'Done'",
      t.seed.projects.MOB,
    );
    const before = await t.ownerQuery('SELECT status_id, rank FROM tasks WHERE id = $1', card);

    expect(
      codeOf(await t.gql('erin', MOVE, { input: { id: card, statusId: statusId.Done } })),
    ).toBe('FORBIDDEN');
    expect(
      codeOf(await t.gql('carol', MOVE, { input: { id: card, statusId: mobileStatus!.id } })),
    ).toBe('BAD_USER_INPUT');
    expect(
      codeOf(
        await t.gql('carol', MOVE, {
          input: { id: card, statusId: statusId.Backlog, afterTaskId: elsewhere },
        }),
      ),
    ).toBe('CONFLICT');

    expect(await t.ownerQuery('SELECT status_id, rank FROM tasks WHERE id = $1', card)).toEqual(
      before,
    );
  });
});

describe('input limits', () => {
  it('rejects oversized pages, malformed cursors and over-deep queries', async () => {
    const tasks = (args: string) =>
      t.gql(
        'carol',
        `query ($p: ID!) { project(id: $p) { tasks(${args}) { edges { cursor } } } }`,
        { p: web },
      );
    expect(codeOf(await tasks('first: 101'))).toBe('BAD_USER_INPUT');
    expect(codeOf(await tasks('first: 5, after: "garbage"'))).toBe('BAD_USER_INPUT');

    const deep = await t.gql(
      'carol',
      `{ viewer { memberships { organization { projects { edges { node {
      statuses { tasks { edges { node { assignee { id } } } } } } } } } } } }`,
    );
    // viewer → memberships → organization → projects → edges → node → statuses →
    // tasks → edges → node → assignee → id: 12 levels (the board itself needs 7).
    expect(deep.errors?.[0]?.message).toMatch(/nested 12 levels deep; the maximum is 10/);
  });
});

describe('development token route', () => {
  it('lists seeded users with working tokens', async () => {
    const response = await t.app.fetch('http://test/dev/users');
    const users = (await response.json()) as { displayName: string; token: string }[];
    expect(users).toHaveLength(10);
    const alice = users.find((user) => user.displayName === 'Alice Johnson');
    const viewer = await t.app.fetch('http://test/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${alice?.token ?? ''}`,
      },
      body: JSON.stringify({ query: '{ viewer { user { displayName } } }' }),
    });
    expect(((await viewer.json()) as { data: unknown }).data).toEqual({
      viewer: { user: { displayName: 'Alice Johnson' } },
    });
  });
});
