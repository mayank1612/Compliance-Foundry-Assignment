<!--
  Task 1.3 deliverable 1: the AI critique, VERBATIM.
  Everything below the "Critique output" heading is the critique agent's final report,
  unedited (only the transport indentation added by the agent hand-off was removed).
  This file is excluded from Prettier so not even formatting is changed.
-->

# Task 1.3: AI Critique of Schema v1 (raw output)

## How this critique was produced

| | |
|---|---|
| **Reviewer** | A separate Claude agent (Claude Opus 5.5, spawned from the Claude Code session), with no access to the design conversation |
| **Inputs** | Only the six schema files at git tag `schema-v1`: `api/db/migrations/0001–0005` and `docs/part1/schema.graphql` |
| **Isolation** | The agent was told not to open the design doc, tests, README, CLAUDE.md or git history. Those contain the authors' own list of weaknesses, and the critique had to be independent of them. **Verified afterwards from the agent's transcript:** it used only the Read tool, and only on the six files above |
| **Mode** | Read-only static review; no queries were run |
| **Date** | 2026-11-18 |

The authors' assessment of this critique (agree or disagree, what it missed, what to fix first) is in [`critique-analysis.md`](critique-analysis.md).

### Exact prompt given to the critique agent

````text
You are a principal engineer doing an adversarial architecture review of a database schema and GraphQL API design. Your review will be published verbatim as an "AI critique" in a take-home assessment, and a senior engineer will then write their own assessment of whether your critique is right and what it missed. Be specific, be critical, and be honest about uncertainty. Do not flatter the design.

## What you are reviewing

A multi-tenant project-management platform (a simplified Linear/Jira): organizations, projects, tasks (assignees, priorities, statuses, labels, due dates), comments, activity history, role-based access control (owner/admin/member/viewer per organization), organization settings, and customizable task statuses per project. PostgreSQL 18; a Node.js GraphQL API will be built on it (resolvers are NOT written yet — review the risks this schema shape creates for whoever implements them).

Read ONLY these six files (absolute paths, Windows):
1. E:\Compliance Foundry Assignment\api\db\migrations\0001_foundation.sql
2. E:\Compliance Foundry Assignment\api\db\migrations\0002_tenancy.sql
3. E:\Compliance Foundry Assignment\api\db\migrations\0003_projects_and_tasks.sql
4. E:\Compliance Foundry Assignment\api\db\migrations\0004_comments_and_activity.sql
5. E:\Compliance Foundry Assignment\api\db\migrations\0005_access_control.sql
6. E:\Compliance Foundry Assignment\docs\part1\schema.graphql

Do NOT open any other file in the repository — no other docs, READMEs, tests, source code, CLAUDE.md, .claude folder, or git history. Other files contain the authors' own reasoning about weaknesses, and this review must be independent of it. The comments inside the six files above are part of the design and are fair game. This is a read-only review: do not create, modify or run anything.

## Scale assumptions for "100x"

Today: ~500 organizations; the largest projects hold ~2,000+ tasks; a Kanban board UI for each project. "100x" means ~50,000 organizations and/or projects with ~200,000 tasks, with proportionally more users, edits, comments and activity history. State any further assumptions you make.

## Required analysis — cover all five areas

1. N+1 query risks in the GraphQL resolvers (given this SDL and these tables, where will a naive resolver implementation issue per-item queries, and what must the implementation do instead?)
2. Data consistency challenges (e.g. denormalized counters, status transitions, trigger-maintained fields, concurrent edits, ordering keys)
3. Scalability bottlenecks at 100x current data volume
4. Security concerns (tenant isolation, authorization gaps, privilege escalation, information leakage)
5. Missing indexes or denormalization opportunities

## Output format (your final message is published as-is, so make it the finished document)

- Title: "AI Critique — Schema v1"
- An executive summary: the 5 most important findings, ranked, one line each.
- One section per area above. For each finding:
  - an ID (e.g. N1, C2, S3, SEC1, I2), a short title and a severity (Critical / High / Medium / Low)
  - Evidence: file name and line number(s) you are relying on
  - Failure scenario: concrete inputs/state → what goes wrong
  - Recommendation: a concrete fix (SQL/DDL or resolver approach where useful)
  - Confidence: "Confirmed by reading" (the code clearly does this) or "Inference" (depends on assumptions, workload or implementation choices) — be explicit
