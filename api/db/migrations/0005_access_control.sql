-- =============================================================================
-- 0005_access_control.sql — privileges + row-level security (RLS)
-- =============================================================================
-- Schema v1 (Task 1.1).
--
-- Two layers, defence in depth:
--   1. The API checks permissions explicitly in its resolvers (readable, unit-tested,
--      good error messages).
--   2. THIS migration makes the database enforce the same rules for the app_user
--      role, so a forgotten check or a buggy query cannot read or write another
--      tenant's data, or exceed the caller's role.
--
-- How a policy knows the caller: each request transaction runs
--     SET LOCAL ROLE app_user;
--     SELECT set_config('app.user_id', '<uuid>', true);
-- and policies call app.current_user_id() / app.user_organization_ids().
--
-- Two mechanisms, two jobs:
--   * GRANTs (incl. COLUMN-level) decide WHICH columns app_user may write at all.
--     Immutable columns (ids, organization_id, project_id, task number, authorship,
--     trigger-maintained fields) are simply never granted, so even a buggy UPDATE
--     cannot move a task to another tenant or rewrite who created it.
--   * POLICIES decide WHICH ROWS: tenant membership for reads, role thresholds for
--     writes.
--
-- Permission matrix (minimum organization role):
--                         read     create         update             delete
--   organization          viewer   (any user)¹    admin              owner
--   settings              viewer   (automatic)    admin              —
--   members               viewer   admin²         admin²             admin² / self (leave)
--   projects              viewer   admin|member³  admin (incl. archive)  — (archive)
--   statuses              viewer   admin          admin              admin
--   labels                viewer   member         member             admin
--   tasks                 viewer   member         member (incl. soft delete) — (soft)
--   task labels           viewer   member         —                  member
--   comments              viewer   member         author|admin       author|admin (soft)
--   activity history      viewer   (triggers)     never              never
--   ¹ via app.create_organization(), which also makes the caller the owner
--   ² only owners may create, change or remove OWNER memberships
--   ³ members only if organization_settings.members_can_create_projects
--
-- Note on UPDATE semantics: a row the caller may see but not update is silently
-- skipped (0 rows affected) rather than raising — the API turns "0 rows" into a
-- FORBIDDEN/NOT_FOUND error. INSERTs that fail a policy raise an error.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Authorization helpers
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: they read organization_members WITHOUT going through its RLS
-- policy (which itself calls them) — otherwise policies would recurse.
-- STABLE: same answer for the whole statement.
--
-- Performance pattern used in every policy: `(SELECT app.fn())` instead of
-- `app.fn()`. The sub-select becomes an InitPlan, evaluated ONCE per query instead
-- of once per row, and `organization_id = ANY (<array>)` can use an index.
-- The `::uuid[]` cast in `= ANY ((SELECT …)::uuid[])` is load-bearing: without it
-- Postgres parses `= ANY ((SELECT …))` as the "ANY (subquery)" form and compares
-- the uuid against each ROW of the sub-select (uuid = uuid[] → error).

-- Every organization the caller belongs to (empty array when not signed in).
CREATE FUNCTION app.user_organization_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(pg_catalog.array_agg(m.organization_id), '{}')
    FROM public.organization_members m
   WHERE m.user_id = app.current_user_id()
$$;

-- Does the caller hold at least `p_minimum_role` in this organization?
-- Enum order makes this one comparison: owner >= admin >= member >= viewer.
CREATE FUNCTION app.has_organization_role(p_organization_id uuid, p_minimum_role public.organization_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.organization_members m
     WHERE m.organization_id = p_organization_id
       AND m.user_id = app.current_user_id()
       AND m.role >= p_minimum_role
  )
$$;

-- May the caller create/change/remove a membership that has role `p_role`?
-- Admins manage everyone except owners; only owners manage owners.
CREATE FUNCTION app.can_manage_member(p_organization_id uuid, p_role public.organization_role)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT app.has_organization_role(p_organization_id, 'admin')
     AND (p_role <> 'owner' OR app.has_organization_role(p_organization_id, 'owner'))
$$;

