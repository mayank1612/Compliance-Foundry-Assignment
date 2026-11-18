# Schema Changelog

## v2: `0006_critique_fixes.sql` (2026-11-18)

Applies the "fix first" items from [`critique-analysis.md`](critique-analysis.md). Finding IDs refer to [`ai-critique.md`](ai-critique.md). v1 (`0001–0005`, git tag `schema-v1`) is unchanged; four of its comments that the critique showed to be wrong are corrected in the header of `0006`.

| Change                                                                                                                                                        | Finding                                        | Verified by                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A status's category can't change while any task (including soft-deleted ones) uses it. The v1 trigger that re-synced tasks after a category change is removed | C1, C2, I2                                     | Test: "…freezes the category of a used status"                                                                                                 |
| The task trigger reads the category with `FOR SHARE` (as SECURITY DEFINER), so a concurrent move and a category change conflict instead of racing             | C2 (the guard above would otherwise reopen it) | Reasoned from the Postgres lock conflict table; PGlite can't run concurrent sessions                                                           |
| The API role can no longer insert memberships (policy and grant removed). An invitation flow will replace it                                                  | SEC1                                           | Test: "adds people … only through privileged paths"                                                                                            |
| The board index gains `INCLUDE (organization_id)`                                                                                                             | S2                                             | Measured: per-status count under row-level security is now an index-only scan (0 table fetches, 112 pages), down from a bitmap heap scan (472) |
| The insert trigger checks membership first, refusing before touching another tenant's project, with no ids in the message                                     | SEC3                                           | Test: a cross-tenant insert gets `42501`, and the message has no Globex ids                                                                    |
| The owner check locks the organization row before counting owners                                                                                             | C4                                             | Reasoned (concurrent sessions)                                                                                                                 |
| `CHECK (octet_length(rank) <= 255)`                                                                                                                           | C3 (key length)                                | Test                                                                                                                                           |
| `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (global form)                                                                              | SEC4b                                          | Test: a function created later isn't executable by `app_user`                                                                                  |

## API contract addition (Part 2)

`Query.taskStatus(id: ID!): TaskStatus` was added to the design SDL and the API. The board needs to load more cards for **one** column; re-running the board query with an `after` cursor would apply one column's cursor to every column. With the column addressable by id, Apollo merges its next page into the same cached list (tested in `api/test/graphql.test.ts`).

## Handled in the API (Part 2), not the schema

| Finding                                            | How                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| N1 per-card lookups                                | Per-request DataLoaders; `identifier` and `isOverdue` computed in the task query              |
| N2 per-column pages; unbounded `first`             | One `LATERAL` query for every column's page; `first` capped at 100                            |
| C3 duplicate rank keys                             | `moveTask` computes keys server-side under a per-column `pg_advisory_xact_lock`               |
| SEC3 error disclosure                              | GraphQL Yoga masks unexpected errors; database messages never reach clients                   |
| S1 default `CREATED_AT` order                      | Served from the existing `(project_id, number)` index; numbers are assigned in creation order |
| "Row-level security is opt-in" (from the analysis) | `withUserContext` is the only way resolvers reach the database                                |
| Timestamp cursor precision (from the analysis)     | Cursors are encoded from text/uuid values, never round-tripped through JavaScript `Date`      |

## Deferred, with reasons

| Finding                                                                      | Why not yet                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| C6 former members vanish from history                                        | Needs soft membership (`left_at`) and a product decision on what ex-members' profiles show                    |
| SEC2 comment moderation                                                      | Comments aren't part of the Part 2 board; needs a moderation function that clears the body                    |
| SEC1 follow-up: invitations                                                  | The direct path is closed; the invitation flow (token, expiry, accept) is a feature of its own                |
| SEC4a archived projects writable                                             | Archive checks in every write policy cost a per-row lookup; the API refuses writes to archived projects first |
| C5 lost concurrent edits                                                     | Matters once collaborative description editing exists                                                         |
| I1 user-reference indexes                                                    | Only needed once account deletion is a feature                                                                |
| N3 merged timeline, S3 bulk write cost, S4 drag overhead, SEC4c id existence | Low impact at current scale; recorded for the Part 3 RFC                                                      |
