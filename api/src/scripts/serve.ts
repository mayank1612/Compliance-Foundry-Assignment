/**
 * serve.ts — `npm run db:serve`: keep the embedded dev database open on a fixed
 * port so desktop tools (DBeaver, psql, TablePlus…) can connect to it.
 *
 * What: opens the persisted PGlite database (api/.pglite), applies any pending
 *       migrations, prints connection details, and serves until Ctrl+C.
 * Why:  PGlite lives inside a Node process — there is no always-on database server
 *       to point a tool at. This process plays that role on demand.
 * Who:  developers inspecting schema/data. The API does NOT use this; while this
 *       runs, the data-directory lock keeps other processes (migrate, reset, the dev
 *       server) from opening the same files — stop it before running them.
 * Caveat: every connection shares PGlite's single Postgres session. Fine for
 *       browsing in auto-commit mode (DBeaver's default); avoid manual-commit mode
 *       and session-level SET commands, which would affect all connections.
 */
import { loadEnv } from '../config/env.js';
import { openDatabase } from '../db/database.js';
import { startEmbeddedPostgres } from '../db/embedded.js';
import { logMigrationResults, migrateToLatest } from '../db/migrator.js';
import { runScript } from './run-script.js';

const LOG = '[db:serve]';

/**
 * Desktop tools open several connections (main, metadata reader, one per SQL editor).
 * They all share one session anyway (see caveat above), so the cap just bounds them.
 */
const TOOL_CONNECTIONS = 8;

await runScript(LOG, async () => {
  const env = loadEnv();
  if (env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is set — point your tool at that server directly; db:serve is for embedded PGlite.',
    );
  }

  const server = await startEmbeddedPostgres({
    dataDir: env.PGLITE_DATA_DIR,
    port: env.PGLITE_PORT,
    maxConnections: TOOL_CONNECTIONS,
  });

  // Bring the schema up to date first, through the same socket a tool will use.
  const migrations = await openDatabase({ databaseUrl: server.url, poolMax: 1 });
  try {
    logMigrationResults(await migrateToLatest(migrations.db), LOG);
  } finally {
    await migrations.close(); // closes only this pool, not the server
  }

  const [host, port] = server.address.split(':');
  console.log(`
${LOG} embedded PostgreSQL 18 is ready for desktop tools
  Host:      ${host}
  Port:      ${port}
  Database:  postgres
  Username:  postgres
  Password:  postgres   (not checked; the server only listens on this machine)
  JDBC URL:  jdbc:postgresql://${server.address}/postgres

  You are connected as the superuser, which bypasses row-level security.
  Press Ctrl+C to stop. While this runs, other db:* commands refuse to start.`);

  // Serve until the terminal asks us to stop, then close cleanly so PGlite flushes
  // its files and the data-directory lock is released.
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  console.log(`${LOG} stopping…`);
  await server.stop();
  console.log(`${LOG} stopped`);
});