-- Creating an organization is a chicken-and-egg problem for RLS (you are not yet a
-- member of the organization you are creating), so it is one privileged,
-- audited entry point: create the organization (+ settings, by trigger) and make
-- the caller its owner, atomically.
CREATE FUNCTION app.create_organization(p_name text, p_slug text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id         uuid := app.current_user_id();
  v_organization_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.organizations (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_organization_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_organization_id, v_user_id, 'owner');

  RETURN v_organization_id;
END
$$;


-- -----------------------------------------------------------------------------
-- Function & schema privileges
-- -----------------------------------------------------------------------------
-- New functions are executable by PUBLIC by default. Revoke that for the whole
-- `app` schema, then grant back only what app_user calls directly (in policies,
-- column defaults and the API). Trigger functions need no grant: privileges on
-- them are checked when the trigger is created, not each time it fires.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app, public TO app_user;
GRANT EXECUTE ON FUNCTION
  app.current_user_id(),
  app.user_organization_ids(),
  app.has_organization_role(uuid, public.organization_role),
  app.can_manage_member(uuid, public.organization_role),
  app.create_organization(text, text)
TO app_user;


-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
-- Visible: yourself, and anyone who shares an organization with you (to show
-- assignees, authors, member lists). Editable: your own profile only.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON users TO app_user;
GRANT UPDATE (display_name, avatar_url) ON users TO app_user;

CREATE POLICY users_select ON users FOR SELECT TO app_user
  USING (
    id = (SELECT app.current_user_id())
    OR EXISTS (
      SELECT 1 FROM organization_members m
       WHERE m.user_id = users.id
         AND m.organization_id = ANY ((SELECT app.user_organization_ids())::uuid[])
    )
  );

CREATE POLICY users_update_self ON users FOR UPDATE TO app_user
  USING (id = (SELECT app.current_user_id()))
  WITH CHECK (id = (SELECT app.current_user_id()));


-- -----------------------------------------------------------------------------
-- organizations  (created only through app.create_organization)
-- -----------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON organizations TO app_user;
GRANT UPDATE (name, slug) ON organizations TO app_user;

CREATE POLICY organizations_select ON organizations FOR SELECT TO app_user
  USING (id = ANY ((SELECT app.user_organization_ids())::uuid[]));

CREATE POLICY organizations_update ON organizations FOR UPDATE TO app_user
  USING (app.has_organization_role(id, 'admin'))
  WITH CHECK (app.has_organization_role(id, 'admin'));

-- Deleting an organization cascades to everything it owns.
CREATE POLICY organizations_delete ON organizations FOR DELETE TO app_user
  USING (app.has_organization_role(id, 'owner'));


-- -----------------------------------------------------------------------------
-- organization_settings  (row created automatically with the organization)
-- -----------------------------------------------------------------------------
ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON organization_settings TO app_user;
GRANT UPDATE (timezone, week_starts_on, members_can_create_projects) ON organization_settings TO app_user;

CREATE POLICY organization_settings_select ON organization_settings FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));

CREATE POLICY organization_settings_update ON organization_settings FOR UPDATE TO app_user
  USING (app.has_organization_role(organization_id, 'admin'))
  WITH CHECK (app.has_organization_role(organization_id, 'admin'));


-- -----------------------------------------------------------------------------
-- organization_members
-- -----------------------------------------------------------------------------
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON organization_members TO app_user;
GRANT INSERT (organization_id, user_id, role) ON organization_members TO app_user;
GRANT UPDATE (role) ON organization_members TO app_user;

CREATE POLICY organization_members_select ON organization_members FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));

CREATE POLICY organization_members_insert ON organization_members FOR INSERT TO app_user
  WITH CHECK (app.can_manage_member(organization_id, role));

-- USING checks the CURRENT role (an admin cannot touch an owner's row);
-- WITH CHECK checks the NEW role (an admin cannot promote anyone to owner).
CREATE POLICY organization_members_update ON organization_members FOR UPDATE TO app_user
  USING (app.can_manage_member(organization_id, role))
  WITH CHECK (app.can_manage_member(organization_id, role));

-- Anyone may leave; admins/owners may remove others (same owner rule). The last
-- owner can do neither — see the constraint trigger in 0002.
CREATE POLICY organization_members_delete ON organization_members FOR DELETE TO app_user
  USING (user_id = (SELECT app.current_user_id()) OR app.can_manage_member(organization_id, role));


-- -----------------------------------------------------------------------------
-- projects  (archived, never deleted, through the API)
-- -----------------------------------------------------------------------------
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON projects TO app_user;
GRANT INSERT (id, organization_id, key, name, description) ON projects TO app_user;
GRANT UPDATE (name, description, archived_at) ON projects TO app_user;

CREATE POLICY projects_select ON projects FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));

-- Admins always; members only when the organization's settings allow it.
CREATE POLICY projects_insert ON projects FOR INSERT TO app_user
  WITH CHECK (
    app.has_organization_role(organization_id, 'admin')
    OR (
      app.has_organization_role(organization_id, 'member')
      AND EXISTS (
        SELECT 1 FROM organization_settings s
         WHERE s.organization_id = projects.organization_id
           AND s.members_can_create_projects
      )
    )
  );

CREATE POLICY projects_update ON projects FOR UPDATE TO app_user
  USING (app.has_organization_role(organization_id, 'admin'))
  WITH CHECK (app.has_organization_role(organization_id, 'admin'));


-- -----------------------------------------------------------------------------
-- task_statuses  (board configuration: admins)
-- -----------------------------------------------------------------------------
ALTER TABLE task_statuses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON task_statuses TO app_user;
GRANT INSERT (id, organization_id, project_id, name, category, color, position, is_default) ON task_statuses TO app_user;
GRANT UPDATE (name, category, color, position, is_default) ON task_statuses TO app_user;

