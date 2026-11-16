/**
 * codegen.ts — `npm run db:codegen` → regenerates `src/db/types.ts`.
 *            `npm run db:codegen -- --verify` → fails if that file is out of date (CI).
 *
 * What: builds a throw-away in-memory database, applies every migration, then has
 *       kysely-codegen introspect it and write the TypeScript `DB` interface that
 *       types every Kysely query.
 * Why:  the SQL migrations stay the single source of truth; the TS types are
 *       *derived* from them, so they cannot drift. A fresh in-memory database means
 *       the output depends only on the migrations — never on a developer's local
 *       data or half-finished experiments in their dev database.
 * When: after adding or changing a migration (commit the regenerated file with it).
 */
import { generate, PostgresDialect as CodegenPostgresDialect } from 'kysely-codegen';
import { openDatabase } from '../db/database.js';
import { migrateToLatest } from '../db/migrator.js';
import { GENERATED_DB_TYPES_FILE } from '../paths.js';
import { runScript } from './run-script.js';

const LOG = '[db:codegen]';
const verifyOnly = process.argv.includes('--verify');

await runScript(LOG, async () => {
  const database = await openDatabase(); // no URL, no data dir → fresh in-memory PGlite
  try {
    await migrateToLatest(database.db);

    await generate({
      // Introspection queries read catalog columns like `table_name`; our CamelCasePlugin
      // would rename them in results and confuse the introspector — so use a plugin-free handle.
      db: database.db.withoutPlugins(),

      // Each option below must mirror a runtime decision, or the types would lie:
      // DATE → 'YYYY-MM-DD' string (matches the DATE parser in db/pool.ts)
      // (Lint exception: kysely-codegen's PostgresDialect *implements* rather than
      // *extends* the GeneratorDialect class it is typed against. Structurally correct,
      // and exactly the library's documented usage.)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment
      dialect: new CodegenPostgresDialect({ dateParser: 'string' }),
      // camelCase property names (matches CamelCasePlugin in db/database.ts)
      camelCase: true,
      // int8 → number (matches parseSafeInt8 in db/pool.ts)
      typeMapping: { int8: 'number' },

      // The migrator's own bookkeeping tables are not part of the domain model.
      excludePattern: 'kysely_migration*',
      outFile: GENERATED_DB_TYPES_FILE,
      verify: verifyOnly,
    });
    console.log(`${LOG} ${verifyOnly ? 'verified' : 'wrote'} ${GENERATED_DB_TYPES_FILE}`);
  } finally {
    await database.close();
  }
});
