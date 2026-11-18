-- =============================================================================
-- 0006_critique_fixes.sql — schema v2: the fixes prioritised in Task 1.3
-- =============================================================================
-- What: applies the "fix first" items from docs/part1/critique-analysis.md, plus
--       cheap hardening the verification confirmed. Every change cites its
--       finding ID in docs/part1/ai-critique.md; docs/part1/schema-changelog.md
--       lists them with what was deliberately deferred.
-- Why a new file: 0001–0005 are schema v1 (git tag schema-v1) and are never
--       edited. That includes four v1 comments the critique showed to be wrong,
--       corrected here instead:
--         * 0003 tasks_board_idx "counts per status … from the index alone":
--           false under row-level security until change 3 below.
--         * 0003 propagation "(project_id, status_id) = board index": the board
--           index is partial (live tasks only), so it never applied. The
--           propagation is removed by change 1.
--         * 0003 tasks_open_assigned_due_idx "with a due date": the index has no
--           due_date condition; it covers open, live, assigned tasks.
--         * 0005 "(SELECT app.fn()) … used in every policy": only READ policies
--           use it; write policies call has_organization_role() per row (S3,
--           deferred — single-row API writes make it negligible today).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0) SEC4b — new functions are no longer executable by PUBLIC by default
-- -----------------------------------------------------------------------------
-- The critique's proposed `… IN SCHEMA app` form cannot work (per-schema default
-- privileges only ADD to the global ones — verified). The global form covers every
-- function this migration role creates from now on, including those below.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;


-- -----------------------------------------------------------------------------
-- 1) C1 / C2 / I2 — a status's category is fixed while any task uses it
-- -----------------------------------------------------------------------------
-- v1 let an admin re-categorise a status and then re-synced every task in it.
-- Verified problems: completion times silently rewritten with no history (C1), a
-- race with concurrent moves leaving a task's copied category wrong (C2), and a
-- full-project scan per change (I2). New rule: change the category only while the
-- status is unused; otherwise create a new status and MOVE the tasks, which
-- records history for each one.
CREATE FUNCTION app.task_statuses_guard_category() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Soft-deleted tasks count too: they keep a copy of the category.
  IF NEW.category IS DISTINCT FROM OLD.category
     AND EXISTS (SELECT 1 FROM public.tasks t
                  WHERE t.project_id = OLD.project_id AND t.status_id = OLD.id)
  THEN
    RAISE EXCEPTION 'status "%" still has tasks, so its category cannot change', OLD.name
      USING ERRCODE = 'check_violation',
            HINT = 'Create a status with the new category and move the tasks to it.';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER task_statuses_guard_category
  BEFORE UPDATE OF category ON task_statuses
  FOR EACH ROW EXECUTE FUNCTION app.task_statuses_guard_category();

-- With the guard, the v1 propagation can never find a task to update: remove it.
DROP TRIGGER task_statuses_propagate_category ON task_statuses;
DROP FUNCTION app.task_statuses_propagate_category();

-- The guard alone would re-open C2 in a new form: a task moved INTO the status
-- while an admin's category change is in flight would not be seen by the guard,
-- and would copy the old category. Reading the category with FOR SHARE makes the
-- two conflict (FOR SHARE vs the UPDATE's FOR NO KEY UPDATE):
--   * move first  → the admin's UPDATE waits, then its guard sees the task → refused;
--   * admin first → the move waits, then reads the committed new category.
-- SECURITY DEFINER because row locks require UPDATE rights and apply the
-- admin-only UPDATE policy, which members don't have. Safe: the lookup is pinned
-- to the task's own project, which the caller already passed RLS for.
CREATE OR REPLACE FUNCTION app.tasks_sync_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_category public.status_category;
BEGIN
  SELECT s.category INTO v_category
    FROM public.task_statuses s
   WHERE s.id = NEW.status_id AND s.project_id = NEW.project_id
     FOR SHARE;

  IF v_category IS NULL THEN
    RAISE EXCEPTION 'status % does not belong to project %', NEW.status_id, NEW.project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.status_category := v_category;
  -- Entering 'completed' stamps completed_at; moving between two completed
  -- statuses keeps the original stamp; leaving 'completed' clears it.
  NEW.completed_at := CASE
    WHEN v_category <> 'completed' THEN NULL
    WHEN TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL THEN OLD.completed_at
    ELSE pg_catalog.now()
  END;
  RETURN NEW;
END
$$;


-- -----------------------------------------------------------------------------
-- 2) SEC1 — no more adding people to an organization without their consent
-- -----------------------------------------------------------------------------
-- v1 let any admin insert any user id as a member, exposing that person's profile
-- (verified: an Acme admin added Globex's owner and Acme could read their email).
-- The capability is removed now; the replacement is an invitation the invitee
-- accepts (organization_invitations + app.accept_invitation), not built yet.
-- app.create_organization() keeps working: it is SECURITY DEFINER.
DROP POLICY organization_members_insert ON organization_members;
REVOKE INSERT ON organization_members FROM app_user;


-- -----------------------------------------------------------------------------
-- 3) S2 — board counts answered from the index alone, even under RLS
-- -----------------------------------------------------------------------------
-- Every read policy filters on organization_id, which v1's board index lacked, so
-- a per-status count had to visit the table (verified: 472 buffers vs 79).
-- INCLUDE carries it in the index leaf without affecting ordering.
-- (Production: CREATE INDEX CONCURRENTLY under a new name in a non-transactional
-- migrator pass, then drop the old one. Here the table is small, so in place.)
DROP INDEX tasks_board_idx;
CREATE INDEX tasks_board_idx
  ON tasks (project_id, status_id, rank, id) INCLUDE (organization_id)
  WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4) SEC3 — check membership before the privileged insert trigger does anything
