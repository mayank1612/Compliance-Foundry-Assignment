/**
 * seed.ts — `npm run db:seed`: load the demo data into an empty database.
 *
 * Refuses when organizations already exist, so it can't duplicate data; use
 * `npm run db:reset` (embedded PGlite) to start over. Part of `npm run setup`.
 */
import { loadEnv } from '../config/env.js';
import { openDatabaseFromEnv } from '../db/database.js';
import { seedDemoData } from '../db/seed.js';
import { runScript } from './run-script.js';

const LOG = '[db:seed]';

await runScript(LOG, async () => {
  const database = await openDatabaseFromEnv(loadEnv(), LOG);
  try {
    const existing = await database.db
      .selectFrom('organizations')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    if (existing.count > 0) {
      console.log(`${LOG} database already has data — skipping (use db:reset to start over)`);
      return;
    }
    const started = Date.now();
    const result = await seedDemoData(database.db);
    console.log(
      `${LOG} seeded ${Object.keys(result.users).length} users, ${Object.keys(result.organizations).length} organizations, ` +
        `${Object.keys(result.projects).length} projects, ${result.tasks} tasks in ${Date.now() - started} ms`,
    );
  } finally {
    await database.close();
  }
});