- A short "What the design gets right" section (max 6 bullets), so the critique is balanced.
- A short "Open questions" section for things you could not determine from the files.
- Length: aim for 1,800–2,800 words. Prefer fewer, well-evidenced findings over many speculative ones. Do not invent behaviour the files don't show; if Postgres semantics matter to a claim (locking, MVCC, RLS, trigger timing), state them precisely.
````

---

## Critique output

# AI Critique — Schema v1

**Scope.** I read only `api/db/migrations/0001–0005` and `docs/part1/schema.graphql`. References use `0003:225` for migrations and `sdl:189` for the GraphQL file.

**Assumptions for 100x.**
- About 50k organizations. The largest projects hold about 200k tasks, roughly 90% of them in completed or canceled columns.
- 10–20 activity rows per task: 2–4M rows for the largest project, more than 10^8 across the platform.
- One Postgres primary.
- Each GraphQL request is one READ COMMITTED transaction on one pooled connection (0001:30-32), using node-postgres/Kysely (0001:52).

## Executive summary
1. **S1 (High).** The default `Project.tasks` sort and every `taskSummary` call have no supporting index. Each call reads every task in the project.
2. **N1/N2 (High).** A naively resolved board load costs about 1,500 queries, run one after another on one connection. Page sizes (`first`) have no maximum.
3. **SEC1 (High).** Joining an organization needs no consent from the person added. Any signed-up user can create an organization, add arbitrary accounts, enumerate emails and read profiles.
4. **C1/C2 (Medium).** The copied `status_category` column can go wrong without anyone noticing. A category change irreversibly rewrites `completed_at` with no history row, and it races with concurrent task moves.
5. **SEC2 (Medium).** Row-level security lets admins rewrite other people's comments and lets authors undo moderation, which contradicts the GraphQL contract.

---

## 1. N+1 query risks

**N1 — One-query-per-card lookups on the board (High)**
- **Evidence:** `identifier`, `status`, `assignee`, `labels`, `isOverdue` and `createdBy` are separate fields (sdl:244-271). `identifier` needs `projects.key` (0003:33). `isOverdue` needs the org's timezone (0002:103; sdl:258-262). Labels need `task_labels ⋈ labels` (0003:367-383).
- **Failure scenario:** A board with 6 columns of 50 cards is 300 cards. Per-field resolvers make about 5 lookups per card, roughly 1,500 queries. All of them run on one connection inside the request transaction, so node-postgres runs them one at a time. Latency adds up: 1,500 × ~0.3 ms ≈ 0.45 s of round-trips alone.
- **Recommendation:**
  - Join `projects` and `organization_settings` into the task query and compute `identifier` and `is_overdue` in SQL: `t.due_date < (now() AT TIME ZONE s.timezone)::date AND t.status_category NOT IN ('completed','canceled')`.
  - Use DataLoaders for users, statuses and labels, e.g. `SELECT tl.task_id, l.* FROM task_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.task_id = ANY($1)`.
  - Create loaders per request. Their rows were filtered by the caller's row-level security, so a shared cache would leak data across tenants.
- **Confidence:** Inference. No resolvers exist yet, but the SDL's shape forces this fan-out.

**N2 — Per-parent pagination and unbounded page sizes (High)**
- **Evidence:** `TaskStatus.tasks(filter, first, after)` is a separate list per column (sdl:225-230). `Task.comments` and `Task.activity` are lists per task (sdl:268-270). `first` has defaults but no maximum anywhere (sdl:135-136, 192, 228, 268, 270).
- **Failure scenario:**
  - A DataLoader `WHERE status_id = ANY($1)` cannot apply "first 50 per column". The usual workaround, `row_number() OVER (PARTITION BY status_id …)`, still reads every row of the 180k-row Done column to return 300 cards.
  - A query like `statuses{tasks(first:5000){…comments(first:1000){…author}}}` requests millions of objects.
