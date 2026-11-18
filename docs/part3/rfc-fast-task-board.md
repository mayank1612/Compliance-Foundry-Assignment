# RFC: A Fast Task Board for Large Projects

|                     |                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| **Status**          | Draft, for review                                                                                   |
| **Author**          | Mayank (drafted with Claude Code)                                                                   |
| **Reviewers**       | Board team engineers, product manager                                                               |
| **Decision needed** | Approve option B and the rollout plan; answer the open questions in §9                              |
| **Evidence**        | A working prototype on the real schema (Part 2) and measurements on 2,500- and 20,000-task projects |

## 1. Summary

The task board takes **6–8 seconds** to load for projects with 2,000+ tasks, and every filter change or drag-and-drop repeats that wait. The cause is architectural: the board downloads **every task** of the project, renders all of them, and re-downloads everything after any change.

We propose loading the board **one page per column** (about 25 cards), with filters and counts computed on the server, and making a drag-and-drop update **only the two affected columns** in the client's cache. A prototype on our schema loads a 20,000-task board with the same 57 KB, 11 SQL statements and about 50 ms of server time as a 2,500-task board. Fetching everything costs **7.7 MB and 9.7 s** at 20,000 tasks.

## 2. Problem

**What users see:** 6–8 s to open a large board, the same delay on every filter change, and a full reload after every drag. The board is "unusable" at the size of our most active projects.

**Where the time goes.** We reproduced the "fetch everything" pattern on our schema and data, with the same card fields through the same GraphQL API:

| Cost driver                                                                     | 2,500 tasks      | 20,000 tasks     | Grows with        |
| ------------------------------------------------------------------------------- | ---------------- | ---------------- | ----------------- |
| Response payload (JSON)                                                         | 958 KB           | 7.7 MB           | Every task        |
| Server time, even with batched lookups                                          | 428 ms           | 9.7 s            | Every task        |
| SQL statements if lookups aren't batched (assignee, labels and status per card) | 7,501            | 60,001           | Every task × 3    |
| DOM nodes to render, and drag targets to register                               | ~2,500 cards     | ~20,000 cards    | Every task        |
| Work repeated on each filter change or move                                     | All of the above | All of the above | Every interaction |

These measurements come from an embedded Postgres on a laptop. The **ratios** are what matter, not the absolute milliseconds. The client-side render cost wasn't measured here; Phase 0 instruments it.

**Who is affected:** the platform has 500+ organizations. We expect large projects to be concentrated in our biggest and most engaged customers. Phase 0 will confirm the share of projects, and of daily board views, above 2,000 tasks.

**Why it matters:** the board is the product's main screen. A screen that gets slower the more a team uses it punishes our best customers first, so this is a retention risk before it is a performance problem.

## 3. Goals and non-goals

**Goals:**

- Board load, filtering and drag-and-drop feel instant at 2,000 tasks.
- They stay that way at 20,000 tasks (10× headroom).
- Existing clients and integrations keep working throughout.

**Non-goals for this RFC:**

- Real-time updates pushed from other users.
- Offline mode.
- Full-text search.
- Changing the board's visual design.

## 4. Performance targets

Measured in production with real-user monitoring (RUM), for projects with 2,000–20,000 tasks.

