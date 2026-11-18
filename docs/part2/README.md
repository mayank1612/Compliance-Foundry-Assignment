# Part 2: Full-Stack Implementation

## Task 2.1: Backend GraphQL API

| Deliverable                       | Where                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GraphQL schema (type definitions) | [`api/src/graphql/schema.graphql`](../../api/src/graphql/schema.graphql)                                                                                                                                                  |
| Resolver implementation           | [`api/src/graphql/resolvers.ts`](../../api/src/graphql/resolvers.ts), with SQL in [`api/src/repositories/tasks.ts`](../../api/src/repositories/tasks.ts) and batching in [`loaders.ts`](../../api/src/graphql/loaders.ts) |
| Tests                             | [`api/test/graphql.test.ts`](../../api/test/graphql.test.ts) (every result checked against SQL ground truth) and [`graphql-contract.test.ts`](../../api/test/graphql-contract.test.ts)                                    |

Run it with `npm run setup` then `npm run dev`. GraphiQL is at http://localhost:4000/graphql, and http://localhost:4000/dev/users gives a token for every seeded user.

### Design decisions

**The contract comes first.** The SDL is a strict subset of the Part 1 design (a test enforces it), and GraphQL Code Generator types every resolver against it, so drift fails the build.

**Authorization is enforced by Postgres, not by memory.** Each GraphQL operation runs in one transaction as `app_user`, with the caller's id set, so row-level security filters every query. Resolvers get only that transaction; no unscoped database handle exists. Other tenants' ids return `null` or `NOT_FOUND`, never "forbidden", and database messages are masked.

**The query count is constant.** Per-request DataLoaders batch every relation. All board columns page in one `LATERAL` query, and `identifier` and `isOverdue` are computed in SQL. A test proves a board load issues the same number of queries for 5 or 50 cards per column. The summary is one `GROUPING SETS` pass.

**Pagination is keyset-based.** Cursors encode `(sort value, id)`, never timestamps, so JavaScript's millisecond precision can't skip rows. Sorts use index-friendly keys, with undated tasks last. `first` is capped at 100 and query depth at 10.

**`moveTask` is safe under concurrency.** The server computes a fractional rank between the neighbours while holding a per-column advisory lock, so concurrent drops can't produce the same key. A failed mutation rolls back entirely.

**Trade-off:** a transaction holds its connection for the whole operation, so resolvers may only wait on the database. The summary still scans the project on every request, which Part 3 addresses.

## Task 2.2: Frontend Task Board

_Next._
