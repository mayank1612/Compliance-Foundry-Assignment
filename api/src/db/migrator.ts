/**
 * migrator.ts — applies the hand-written `.sql` migrations with Kysely's Migrator.
 *
 * What: a tiny MigrationProvider that turns each `NNNN_description.sql` file into a
 *       Kysely migration whose `up` executes the file's SQL verbatim.
 * Why:  the SQL files are the reviewed, commented source of truth for the schema
 *       (Task 1.1 deliverable). Kysely's Migrator contributes the hard parts we
 *       don't want to hand-roll: a `kysely_migration` tracking table, an advisory
 *       lock so two deploys can't migrate concurrently, ordering checks, and — on
 *       Postgres — running the pending batch inside a transaction (all-or-nothing).
 * Policy: forward-only. There are no `down` migrations; a mistake is fixed by a
 *       new migration. Rationale and production rules are in the technical docs.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
// Kysely ≥ 0.29 ships the migrator as a separate entry point, so apps that don't
// migrate at runtime don't load it.
import {
  Migrator,
  type Migration,
  type MigrationProvider,
  type MigrationResult,
} from 'kysely/migration';
import { errorMessage } from '../lib/errors.js';
import { MIGRATIONS_DIR } from '../paths.js';

/**
 * Accepted file names: 4-digit sequence + snake_case description, e.g.
 * `0001_initial_schema.sql`. Kysely orders migrations by name, so the fixed-width
 * prefix guarantees 0010 runs after 0009 (plain "10_" would sort before "9_").
 */
const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export class SqlFileMigrationProvider implements MigrationProvider {
  constructor(private readonly directory: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const entries = await readdir(this.directory);

    // Only .sql files are migrations; README.md etc. in the folder are ignored.
    const sqlFiles = entries.filter((name) => name.endsWith('.sql')).sort();

    // A misnamed file would silently run in the wrong order — refuse instead.
    const invalid = sqlFiles.filter((name) => !MIGRATION_FILE_PATTERN.test(name));
    if (invalid.length > 0) {
      throw new Error(
        `Invalid migration file name(s): ${invalid.join(', ')} — expected NNNN_snake_case.sql`,
      );
    }

    const migrations: Record<string, Migration> = {};
    for (const fileName of sqlFiles) {
      const statements = await readFile(join(this.directory, fileName), 'utf8');
      migrations[fileName.replace(/\.sql$/, '')] = {
        // sql.raw sends the file as ONE parameter-less query. node-postgres uses the
        // "simple query" protocol for parameter-less queries, which accepts many
        // `;`-separated statements — so a migration file can hold a whole schema.
        up: async (db) => {
          await sql.raw(statements).execute(db);
        },
      };
    }
    return migrations;
  }
}

/**
 * Apply every pending migration. Returns per-migration results for logging;
 * throws (after Kysely has rolled the batch back) if any migration fails.
 * Who: `npm run db:migrate`, `db:reset`, `db:codegen`, and test setup.
 */
export async function migrateToLatest<T>(
  db: Kysely<T>,
  directory: string = MIGRATIONS_DIR,
): Promise<MigrationResult[]> {
  const migrator = new Migrator({
    // Migrations are raw SQL and the migrator's bookkeeping queries are Kysely's own;
    // our CamelCasePlugin has no business rewriting either, so strip plugins here.
    db: db.withoutPlugins(),
    provider: new SqlFileMigrationProvider(directory),
  });
  const { error, results = [] } = await migrator.migrateToLatest();
  if (error) {
    const failed = results.find((result) => result.status === 'Error')?.migrationName;
    throw new Error(`Migration failed${failed ? ` in ${failed}` : ''}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  return results;
}

/** Print one line per migration applied (or "up to date"). Used by the CLI scripts. */
export function logMigrationResults(results: MigrationResult[], logPrefix: string): void {
  if (results.length === 0) {
    console.log(`${logPrefix} no pending migrations — schema is up to date`);
    return;
  }
  for (const { migrationName, status } of results) {
    console.log(`${logPrefix} ${status === 'Success' ? 'applied' : status}: ${migrationName}`);
  }
}