- **Recommendation:** Fetch each parent's page in one LATERAL query, so each parent costs one range scan of `tasks_board_idx`:
  ```sql
  SELECT s.id AS status_id, t.*
  FROM unnest($1::uuid[]) s(id)
  CROSS JOIN LATERAL (SELECT * FROM tasks
     WHERE project_id = $2 AND status_id = s.id AND deleted_at IS NULL
     ORDER BY rank, id LIMIT $3) t;
  ```
  The batch key must include the filter and cursor arguments. Cap `first` (e.g. 100) and add a query cost or depth limit.
- **Confidence:** No maximum on `first`: confirmed by reading. Cost: inference.

**N3 — Activity timeline and summary lists (Medium)**
- **Evidence:**
  - `TaskActivity` has 11 concrete types, decoded from jsonb (sdl:381-479; 0004:82-87).
  - `actor`, assignee `from`/`to` (sdl:445-454), `TaskStatusSnapshot.status` (sdl:487) and `LabelSnapshot.label` (sdl:497) each need a live lookup per row.
  - `TaskSummary.byAssignee` (sdl:333) and `Organization.labels` (sdl:137) are plain lists with no bound.
  - Comments (sorted ascending, 0004:38) and activity (descending, 0004:100) are two separate paginated lists. Yet the UI timeline is "the merge (by time) of two streams" (0004:6-9).
- **Failure scenario:**
  - A 20-entry activity page can cost up to 80 lookups.
  - An organization with 3,000 assignees returns 3,000 `byAssignee` rows, each resolving a `User`.
  - A client cannot build a correct merged timeline page from two independent cursors without over-fetching both.
- **Recommendation:**
  - Use loaders keyed by the ids stored in the jsonb.
  - Add one `Task.timeline` list built as a `UNION ALL` ordered by `(created_at, id)`, with a single cursor.
  - Return only the top N for `byAssignee` and paginate `Organization.labels`.
- **Confidence:** Shape: confirmed by reading. Cost: inference.

## 2. Data consistency

**C1 — Changing a status's category rewrites completion history, with no audit trail (Medium)**
- **Evidence:**
  - 0003:347-353 rewrites `completed_at` for every task in the status: it is cleared, or set to `coalesce(completed_at, now())`.
  - No history row is written, because `tasks_record_changes` only fires for the columns listed at 0004:183-185.
  - `tasks_30_set_updated_at` has no column list (0003:334-336), so every task's `updated_at` also changes.
- **Failure scenario:** An admin switches "Done" to `started` by mistake, then back. Every task in Done loses its real completion time and gets the current time instead. Cycle-time and "completed this week" figures are wrong for the whole project, and the original timestamps cannot be recovered. At 100x this is one statement over about 180k rows:
  - It holds their row locks until commit, so drags on those cards block.
  - `status_category` appears in a partial-index condition (0003:244), so Postgres cannot do cheap in-place (HOT) updates. Each row writes new entries into up to six indexes.
- **Recommendation:**
  - Do not let a configuration change rewrite history. Either forbid category changes on statuses that have tasks (create a new status and move tasks, which records history per task), or make `completed_at` immutable once set.
  - Record a status-level history entry for the category change, and re-sync in batches.
- **Confidence:** Confirmed by reading.

**C2 — The `status_category` copy races with concurrent task moves (Medium)**
- **Evidence:**
  - `tasks_sync_status` reads the category with a plain, unlocked SELECT (0003:309-311).
  - The propagation trigger updates tasks from its own snapshot (0003:347-353).
  - The foreign-key check from tasks to statuses takes `FOR KEY SHARE`, which does not conflict with the `FOR NO KEY UPDATE` lock taken by a category UPDATE.
- **Failure scenario:**
  1. Transaction A changes status S from started to completed. Its trigger has run the propagation, but A has not committed.
  2. Transaction B moves task T into S. B's trigger still sees S as `started` and writes `status_category='started'`.
  3. A's propagation never saw T in S. Both commit.

  T now sits in a completed column but counts as open, and possibly overdue, permanently. The CHECK at 0003:225 is satisfied, so nothing flags it. The reverse order fails the same way.
