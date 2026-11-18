# CLAUDE.md

Working agreement for AI coding assistants on this repo. Humans: see README.md.

## Project

Take-home for Compliance Foundry: a multi-tenant project-management platform (organizations → projects → tasks). Deliverables are mapped in README.md, and stack rationale is in `docs/tech-stack-choice.md`.

## Rules

- **Comment all code.** Every new or modified block carries detailed comments covering what / why / how (plus which / where / when / who where relevant). Full rule: `.claude/memory/feedback_code_comments_mandatory.md`; team notes index: `.claude/memory/INDEX.md`.
- **Say "organization" everywhere.** Organization and workspace are the same tenant concept.
- **The SQL migrations in `api/db/migrations/` are the schema's source of truth.** They are forward-only. Never edit a committed migration; add a new one, then run `npm run db:codegen -w api` and commit the regenerated `api/src/db/types.ts`.
- **Kysely uses `CamelCasePlugin`.** TypeScript is `camelCase`, SQL is `snake_case`. Identifiers inside raw `sql` template text must be `snake_case`.
- **pg type parsers (`api/src/db/pool.ts`)**: `DATE` comes back as a `'YYYY-MM-DD'` string, and `int8` as a number (it throws if the value isn't a safe integer). Don't change these without updating codegen options and tests.
- **PGlite is one Postgres session.** Keep the pool and socket at one connection. Its timings are not production numbers.
- **Row-level security on PGlite.** The default user is a superuser, which bypasses RLS, so request transactions must `SET LOCAL ROLE`. Read custom settings with `nullif(current_setting('app.x', true), '')`: after first use, a setting reads as `''`, not NULL.
- **Workflow.** Go phase by phase as agreed with the user, wait for a go-ahead before starting a new phase, and run `npm run check` before calling anything done.

## Commands

| Command                      | What it does                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run setup`              | Apply migrations and load demo data into the embedded dev database (`api/.pglite`)                     |
| `npm run dev`                | API on :4000 (GraphiQL at `/graphql`, dev tokens at `/dev/users`) + web board on http://localhost:5173 |
| `npm run check`              | Typecheck, lint, format check, verify generated types, run tests (also run in CI)                      |
| `npm test`                   | Tests only (each file boots a fresh in-memory PGlite)                                                  |
| `npm run db:serve`           | Serve the dev database on 127.0.0.1:54320 for DBeaver/psql until Ctrl+C (holds the data-folder lock)   |
| `npm run db:migrate -w api`  | Apply pending migrations                                                                               |
| `npm run db:reset -w api`    | Delete, re-migrate and re-seed the embedded dev database (refuses if `DATABASE_URL` is set)            |
| `npm run db:seed -w api`     | Load demo data into an empty database                                                                  |
| `npm run gql:codegen -w api` | Regenerate resolver types from `api/src/graphql/schema.graphql` (`-- --check` to verify)               |
| `npm run db:codegen -w api`  | Regenerate Kysely types from the migrations (`-- --verify` to check only)                              |
