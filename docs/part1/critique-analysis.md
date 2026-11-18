# Assessment of the AI Critique

_Drafted by Claude at the author's request, from the evidence in [`critique-verification.md`](critique-verification.md)._

## Do I agree?

Largely, yes. Of the critique's 19 findings, 16 held up when checked against the code and 14 probes on a 20,000-task dataset, and none was wrong outright. Its strength is that it reasons from Postgres semantics rather than generic advice. The status-category race (C2) hinges on `FOR KEY SHARE` not conflicting with `FOR NO KEY UPDATE`, and its proposed fix is correct. It also caught four migration comments that overstate what the code does.

Where I disagree:

- **S2 (cursor pages under row-level security) is half wrong.** Measurement shows the cursor comparison stays part of the index lookup under row-level security (11 pages read, 2,000 cards deep), because Postgres 18 marks the text and uuid comparison functions as `leakproof`. The half that holds (counts can't come from the index alone) is a one-line fix.
- **C4's race is real, but the scenario it gives isn't.** Two transactions removing the _same_ membership row simply queue on that row's lock. The real race needs two _different_ owners leaving at the same moment.
- **SEC4b's fix doesn't work.** A per-schema `ALTER DEFAULT PRIVILEGES` can add privileges but never revoke them. The same mistake appeared while `0001` was being written and was caught by running it, a reminder that plausible-looking DDL has to be executed, not just read.
- **Two severities are too high.** N1 is a risk in how resolvers get written, not a schema defect, and DataLoaders were already planned. C2 needs an admin to edit a status at the same moment someone moves a task into it, so it's Low rather than Medium.

## What it missed

1. **Row-level security is opt-in, not the default.** The critique asked which role the pool logs in as, but didn't draw the conclusion. The API connects as the schema owner, and only `withUserContext` drops privileges, so one forgotten wrapper exposes every tenant's data. In production the API should log in as a non-owner role, so row-level security applies by default; the owner role is for migrations only.
2. **Timestamp cursors lose precision between the database and JavaScript.** Postgres stores timestamps to the microsecond; a JavaScript `Date` keeps only milliseconds. Comment and history timelines paginate on `(created_at, id)`, so a cursor that passes through `Date` can skip or repeat rows. A schema-only review can't see this; it lives in the driver. Cursors must be encoded as text, or use the time-ordered `id` alone.
3. **One transaction per request ties response time to connection time.** Each GraphQL request holds a pooled connection for its whole duration, because the security context lives in that transaction. At 100x, pool size rather than CPU becomes the concurrency limit. Resolvers must not wait on anything other than the database inside the transaction; PgBouncer in transaction mode is the scaling path.

## What I'd fix first, and why

I ranked by damage × likelihood, divided by the cost of the fix:

1. **Forbid changing the category of a status that still has tasks** (C1, C2, part of I2). One trigger removes a whole class of silent corruption: completion times rewritten with no history, the race against task moves, and full-project rescans. Admins instead create a new status and move the tasks, which records history for each one. It's the cheapest fix with the biggest integrity gain.
2. **Stop the API role from inserting memberships directly** (SEC1). Any signed-up user can exploit this privacy hole today. An invitation flow (a token with an expiry, accepted by the invitee) replaces it.
3. **Build Part 2 so the N+1 and paging problems can't happen:**
   - per-request DataLoaders and one `LATERAL` query for all the columns' pages;
   - `first` capped at 100;
   - card order computed server-side under a per-column lock (C3);
   - database errors hidden from clients, plus a membership check before the privileged trigger runs (SEC3).
4. **Cheap index fixes:** add `INCLUDE (organization_id)` to the board index so per-status counts come from the index alone (S2), and serve the default task order from the existing `(project_id, number)` index (S1).
5. **Next:** keep former members' names in history by marking memberships as left rather than deleting them (C6), and route comment moderation through a privileged function that clears the body (SEC2). Both are real bugs, but neither touches the board, and both need product decisions first.

**Deliberately deferred:** version columns against lost edits (C5), until a collaborative description editor exists; indexes for user-reference columns (I1), until account deletion is a feature.
