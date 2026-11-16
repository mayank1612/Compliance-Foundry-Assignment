# Migrations

These hand-written SQL files are the **single source of truth** for the database schema. TypeScript types (`api/src/db/types.ts`) are generated from them by `npm run db:codegen -w api`.

## Rules

| Rule                                                                                   | Why                                                                                                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Name files `NNNN_snake_case_description.sql` (e.g. `0001_initial_schema.sql`)          | Kysely applies migrations in name order; a fixed 4-digit prefix keeps `0010` after `0009`. Other names are rejected. |
| **Never edit a migration that has been committed**; add a new one                      | Environments that already applied it would silently diverge from the file.                                           |
| Forward-only: there are no `down` migrations                                           | Rolling back by hand-written `down` scripts is rarely tested and often destroys data. Fixes ship as new migrations.  |
| Comment every table, column group, constraint and index with its _why_                 | The SQL is a reviewed deliverable, not generated output.                                                             |
| After adding a migration, run `npm run db:codegen -w api` and commit `src/db/types.ts` | Keeps the query types in lock-step with the schema (CI runs `--verify`).                                             |

## How they run

`npm run db:migrate -w api` applies pending files through Kysely's `Migrator`. On Postgres, the whole pending batch runs in **one transaction**: if any file fails, none of them are applied. Applied migrations are recorded in the `kysely_migration` table.
