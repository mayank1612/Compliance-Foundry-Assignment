/**
 * database.ts — the one function every entry point uses to get a database handle.
 *
 * What: decides embedded PGlite vs. real Postgres, creates the pool, and wraps it
 *       in a typed Kysely instance.
 * Who:  the GraphQL server (Part 2), the migrate/reset/codegen scripts, and tests.
 * How:  `databaseUrl` set → real server with a normal pool.
 *       `databaseUrl` unset → start embedded PGlite and pin the pool to ONE
 *       connection (PGlite is a single Postgres session — see embedded.ts).
 */
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { describeDataDir, type Env } from '../config/env.js';
import { startEmbeddedPostgres, type EmbeddedPostgres } from './embedded.js';
import { createPool } from './pool.js';
import type { DB } from './types.js';

export interface OpenDatabaseOptions {
  /** Real Postgres URL. Omit to use embedded PGlite. */
  databaseUrl?: string | undefined;
  /** PGlite persistence directory. Omit for an in-memory database. Ignored with databaseUrl. */
  pgliteDataDir?: string | undefined;
  /** Pool size for a real server. Ignored for PGlite (always 1). */
  poolMax?: number | undefined;
}

export interface Database {
  /** Typed query builder. Table/column types come from the generated `DB` interface. */
  readonly db: Kysely<DB>;
  /** True when running on embedded PGlite (timings are NOT production numbers). */
  readonly embedded: boolean;
  /** Close the pool, then the embedded server if we started one. */
  close(): Promise<void>;
}

export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<Database> {
  let embedded: EmbeddedPostgres | undefined;
  let connectionString = options.databaseUrl;

  if (!connectionString) {
    embedded = await startEmbeddedPostgres({ dataDir: options.pgliteDataDir });
    connectionString = embedded.url;
  }

  const pool = createPool({
    connectionString,
    max: embedded ? 1 : (options.poolMax ?? 10),
  });

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    // SQL stays snake_case (due_date); TypeScript sees camelCase (dueDate), so rows
    // map straight onto GraphQL fields without per-field resolvers.
    // Caveat: identifiers inside raw sql`` template text are NOT converted —
    // write them in snake_case there.
    plugins: [new CamelCasePlugin()],
  });

  return {
    db,
    embedded: embedded !== undefined,
    async close() {
      await db.destroy(); // ends the pool
      await embedded?.stop();
    },
  };
}

/**
 * Open the database described by validated environment config, and say which one
 * it is — so a developer can never be unsure whether a script touched the embedded
 * dev database or a real server.
 * Who: the CLI scripts (migrate/reset) and, in Part 2, the GraphQL server.
 */
export async function openDatabaseFromEnv(env: Env, logPrefix: string): Promise<Database> {
  const database = await openDatabase({
    databaseUrl: env.DATABASE_URL,
    pgliteDataDir: env.PGLITE_DATA_DIR,
    poolMax: env.DB_POOL_MAX,
  });
  const target = database.embedded
    ? `embedded PGlite (api/${describeDataDir(env)})`
    : 'Postgres server from DATABASE_URL';
  console.log(`${logPrefix} database: ${target}`);
  return database;
}