| Metric                                            | Today                                       | Target p75        | Target p95 | Prototype (laptop)         |
| ------------------------------------------------- | ------------------------------------------- | ----------------- | ---------- | -------------------------- |
| Board load: first cards visible (LCP)             | 6–8 s                                       | ≤ 1.0 s           | ≤ 2.0 s    | —                          |
| Board API response, server side                   | 0.4–9.7 s (reproduced)                      | ≤ 150 ms          | ≤ 300 ms   | 22 ms (2.5k) / 49 ms (20k) |
| Payload per board load                            | 1–8 MB (reproduced), grows with the project | ≤ 80 KB, constant | ≤ 120 KB   | 57 KB at both sizes        |
| SQL statements per board load                     | Up to 60,000 (if unbatched)                 | ≤ 12, constant    | ≤ 12       | 11 at both sizes           |
| Filter change → updated board                     | 6–8 s (full reload)                         | ≤ 300 ms          | ≤ 600 ms   | —                          |
| Drag-and-drop response (INP)                      | Full reload                                 | ≤ 100 ms          | ≤ 200 ms   | Instant (optimistic)       |
| Move confirmed by the server                      | —                                           | ≤ 150 ms          | ≤ 300 ms   | 52 ms                      |
| Board refetches per move                          | 1 (everything)                              | 0 (summary only)  | 0          | 0                          |
| Initial JavaScript (gzipped)                      | —                                           | ≤ 160 KB          | —          | 148 KB                     |
| Move error rate (excluding stale-board conflicts) | —                                           | < 0.1%            | —          | —                          |

"Good" means the bottom four rows hold at **20,000 tasks** in a load test (Phase 3), not just at 2,000.

## 5. Options considered

### A. Optimise the client, keep fetching everything

Virtualise the columns, memoise cards, filter client-side, and make moves optimistic.

- **For:** no API change; about 2 weeks.
- **Against:** it fixes rendering but not data volume. Every load still transfers 1–8 MB and costs the server 0.4–9.7 s, filtering client-side means holding every task in browser memory, and the cost keeps growing with the project.

### B. A server-driven board (recommended)

Each column is a cursor-paginated list (25 cards, then "load more"), and filters run in SQL. One aggregate query returns the column counts and the chart data. A move is a mutation that returns only the moved card; the client edits its cached copy of the two columns and refetches only the summary.

- **For:** load cost depends on the number of columns, not the number of tasks (57 KB and 11 statements at both sizes). Filters reuse the same indexed queries. A move transfers one card.
- **Against:** a larger API; more complex cache logic on the client; counts come from a separate query; finding a card beyond the loaded pages needs server-side search.

### C. A local-first sync engine (Linear-style)

Sync the whole project into an in-browser database and push changes over websockets; every read is then local.

- **For:** everything is instant; offline support and real-time collaboration come with it.
- **Against:** quarters of work, not weeks:
  - the first sync still downloads everything (7.7 MB at 20,000 tasks);
  - tenancy and permissions must be enforced in the sync protocol;
  - it needs conflict resolution;
  - memory pressure on low-end devices.

  The right long-term direction _if_ real-time collaboration becomes a product goal; too large for the current pain.

### Comparison

|                                    | A: client-only | **B: server-driven**   | C: local-first       |
| ---------------------------------- | -------------- | ---------------------- | -------------------- |
| Fixes first load at 2k / 20k tasks | Partly / no    | **Yes / yes**          | First sync slow / no |
| Fixes filters and moves            | Yes            | **Yes**                | Yes                  |
| Server and database load           | Unchanged      | **Constant per view**  | Shifted to sync      |
| Effort                             | ~2 weeks       | **~6 weeks + rollout** | Quarters             |
| Risk                               | Low            | **Medium**             | High                 |

## 6. Recommendation

**Option B.** We take A's virtualisation only if Phase 0 data shows long, fully loaded columns still dropping frames; paging already keeps the number of rendered cards small. C stays on the roadmap as the path to real-time collaboration.

**B is already proven on our schema.** The Part 2 prototype implements it end to end:

- Pagination per column uses keyset cursors, and all columns load in one SQL round trip (`LATERAL`).
- Counts and the chart come from a single `GROUPING SETS` pass.
- Lookups are batched per request (DataLoader), and a test proves the SQL statement count stays constant as pages grow.
- `moveTask` computes the card's new position on the server between the given neighbours, under a per-column lock so concurrent drops can't collide.
- On the client, moves are optimistic and edit only the two affected columns; the chart is code-split.

## 7. Implementation plan