- **Recommendation:**
  - Read the category with `SELECT … FOR SHARE`, so the move and the category change conflict. This must happen in a SECURITY DEFINER version of the trigger: row locks also apply the admin-only UPDATE policy, which would hide the row from members.
  - With the lock in place, a waiting move re-reads the committed category, and the propagation statement (which takes a fresh snapshot) sees the moved task.
  - Add a reconciliation query: `… WHERE t.status_category <> s.category`.
- **Confidence:** Confirmed by reading plus Postgres locking/MVCC semantics. Rare in practice.

**C3 — Card-order keys collide under concurrency and have no length limit (Medium)**
- **Evidence:**
  - `rank` is NOT NULL with no default and is generated by the API (0003:188-193). Its only check is `rank <> ''` (0003:223), and there is no uniqueness.
  - The per-project lock is only taken inside the INSERT's BEFORE trigger (0003:268-273), after the API has already computed the rank.
- **Failure scenario:**
  - Two concurrent `createTask` calls in the same column both read the last key `a5` and both insert `a6`. Two drops into the same gap do the same. The duplicates are accepted and ordering falls back to `id`, but no key exists strictly between two equal keys.
  - Repeated drops at the same spot make keys grow without limit. Past about 2.7 kB, the B-tree index refuses the entry and moves fail.
- **Recommendation:** Serialize rank generation per column with `pg_advisory_xact_lock(hashtextextended(status_id::text, 0))`. Members cannot row-lock `projects` (same reason as in C2). Alternatively, add `UNIQUE (status_id, rank) WHERE deleted_at IS NULL` and retry. Also add `CHECK (octet_length(rank) <= 64)` and a periodic rebalancing job.
- **Confidence:** Confirmed by reading. How often it happens: inference.

**C4 — An organization can be left with no owner (Low)**
- **Evidence:** The deferred constraint trigger checks with an unlocked `NOT EXISTS` (0002:176-197).
- **Failure scenario:** Owner A removes owner B while B leaves (0005:221-222). If both deferred checks run before either transaction commits, each sees the other's owner row and passes. The organization ends with no owners. Nobody can then grant ownership (0005:88-94) or delete the organization.
- **Recommendation:** Lock the organization row before checking: `PERFORM 1 FROM public.organizations WHERE id = OLD.organization_id FOR NO KEY UPDATE`. This works under READ COMMITTED; under REPEATABLE READ, use SERIALIZABLE instead.
- **Confidence:** Confirmed by reading plus MVCC semantics.

**C5 — No protection against lost edits (Medium)**
- **Evidence:**
  - Neither tasks nor comments has a version column.
  - `UpdateTaskInput` and `EditCommentInput` take no expected version (sdl:721-728, 755-758), although `CONFLICT` is a declared error code (sdl:17).
  - History deliberately does not store description text (0004:164-166).
- **Failure scenario:** Two people edit a 20 kB description at the same time. The second save silently overwrites the first. History shows two "description changed" entries with no content, so the lost text cannot be recovered.
- **Recommendation:** Add `version bigint`, bumped by the BEFORE UPDATE trigger, and update with `UPDATE … WHERE id=$1 AND version=$2`. Under row-level security, "0 rows updated" can also mean "forbidden" (0005:42-44), so follow up with a SELECT to tell CONFLICT from NOT_FOUND.
- **Confidence:** Confirmed by reading.

**C6 — Former members disappear from history (Medium)**
- **Evidence:**
  - The `users_select` policy only shows users who currently share an organization with the viewer (0005:150-158).
  - Assignee history stores a bare user id (0004:171), unlike the status and label name snapshots.
  - The SDL says `author` is null only if the account was deleted (sdl:358), and that assignee `from: null` means "was unassigned" (sdl:450).