CREATE POLICY task_statuses_select ON task_statuses FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));

CREATE POLICY task_statuses_insert ON task_statuses FOR INSERT TO app_user
  WITH CHECK (app.has_organization_role(organization_id, 'admin'));

CREATE POLICY task_statuses_update ON task_statuses FOR UPDATE TO app_user
  USING (app.has_organization_role(organization_id, 'admin'))
  WITH CHECK (app.has_organization_role(organization_id, 'admin'));

-- (A status that still has tasks cannot be deleted at all — tasks_status_fk.)
CREATE POLICY task_statuses_delete ON task_statuses FOR DELETE TO app_user
  USING (app.has_organization_role(organization_id, 'admin'));


-- -----------------------------------------------------------------------------
-- labels
-- -----------------------------------------------------------------------------
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON labels TO app_user;
GRANT INSERT (id, organization_id, name, color) ON labels TO app_user;
GRANT UPDATE (name, color) ON labels TO app_user;

CREATE POLICY labels_select ON labels FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));

CREATE POLICY labels_insert ON labels FOR INSERT TO app_user
  WITH CHECK (app.has_organization_role(organization_id, 'member'));

CREATE POLICY labels_update ON labels FOR UPDATE TO app_user
  USING (app.has_organization_role(organization_id, 'member'))
  WITH CHECK (app.has_organization_role(organization_id, 'member'));

-- Deleting removes the label from every task in the organization → admins only.
CREATE POLICY labels_delete ON labels FOR DELETE TO app_user
  USING (app.has_organization_role(organization_id, 'admin'));


-- -----------------------------------------------------------------------------
-- tasks  (soft-deleted via deleted_at; no DELETE privilege at all)
-- -----------------------------------------------------------------------------
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON tasks TO app_user;
GRANT INSERT (id, organization_id, project_id, title, description, status_id, priority, assignee_id, due_date, rank)
  ON tasks TO app_user;
GRANT UPDATE (title, description, status_id, priority, assignee_id, due_date, rank, deleted_at)
  ON tasks TO app_user;

CREATE POLICY tasks_select ON tasks FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));

CREATE POLICY tasks_insert ON tasks FOR INSERT TO app_user
  WITH CHECK (app.has_organization_role(organization_id, 'member'));

CREATE POLICY tasks_update ON tasks FOR UPDATE TO app_user
  USING (app.has_organization_role(organization_id, 'member'))
  WITH CHECK (app.has_organization_role(organization_id, 'member'));


-- -----------------------------------------------------------------------------
-- task_labels
-- -----------------------------------------------------------------------------
ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON task_labels TO app_user;
GRANT INSERT (organization_id, task_id, label_id) ON task_labels TO app_user;

CREATE POLICY task_labels_select ON task_labels FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));

CREATE POLICY task_labels_insert ON task_labels FOR INSERT TO app_user
  WITH CHECK (app.has_organization_role(organization_id, 'member'));

CREATE POLICY task_labels_delete ON task_labels FOR DELETE TO app_user
  USING (app.has_organization_role(organization_id, 'member'));


-- -----------------------------------------------------------------------------
-- task_comments  (soft-deleted via deleted_at)
-- -----------------------------------------------------------------------------
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON task_comments TO app_user;
GRANT INSERT (id, organization_id, task_id, body) ON task_comments TO app_user; -- author_id: column default
GRANT UPDATE (body, deleted_at) ON task_comments TO app_user;

CREATE POLICY task_comments_select ON task_comments FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));

CREATE POLICY task_comments_insert ON task_comments FOR INSERT TO app_user
  WITH CHECK (
    app.has_organization_role(organization_id, 'member')
    AND author_id = (SELECT app.current_user_id())
  );

-- Authors edit/delete their own comments (while still at least a member);
-- admins may moderate (soft-delete) anyone's.
CREATE POLICY task_comments_update ON task_comments FOR UPDATE TO app_user
  USING (
    (author_id = (SELECT app.current_user_id()) AND app.has_organization_role(organization_id, 'member'))
    OR app.has_organization_role(organization_id, 'admin')
  )
  WITH CHECK (
    (author_id = (SELECT app.current_user_id()) AND app.has_organization_role(organization_id, 'member'))
    OR app.has_organization_role(organization_id, 'admin')
  );


-- -----------------------------------------------------------------------------
-- task_activities  (append-only: written by triggers, never by app_user)
-- -----------------------------------------------------------------------------
ALTER TABLE task_activities ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON task_activities TO app_user;

CREATE POLICY task_activities_select ON task_activities FOR SELECT TO app_user
  USING (organization_id = ANY ((SELECT app.user_organization_ids())::uuid[]));