Two engineers, about 6 weeks plus the rollout.

| Phase           | Weeks | Work                                                                                                                                                                                                                                                                 | Exit criteria                                                                           |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **0. Measure**  | 1     | Real-user monitoring of board load, interaction latency, payload and SQL count, bucketed by project size; server tracing; the `board_v2` feature flag                                                                                                                | Baselines agreed; affected-project share known                                          |
| **1. API**      | 2–3   | Per-column connection, `taskStatus(id)` and server-side filters; `taskSummary`; DataLoaders; `moveTask` with server-computed position; board index built with `CREATE INDEX CONCURRENTLY`; backfill position keys from today's ordering in batches (expand/contract) | Contract tests green; query-count test; load test at 20,000 tasks meets the API targets |
| **2. Client**   | 3–5   | `board_v2` behind the flag: column paging with infinite scroll, filters in the URL, optimistic moves, summary-only refetch, loading, error and empty states, code-split chart                                                                                        | Component tests; LCP and INP targets met on staging data                                |
| **3. Harden**   | 6     | Load test (20,000 tasks, 50 concurrent boards); handling for stale boards (`CONFLICT`); accessibility review; decision on virtualisation                                                                                                                             | All §4 targets met in staging                                                           |
| **4. Roll out** | 7–9   | See §8                                                                                                                                                                                                                                                               | 100% of organizations; old path deprecated                                              |

The API changes are **additive**: the existing "all tasks" query keeps working until no client uses it.

## 8. Rollout strategy

1. **Ship the API first, unused:** the new fields go live behind no flag, because they're additive. A shadow job compares the new summary counts with the old full-load counts for a sample of projects, which catches filter or permission bugs before any user sees them.
2. **Turn the new board on in stages,** per organization, through the `board_v2` flag:

   | Stage       | Organizations                             | Duration    |
   | ----------- | ----------------------------------------- | ----------- |
   | Internal    | Our own                                   | 3 days      |
   | Opt-in beta | Customers with the largest projects (~5%) | 1 week      |
   | Wider       | 25% → 50%                                 | 3 days each |
   | All         | 100%                                      | —           |

3. **Gate every stage** on four checks: p95 board load ≤ 2 s; move error rate < 0.1%; no rise in board-related support tickets; count parity above 99.9%.
4. **Keep a kill switch:** turning the flag off restores the old board instantly. The database changes are expand-only, so a rollback never needs a migration.
5. **Communicate:** release notes from the PM, and a "new board" badge with a temporary "switch back" link during the beta. Support gets a macro for the two visible behaviour changes: counts come from the summary, and cards beyond the first page load on scroll.
6. **Clean up:** two releases after 100%, mark the "all tasks" query `@deprecated`, watch its usage drop to zero, then remove it together with the old board code.

## 9. Risks and open questions

| Risk                                                                                                   | Mitigation                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Counts briefly disagree with the loaded cards after a move                                             | Counts always come from the summary, which is refetched after every move                                            |
| Another user's change isn't visible until a refresh (no real-time updates)                             | Refresh when the window regains focus; `CONFLICT` reloads the affected column. Real-time updates are a separate RFC |
| The summary is the one query whose cost grows with the project (10 → 41 ms from 2,500 to 20,000 tasks) | Cache it per project and filter for a few seconds. Above ~100,000 tasks, maintain per-status counter rows instead   |
| Position keys grow after many drops into the same gap                                                  | Length limit in the database; a periodic rebalance job per column                                                   |
| Old mobile clients depend on the "all tasks" query                                                     | Kept and deprecated, removed only when usage reaches zero                                                           |

**Open questions for product:**

- Is "updates on refresh" acceptable for v2, or is real-time a launch requirement?
- Must column counts be exact at very large sizes, or is "1,000+" acceptable?
- Should each column remember its own sort (priority, due date) or always use manual order?
- What is the mobile app's migration timeline?