- **Failure scenario:** Carol leaves the organization. Her comments then show a null author, and "assignee Carol → Bob" renders as "unassigned → Bob". The history now states something false.
- **Recommendation:** Snapshot `{id, displayName}` into the history rows. Alternatively, add a SECURITY DEFINER `app.public_profiles(uuid[])` that returns name and avatar (not email) for users referenced by rows the caller can see. Give the SDL a distinct "former member" representation.
- **Confidence:** Confirmed by reading.

## 3. Scalability at 100x

**S1 — The default task list and the summary scan the whole project (High)**
- **Evidence:**
  - `Project.tasks` defaults to `CREATED_AT DESC` (sdl:191). The task indexes are `(project_id, number)`, the board index and the assignee indexes (0003:218-248); none covers `created_at`.
  - `taskSummary` aggregates every live task matching the filter (sdl:321-334).
- **Failure scenario:** For a 200k-task project, every page of the default list fetches all of the project's tasks and sorts them to keep the top 50. Every board load also runs `taskSummary` over every row. With many concurrent viewers of large projects, this dominates database CPU and cache churn.
- **Recommendation:**
  - Serve `CREATED_AT` ordering from `(project_id, number)`, which follows insert order almost exactly, or add `(project_id, created_at DESC, id DESC) WHERE deleted_at IS NULL`.
  - For the summary, cache per (project, filter) with a short TTL. A trigger-maintained `project_status_counts` table also works, but those counter rows become a contention point, like `task_counter`.
  - Set a `statement_timeout`.
- **Confidence:** Missing index: confirmed by reading. Latency: inference.

**S2 — Row-level security blocks the index shortcuts the comments promise (Medium)**
- **Evidence:** The comment says per-status counts can be answered "from the index alone" (0003:229-230). But the security policy filters on `organization_id` (0005:311-312), which `tasks_board_idx` does not contain (0003:231-233).
- **Failure scenario:**
  - Per-column counts need one table fetch per task instead of reading the index alone.
  - Postgres also refuses to use a filter as an index condition under row-level security unless the filter's functions are marked "leakproof". I believe `text_gt` and `text_lt` are not. If so, the keyset condition `(rank, id) > ($1,$2)` is applied only after rows are fetched, and page k of a column scans k×50 entries.
- **Recommendation:**
  - Use `… (project_id, status_id, rank, id) INCLUDE (organization_id) WHERE deleted_at IS NULL`.
  - Verify with `SET ROLE app_user; EXPLAIN (ANALYZE, BUFFERS)` and `SELECT proname, proleakproof FROM pg_proc WHERE proname IN ('text_gt','text_lt')`.
- **Confidence:** Missing column: confirmed by reading. Leakproof behaviour: inference, verify before acting.

**S3 — Organization-scale operations run as single transactions with per-row triggers (Medium)**
- **Evidence:**
  - Deleting an organization is one cascading DELETE (0005:179-181).
  - Row triggers fire inside that cascade (0004:142-150, 197-202).
  - Removing a member sets the assignee to NULL on all their tasks, which writes history row by row (0003:215-216).
  - Write policies call `app.has_organization_role(...)` once per row (e.g. 0005:317-319), despite the claim "used in every policy" (0005:55-57).
- **Failure scenario:**
  - Deleting a 1M-task organization queues millions of trigger events in backend memory.
  - The long transaction also blocks vacuum cleanup for the whole database.
  - Moving 50k tasks out of a deleted status costs 50k policy function calls plus 50k history inserts.
- **Recommendation:**
  - Soft-delete organizations and purge asynchronously in bounded batches.
  - Replace per-row role checks with `organization_id = ANY((SELECT app.user_organization_ids_with_role('member'))::uuid[])`, which is evaluated once per query.
- **Confidence:** Mechanics: confirmed by reading. Magnitudes: inference.

**S4 — Extra write work on the busiest paths (Low)**
- **Evidence:**
  - `rank` is indexed (0003:232), so every drag rewrites entries in up to six indexes.
  - `tasks_30` bumps `updated_at` on drags (0003:334-336), unlike projects (0003:70-72).
  - `tasks_record_changes` calls `status_snapshot()` twice on every tracked update, even when the status did not change, because the VALUES rows are computed before `WHERE c.changed` (0004:159-176).
  - Task inserts in a project queue on the counter row until commit (0003:46-48).
