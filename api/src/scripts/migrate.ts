/**
 * migrate.ts — `npm run db:migrate` (also the first step of `npm run setup`).
 *
 * What: applies all pending SQL migrations to the configured database.
 * When: after pulling new migrations, or on first setup. Safe to re-run — already
 *       applied migrations are skipped (tracked in the `kysely_migration` table).
 * Exit code: 0 on success, 1 on any failure (CI-friendly, via runScript).
 */
import { loadEnv } from '../config/env.js';
import { openDatabaseFromEnv } from '../db/database.js';
import { logMigrationResults, migrateToLatest } from '../db/migrator.js';
import { runScript } from './run-script.js';

const LOG = '[db:migrate]';

await runScript(LOG, async () => {
  const database = await openDatabaseFromEnv(loadEnv(), LOG);
  try {
    logMigrationResults(await migrateToLatest(database.db), LOG);
  } finally {
    // Always release the pool + embedded server, or the process would hang open.
    await database.close();
  }
});