-- -----------------------------------------------------------------------------
-- v1's SECURITY DEFINER trigger ran before the RLS check: a non-member briefly
-- locked another tenant's project row and got an error naming that tenant's
-- status id (verified). Now non-members are refused first, with no ids in the
-- message. Skipped for privileged callers (migrations, seeds), which set no
-- request user; every API request sets one.
CREATE OR REPLACE FUNCTION app.tasks_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL
     AND NOT app.has_organization_role(NEW.organization_id, 'member')
  THEN
    RAISE EXCEPTION 'not allowed to create tasks in this organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Per-project number (unchanged from 0003): atomic, gap-free except on rollback.
  UPDATE public.projects p
     SET task_counter = p.task_counter + 1
   WHERE p.id = NEW.project_id
     AND p.organization_id = NEW.organization_id
     AND p.archived_at IS NULL
  RETURNING p.task_counter INTO NEW.number;

  IF NEW.number IS NULL THEN
    RAISE EXCEPTION 'project % does not exist in organization % or is archived',
      NEW.project_id, NEW.organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.status_id IS NULL THEN
    -- The project's default status; if none is flagged, its first open column.
    SELECT s.id INTO NEW.status_id
      FROM public.task_statuses s
     WHERE s.project_id = NEW.project_id
       AND s.category NOT IN ('completed', 'canceled')
     ORDER BY s.is_default DESC, s.position, s.id
     LIMIT 1;
  END IF;

  RETURN NEW;
END
$$;


-- -----------------------------------------------------------------------------
-- 5) C4 — two owners leaving at the same moment can no longer orphan the org
-- -----------------------------------------------------------------------------
-- Each deferred check could see the OTHER owner's row (its deletion not yet
-- committed), so both passed. Locking the organization row first serialises the
-- checks; under READ COMMITTED the second check then runs with a fresh snapshot
-- that includes the first commit, and refuses.
CREATE OR REPLACE FUNCTION app.organization_keeps_an_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM public.organizations o WHERE o.id = OLD.organization_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL; -- the organization itself is being deleted
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members m
     WHERE m.organization_id = OLD.organization_id AND m.role = 'owner')
  THEN
    RAISE EXCEPTION 'organization % must keep at least one owner', OLD.organization_id
      USING ERRCODE = 'check_violation',
            HINT = 'Promote another member to owner before removing or demoting this one.';
  END IF;
  RETURN NULL;
END
$$;


-- -----------------------------------------------------------------------------
-- 6) C3 — card-order keys stay well below the B-tree entry limit
-- -----------------------------------------------------------------------------
-- Fractional keys grow by about one character per drop into the same gap; past
-- ~2.7 kB the board index would reject the row and the move would fail. Real keys
-- are a few characters; 255 bytes leaves room and fails loudly long before the
-- limit. (Duplicate keys from concurrent drops are prevented in the API: moveTask
-- computes the key under a per-column advisory lock.)
ALTER TABLE tasks ADD CONSTRAINT tasks_rank_length CHECK (octet_length(rank) <= 255);