- **Failure scenario:** Heavy vacuum and index churn on busy boards, sorting by `UPDATED_AT` reshuffles on every drag, wasted lookups on each edit, and bulk imports run one task at a time.
- **Recommendation:** Give `tasks_30` a column list without `rank`. Wrap the snapshots in `CASE WHEN … IS DISTINCT FROM …`. Let imports reserve a block of numbers (`task_counter + n`).
- **Confidence:** Confirmed by reading.

## 4. Security

**SEC1 — Joining an organization needs no consent: account enumeration and profile harvesting (High)**
- **Evidence:**
  - Any signed-in user can call `app.create_organization` and becomes its owner (0005:100-120).
  - An admin may insert any `user_id` into `organization_members` (0005:204, 210-211), and the user is never asked.
  - The new member's email, name and avatar then become visible to every member (0005:150-158).
  - `addOrganizationMember` takes an email of an existing account (sdl:625-630), but no granted function can resolve an email outside the caller's own organizations (0005:132-138).
- **Failure scenario:** An attacker signs up, creates an organization and submits a list of emails.
  - The "must already have an account" response tells them which emails have accounts.
  - Each successful add exposes the victim's profile.
  - The attacker can then assign tasks that appear in the victim's cross-organization `myTasks` (sdl:523-534), which is a phishing channel.
  - Because the email lookup is impossible under row-level security, implementers will likely run this resolver as the owner role, with security bypassed.
- **Recommendation:**
  - Add an `organization_invitations` table (email, role, token hash, expiry).
  - Revoke `app_user`'s INSERT on `organization_members`; create memberships only in a SECURITY DEFINER `app.accept_invitation(token)` called by the invitee.
  - Return the same response whether or not the email has an account, and rate-limit invitations.
- **Confidence:** Database side: confirmed by reading. Email-lookup path: inference.

**SEC2 — The database allows comment impersonation and undoing moderation (Medium)**
- **Evidence:**
  - `GRANT UPDATE (body, deleted_at)` (0005:345), and the policy admits either the author or any admin (0005:358-366).
  - The SDL says editing is "Authors only" (sdl:599-600).
  - The body is NOT NULL and stays readable after a soft delete (0004:24, 33; 0005:347-348).
- **Failure scenario:**
  - An admin rewrites Bob's comment; it still shows Bob as the author, marked "edited".
  - Bob sets `deleted_at = NULL` on a comment an admin moderated, and both policy checks pass.
  - A comment deleted because it contained a leaked credential stays readable to every viewer through any query that forgets to hide it.

  All three break the file's own promise that a buggy query cannot exceed the caller's role (0005:9-11).
- **Recommendation:**
  - Authors may update only while `deleted_at IS NULL`, with no undelete.
  - Moderation goes through a SECURITY DEFINER function that records `deleted_by` and clears the body. Relax the constraint to `CHECK (deleted_at IS NOT NULL OR body IS NOT NULL)`.
- **Confidence:** Confirmed by reading.

**SEC3 — A privileged insert trigger runs before the row-level security check (Low)**
- **Evidence:** `tasks_10_before_insert` is SECURITY DEFINER and updates `projects` (0003:264-273). Postgres runs BEFORE ROW triggers before checking an INSERT's `WITH CHECK` policy. `tasks_20` raises an error containing the status id (0003:313-316).
- **Failure scenario:**
  - A non-member submits another tenant's `(organization_id, project_id)`.
  - Their project row is incremented and briefly locked.
  - The error "status <uuid> does not belong to project…" then replaces the security error. It shows the project exists and is not archived, and leaks one of that tenant's ids.
  - Nothing persists. It requires the resolver to skip its own visibility check and to pass database error messages to clients.
- **Recommendation:** Start the trigger with `IF NOT app.has_organization_role(NEW.organization_id,'member') THEN RAISE … 'insufficient_privilege'`, and never forward raw database messages.
- **Confidence:** Confirmed by reading plus documented Postgres trigger/policy ordering. Exploitability: inference.

