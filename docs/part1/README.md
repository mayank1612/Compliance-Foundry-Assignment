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

**Schema v1 is frozen** once it's committed: the Task 1.3 critique reviews exactly this version, and fixes ship as new migrations (`0006_…`).

## Task 1.2: Technical documentation

_Pending._

## Task 1.3: AI critique and analysis

_Pending._
