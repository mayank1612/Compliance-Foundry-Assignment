/**
 * test-app.ts — a fully wired API on a fresh, seeded, in-memory database.
 *
 * What: migrations + deterministic seed (smaller "large" project) + the real app
 *       from app.ts, driven in-process via `app.fetch` — the same request path as
 *       production, minus the network. Every executed SQL statement is recorded so
 *       tests can count queries per request (the N+1 guard).
 * Who:  graphql.test.ts.
 */
import { sql } from 'kysely';
import { createApp } from '../../src/app.js';
import { createTokenService } from '../../src/auth/tokens.js';
import { openDatabase } from '../../src/db/database.js';
import { migrateToLatest } from '../../src/db/migrator.js';
import { seedDemoData } from '../../src/db/seed.js';

export interface GraphQLResponse<T> {
  status: number;
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

export async function createTestApp(options: { largeProjectTasks?: number } = {}) {
  const queries: string[] = [];
  const database = await openDatabase({ onQuery: (text) => queries.push(text) });
  await migrateToLatest(database.db);
  const seed = await seedDemoData(database.db, {
    largeProjectTasks: options.largeProjectTasks ?? 400,
    today: '2026-11-18',
  });
  const tokens = createTokenService('test-secret-that-is-at-least-32-characters');
  const app = createApp({
    db: database.db,
    tokens,
    corsOrigin: 'http://localhost:5173',
    devRoutes: true,
  });

  /** Run a GraphQL operation as a seeded user (by handle), or anonymously (null). */
  async function gql<T = Record<string, unknown>>(
    as: string | null,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResponse<T>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const userId = as ? seed.users[as] : undefined;
    if (as && !userId) throw new Error(`unknown seeded user "${as}"`);
    if (userId) headers.authorization = `Bearer ${await tokens.sign(userId)}`;
    const response = await app.fetch('http://test/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
    return {
      status: response.status,
      ...((await response.json()) as Omit<GraphQLResponse<T>, 'status'>),
    };
  }

  /** Ground truth: raw SQL as the schema owner (no RLS), snake_case columns. */
  async function ownerQuery<T>(text: string, ...params: unknown[]): Promise<T[]> {
    const parts = text.split(/\$\d+/);
    const fragment = sql.join(
      parts.map((part, index) =>
        index < params.length ? sql`${sql.raw(part)}${params[index]}` : sql.raw(part),
      ),
      sql``,
    );
    return (await fragment.execute(database.db.withoutPlugins())).rows as T[];
  }

  return {
    seed,
    app,
    gql,
    ownerQuery,
    /** Run `fn` and return how many SQL statements it caused. */
    async countQueries(fn: () => Promise<unknown>): Promise<number> {
      const before = queries.length;
      await fn();
      return queries.length - before;
    },
    close: () => database.close(),
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