**SEC4 — Smaller hardening gaps (Low)**
- **Archived projects are writable.** They are documented as read-only (sdl:565), but only task INSERT checks `archived_at` (0003:272); updates, labels, comments and statuses do not (0005:317-319). Fix: add an archive check to the write policies.
- **Future `app` functions will be callable by everyone.** `REVOKE … ON ALL FUNCTIONS IN SCHEMA app` (0005:130) covers only functions that exist today, and `app_user` has USAGE on the schema (0005:131). Fix: `ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`.
- **Client-supplied ids leak existence.** Inserting another tenant's task id fails with a duplicate-key error on `tasks_pkey`, which confirms the id exists. That breaks sdl:18-19. Ids are also not checked to be v7. Fix: map that error to a generic one, and add `CHECK (uuid_extract_version(id) = 7)`.
- **Confidence:** Confirmed by reading.

## 5. Missing indexes and denormalization

**I1 — User-reference foreign keys have no index (Medium)**
- **Evidence:** `projects.created_by` (0003:52), `tasks.created_by` (0003:197), `task_comments.author_id` (0004:23) and `task_activities.actor_id` (0004:78) are all `ON DELETE SET NULL`, and none of them is indexed. Postgres never creates indexes on referencing columns automatically.
- **Failure scenario:** Deleting one user (for example a GDPR erasure) scans each of these tables in full, including more than 10^8 activity rows, in one transaction.
- **Recommendation:** `CREATE INDEX CONCURRENTLY task_activities_actor_idx ON task_activities (actor_id) WHERE actor_id IS NOT NULL;`, and the same for the other three columns. Erasure also has to clear user ids stored inside the history jsonb (0004:171).
- **Confidence:** Confirmed by reading.

**I2 — Status-wide maintenance cannot use the partial board index (Low)**
- **Evidence:** The comment at 0003:352 says the propagation UPDATE uses the board index. That index only covers rows `WHERE deleted_at IS NULL` (0003:233), and the query has no such condition. It must not have one, because soft-deleted tasks need re-syncing too. The same applies to the foreign-key check when a status is deleted (0003:210-211).
- **Failure scenario:**
  - A category change or status deletion scans all 200k tasks of the project.
  - A `deleteTaskStatus` (sdl:571-573) that moves only live tasks first fails, because soft-deleted tasks still reference the status.
- **Recommendation:** `CREATE INDEX tasks_status_idx ON tasks (status_id);` and move soft-deleted tasks as well. Separately, the comment at 0003:236 says the index covers tasks "with a due date", but the condition (0003:240-244) never requires one. Fix that comment.
- **Confidence:** Confirmed by reading.

---

## What the design gets right
- Composite tenant foreign keys make cross-tenant references structurally impossible, including "the assignee must be a current member" (0003:205-216, 376-379).
- Row-level security fails closed when no user is set (0001:65-75). Column-level grants make tenancy, authorship and trigger-maintained columns unwritable (0005:19-24).
- Custom statuses map to a fixed category enum, and roles are an ordered enum, so permission and open/done logic never depend on names.
- Per-project task numbers come from an atomic counter, and the trade-offs are written down (0003:36-49).
- History stores status and label name snapshots, and deliberately does not copy 50k-character descriptions (0004:83-85, 164-166).
- SECURITY DEFINER functions pin `search_path = ''`, and read policies use the evaluate-once `(SELECT …)::uuid[]` pattern.

## Open questions
- What isolation level do request transactions use? C2 and C4 assume READ COMMITTED.
- Which role does the API's connection pool log in as, and is the development role a superuser? A superuser bypasses row-level security entirely, so any query outside the per-request transaction would be unprotected.
- Are database error messages ever returned to clients? That decides how severe SEC3 is.
- Is account deletion a product feature? That decides I1's priority. Is it intended that a sole owner cannot delete their account (0002:194-197)?
- Can viewers be assignees? The foreign key allows any role.
- What is the retention or partitioning plan for `task_activities`?
- Are `text_gt` and `text_lt` leakproof in the target Postgres build (S2)?
