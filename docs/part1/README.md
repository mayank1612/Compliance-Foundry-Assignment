# Part 1: System design

## Task 1.1: Data model (schema v1)

| Deliverable                   | Where                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GraphQL type definitions      | [`schema.graphql`](schema.graphql): the full platform API                                                                                                                                |
| SQL `CREATE TABLE` statements | [`api/db/migrations/`](../../api/db/migrations/): five commented migration files, one concern each (listed below)                                                                        |
| Evidence that it works        | [`api/test/schema.test.ts`](../../api/test/schema.test.ts): 22 tests on real PostgreSQL 18, covering integrity, history, tenant isolation, roles, and the GraphQL↔Postgres enum contract |

### The five migrations

| Migration                        | Contents                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_foundation.sql`            | Request role `app_user`, `app` schema, `current_user_id()`, `updated_at` trigger                                                          |
| `0002_tenancy.sql`               | `users`, `organizations`, `organization_settings`, `organization_members` (role enum, "always one owner" rule)                            |
| `0003_projects_and_tasks.sql`    | `projects`, `task_statuses` (custom per project, with a fixed category), `labels`, `tasks`, `task_labels`, and their indexes and triggers |
| `0004_comments_and_activity.sql` | `task_comments`; `task_activities` (append-only history, written by triggers)                                                             |
| `0005_access_control.sql`        | Column-level grants and row-level security policies, with the permission matrix                                                           |

**Schema v1 is frozen** (git tag `schema-v1`): the Task 1.3 critique reviews exactly this version, and fixes ship as new migrations (`0006_…`).

## Task 1.2: Technical documentation

[`technical-design.md`](technical-design.md) covers data model rationale and an entity-relationship diagram, query patterns (with verified query plans), indexing and performance, multi-tenancy isolation, and migration strategy.

## Task 1.3: AI critique and analysis

| Deliverable                    | Where                                                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI critique (raw, unedited)    | [`ai-critique.md`](ai-critique.md): an independent agent that read only the six schema files. Includes its exact prompt                                                                              |
| Verification of the critique   | [`critique-verification.md`](critique-verification.md): every finding checked against the code, 14 probes on a 20,000-task seed, and Postgres locking rules. 16 confirmed, 3 partly correct, 0 wrong |
| Our assessment (500–750 words) | [`critique-analysis.md`](critique-analysis.md): agree/disagree, what it missed, what to fix first and why                                                                                            |
