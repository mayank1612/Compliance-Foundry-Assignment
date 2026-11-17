/**
 * reset.ts — `npm run db:reset`: wipe the embedded dev database and rebuild it.
 *
 * What: deletes the PGlite data directory, then re-applies every migration
 *       (and, once Part 2 adds it, the seed data).
 * When: after editing a not-yet-committed migration, or to get back to a clean state.
 * Safety: this is destructive, so it
 *   1. refuses to run when DATABASE_URL points at a real server — we never drop
 *      someone's real database from a dev convenience script;
 *   2. only deletes a directory that lies *inside* api/, so a mistyped
 *      PGLITE_DATA_DIR (e.g. "/" or "C:\") cannot delete anything else.
 */
import { rm } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { loadEnv } from '../config/env.js';
import { acquireDataDirLock } from '../db/data-dir-lock.js';
import { openDatabaseFromEnv } from '../db/database.js';
import { logMigrationResults, migrateToLatest } from '../db/migrator.js';
import { API_ROOT } from '../paths.js';
import { runScript } from './run-script.js';

const LOG = '[db:reset]';

await runScript(LOG, async () => {
  const env = loadEnv();

  // Guard 1: never touch a real server.
  if (env.DATABASE_URL) {
    throw new Error(
      'refusing to reset: DATABASE_URL is set (real server). Unset it to reset PGlite.',
    );
  }

  // Guard 2: the data dir must be a strict sub-path of api/.
  const relativeDataDir = relative(API_ROOT, env.PGLITE_DATA_DIR);
  if (!relativeDataDir || relativeDataDir.startsWith('..') || isAbsolute(relativeDataDir)) {
    throw new Error(`refusing to delete ${env.PGLITE_DATA_DIR}: it is not inside ${API_ROOT}`);
  }

  // Guard 3: never delete files out from under a running process (db:serve, the
  // dev server). Holding the data-directory lock proves nobody else has them open.
  const releaseLock = await acquireDataDirLock(env.PGLITE_DATA_DIR);
  try {
    await rm(env.PGLITE_DATA_DIR, { recursive: true, force: true });
  } finally {
    await releaseLock(); // openDatabaseFromEnv below claims it again
  }
  console.log(`${LOG} deleted api/${relativeDataDir}`);

  const database = await openDatabaseFromEnv(env, LOG);
  try {
    logMigrationResults(await migrateToLatest(database.db), LOG);
  } finally {
    await database.close();
  }
});
