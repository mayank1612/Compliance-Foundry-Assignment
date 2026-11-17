-- =============================================================================
-- 0003_projects_and_tasks.sql — projects, customizable statuses, labels, tasks
-- =============================================================================
-- Schema v1 (Task 1.1).
--
--   organization ─┬─< project ─┬─< task_status   (each project defines its columns)
--                 │            └─< task >── task_status, assignee (a member)
--                 └─< label >──< task_label >── task
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
-- Ordered so that `ORDER BY priority DESC` lists urgent first and none last.
CREATE TYPE task_priority AS ENUM ('none', 'low', 'medium', 'high', 'urgent');

-- Statuses are custom per project ("QA", "Blocked", "Shipped"…), but the system
-- still needs to know what a status MEANS. Every custom status maps to one fixed
-- category; "open", "overdue", "completed" and cycle-time logic use the category,
-- never status names. (Same approach as Linear's workflow-state types.)
CREATE TYPE status_category AS ENUM ('backlog', 'unstarted', 'started', 'completed', 'canceled');


-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
CREATE TABLE projects (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Short prefix for human task identifiers: key "WEB" + number 42 → "WEB-42".
  -- Not updatable by the API (0005), so identifiers never change once shared.
  key              text        NOT NULL,
  name             text        NOT NULL,
  description      text,
  -- Last task number handed out in this project; the next task gets +1 (see
  -- app.tasks_before_insert). It exists only to give tasks short, per-project,
  -- human-readable identifiers — WEB-1, WEB-2, … — used in the UI, URLs, commit
  -- messages and conversation ("is WEB-42 done?"). Alternatives rejected:
  --   * max(number) + 1 at insert time — two concurrent inserts read the same
  --     max and collide (unique violation), unless the project is locked anyway;
  --   * one SEQUENCE per project — thousands of schema objects created at
  --     runtime, outside migrations, awkward to copy/restore per tenant;
  --   * a global sequence — unique, but not per project (WEB-48213, and it leaks
  --     platform-wide volume).
  -- An atomic `UPDATE … RETURNING` on this column is O(1) and race-free. Cost:
  -- concurrent task inserts into the SAME project queue on this row's lock until
  -- the inserting transaction commits (different projects never contend).
  task_counter     integer     NOT NULL DEFAULT 0,
  -- Projects are archived, never deleted by the API: their tasks are history.
  archived_at      timestamptz,
  created_by       uuid        DEFAULT app.current_user_id() REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Redundant with the PK on its own, but required as the TARGET of composite
  -- foreign keys (organization_id, project_id) from child tables — that is what
  -- guarantees a child row's organization_id equals its project's.
  CONSTRAINT projects_organization_id_id_unique UNIQUE (organization_id, id),
  -- Also serves "list an organization's projects" (organization_id is leading).
  CONSTRAINT projects_key_unique UNIQUE (organization_id, key),
  CONSTRAINT projects_key_format CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  CONSTRAINT projects_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT projects_description_length CHECK (description IS NULL OR char_length(description) <= 10000),
  CONSTRAINT projects_task_counter_non_negative CHECK (task_counter >= 0)
);

-- Column list: only user-visible edits bump updated_at, not the task counter that
-- every task insert increments.
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE OF name, description, archived_at ON projects
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- -----------------------------------------------------------------------------
-- task_statuses — the customizable board columns of ONE project
-- -----------------------------------------------------------------------------
CREATE TABLE task_statuses (
  id               uuid            PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid            NOT NULL,
  project_id       uuid            NOT NULL,
  name             text            NOT NULL,
  category         status_category NOT NULL,
  color            text            NOT NULL DEFAULT '#6b7280',
  -- Column order on the board. A project has a handful of statuses, so reordering
  -- simply rewrites the positions in one transaction (no fractional keys needed).
  position         integer         NOT NULL,
  -- The status new tasks get when none is specified.
  is_default       boolean         NOT NULL DEFAULT false,
  created_at       timestamptz     NOT NULL DEFAULT now(),
  updated_at       timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT task_statuses_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  -- Target of tasks' composite FK (project_id, status_id): a task can only use
  -- a status of its OWN project.
  CONSTRAINT task_statuses_project_id_id_unique UNIQUE (project_id, id),
  -- New work must not start out "done": the default must be an open category.
  CONSTRAINT task_statuses_default_is_open CHECK (NOT is_default OR category IN ('backlog', 'unstarted', 'started')),
  CONSTRAINT task_statuses_color_format CHECK (color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT task_statuses_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  CONSTRAINT task_statuses_position_non_negative CHECK (position >= 0)
);

-- Status names are unique per project, ignoring case ("Done" vs "done").
CREATE UNIQUE INDEX task_statuses_name_unique ON task_statuses (project_id, lower(name));
-- At most one default per project (a partial unique index: only rows WHERE
-- is_default participate). "At least one" is handled by the fallback in
-- app.tasks_before_insert.
CREATE UNIQUE INDEX task_statuses_one_default_per_project ON task_statuses (project_id) WHERE is_default;

CREATE TRIGGER task_statuses_set_updated_at
  BEFORE UPDATE ON task_statuses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Every new project starts with a usable board. SECURITY DEFINER because members
-- may create projects (if the organization allows) but only admins may manage
-- statuses directly.
CREATE FUNCTION app.projects_create_default_statuses() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.task_statuses (organization_id, project_id, name, category, color, position, is_default)
  VALUES
    (NEW.organization_id, NEW.id, 'Backlog',     'backlog',   '#94a3b8', 0, false),
    (NEW.organization_id, NEW.id, 'Todo',        'unstarted', '#64748b', 1, true),
    (NEW.organization_id, NEW.id, 'In Progress', 'started',   '#f59e0b', 2, false),
    (NEW.organization_id, NEW.id, 'Done',        'completed', '#22c55e', 3, false),
    (NEW.organization_id, NEW.id, 'Canceled',    'canceled',  '#ef4444', 4, false);
  RETURN NULL;
END
$$;

CREATE TRIGGER projects_create_default_statuses
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION app.projects_create_default_statuses();


-- -----------------------------------------------------------------------------
-- labels — organization-wide tags
-- -----------------------------------------------------------------------------
-- Scoped to the organization, not the project, so one "bug" label can be used and
-- filtered across every project (cross-project reporting).
CREATE TABLE labels (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name             text        NOT NULL,
  color            text        NOT NULL DEFAULT '#6b7280',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT labels_organization_id_id_unique UNIQUE (organization_id, id),
  CONSTRAINT labels_color_format CHECK (color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT labels_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 50)
);

CREATE UNIQUE INDEX labels_name_unique ON labels (organization_id, lower(name));

CREATE TRIGGER labels_set_updated_at
  BEFORE UPDATE ON labels
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
CREATE TABLE tasks (
  id               uuid            PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid            NOT NULL,
  project_id       uuid            NOT NULL,
  -- Per-project sequence number, assigned by trigger (never by the client).
  number           integer         NOT NULL,
  title            text            NOT NULL,
  description      text,           -- Markdown
  -- Optional on INSERT: the trigger fills in the project's default status.
  status_id        uuid            NOT NULL,
  -- DENORMALISED copy of task_statuses.category, maintained by triggers (below).
  -- Why: "open"/"overdue" are the hottest filters, and a partial index can only
  -- use columns of its own table — this keeps "my overdue tasks" a single index
  -- range scan instead of a join through task_statuses.
  status_category  status_category NOT NULL,
  priority         task_priority   NOT NULL DEFAULT 'none',
  -- Single assignee (the Linear/Jira model): keeps "tasks per assignee"
  -- unambiguous and ownership clear. A task_assignees join table is the
  -- migration path if multi-assignee is ever needed.
  assignee_id      uuid,
  due_date         date,
  -- Card order within a board column, as a fractional index key ("a0", "a0V",
  -- "a1"…): a card dropped between two others gets a key between theirs, so a
  -- move rewrites ONE row instead of renumbering the column. Keys are generated by
  -- the API. COLLATE "C" = plain byte order, which those keys are designed for;
  -- a linguistic collation (en_US) would order them incorrectly.
  rank             text            COLLATE "C" NOT NULL,
  -- Set while the task is in a 'completed' status (trigger-maintained); feeds
  -- "completed this week" and cycle-time reporting.
  completed_at     timestamptz,
  created_by       uuid            DEFAULT app.current_user_id() REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz     NOT NULL DEFAULT now(),
  updated_at       timestamptz     NOT NULL DEFAULT now(),
  -- Soft delete: deleted tasks keep their comments and history and can be
  -- restored. Hot indexes below exclude them.
  deleted_at       timestamptz,

  -- Tenant consistency: the task's organization IS its project's organization.
  CONSTRAINT tasks_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  -- The status must belong to the task's project. Deleting a status that still
  -- has tasks is refused (move them first). Default NO ACTION, not RESTRICT, so a
  -- cascading project/organization delete can remove tasks and statuses together.
  CONSTRAINT tasks_status_fk FOREIGN KEY (project_id, status_id)
    REFERENCES task_statuses (project_id, id),
  -- The assignee must be a MEMBER of the task's organization. When the membership
  -- ends, only assignee_id is cleared (Postgres 15+ column-list SET NULL) —
  -- organization_id, part of the same key, is of course kept.
  CONSTRAINT tasks_assignee_fk FOREIGN KEY (organization_id, assignee_id)
    REFERENCES organization_members (organization_id, user_id) ON DELETE SET NULL (assignee_id),

  CONSTRAINT tasks_organization_id_id_unique UNIQUE (organization_id, id), -- composite FK target
  -- Also the index behind identifier lookups ("WEB-42" → project + number).
  CONSTRAINT tasks_number_unique UNIQUE (project_id, number),
  CONSTRAINT tasks_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  CONSTRAINT tasks_description_length CHECK (description IS NULL OR char_length(description) <= 50000),
  CONSTRAINT tasks_rank_not_empty CHECK (rank <> ''),
  -- The two trigger-maintained columns can never disagree.
  CONSTRAINT tasks_completed_at_matches_category CHECK ((status_category = 'completed') = (completed_at IS NOT NULL))
);

-- Board columns: one project's live tasks, per status, in card order. (rank, id)
-- is also the keyset-pagination order, so "next 50 cards in this column" is one
-- index range scan; counts per status can be answered from the index alone.
CREATE INDEX tasks_board_idx
  ON tasks (project_id, status_id, rank, id)
  WHERE deleted_at IS NULL;

-- "My open tasks / my overdue tasks" across all projects and organizations. Partial:
-- only open, live, assigned tasks with a due date — a small slice of the table.
-- Queries must repeat this predicate verbatim for the planner to choose the index.
-- ("Overdue" itself depends on today's date, which an index predicate cannot
-- contain, so the query adds `due_date < <today in the org's zone>`.)
CREATE INDEX tasks_open_assigned_due_idx
  ON tasks (assignee_id, due_date)
  WHERE deleted_at IS NULL
    AND assignee_id IS NOT NULL
    AND status_category NOT IN ('completed', 'canceled');

-- Every task of an assignee, open or not. Also needed by the tasks_assignee_fk
-- action: removing a member must find their tasks without scanning the table.
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id) WHERE assignee_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- Task triggers
-- -----------------------------------------------------------------------------
-- BEFORE triggers fire in name order; the numeric infixes make that explicit:
--   tasks_10_before_insert   — number + default status (INSERT only)
--   tasks_20_sync_status     — status_category + completed_at (INSERT, status change)
--   tasks_30_set_updated_at  — updated_at (UPDATE)

-- 1) Per-project number + default status.
-- SECURITY DEFINER: the counter lives on `projects`, which members may not update.
-- The UPDATE … RETURNING is atomic: concurrent inserts into the same project
-- queue on that project's row lock for the rest of their transaction, so numbers
-- are gap-free and never duplicated (a rolled-back insert does leave a gap).
CREATE FUNCTION app.tasks_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
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

CREATE TRIGGER tasks_10_before_insert
  BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_before_insert();

-- 2) Keep status_category and completed_at in sync with status_id.
-- Runs as the invoking user (no DEFINER needed): it only reads a status the user
-- can already see. A status from another project raises here, with a clearer
-- message than the composite FK would give.
CREATE FUNCTION app.tasks_sync_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_category public.status_category;
BEGIN
  SELECT s.category INTO v_category
    FROM public.task_statuses s
   WHERE s.id = NEW.status_id AND s.project_id = NEW.project_id;

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

CREATE TRIGGER tasks_20_sync_status
  BEFORE INSERT OR UPDATE OF status_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_sync_status();

CREATE TRIGGER tasks_30_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 3) A status whose CATEGORY changes (e.g. an admin turns "QA" from started into
-- completed) re-syncs the denormalised copy on all of its tasks — the price of
-- the denormalisation, paid on a rare admin action instead of on every read.
-- SECURITY DEFINER: app_user has no UPDATE right on these trigger-owned columns.
CREATE FUNCTION app.task_statuses_propagate_category() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.category IS DISTINCT FROM OLD.category THEN
    UPDATE public.tasks t
       SET status_category = NEW.category,
           completed_at = CASE WHEN NEW.category = 'completed'
                               THEN coalesce(t.completed_at, pg_catalog.now())
                               ELSE NULL END
     WHERE t.project_id = NEW.project_id   -- (project_id, status_id) = board index
       AND t.status_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER task_statuses_propagate_category
  AFTER UPDATE OF category ON task_statuses
  FOR EACH ROW EXECUTE FUNCTION app.task_statuses_propagate_category();


-- -----------------------------------------------------------------------------
-- task_labels — many-to-many between tasks and labels
-- -----------------------------------------------------------------------------
CREATE TABLE task_labels (
  organization_id  uuid        NOT NULL,
  task_id          uuid        NOT NULL,
  label_id         uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (task_id, label_id),  -- "labels of task X"
  -- Both sides must be in the same organization as the link row → a task can
  -- never carry another tenant's label.
  CONSTRAINT task_labels_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT task_labels_label_fk FOREIGN KEY (organization_id, label_id)
    REFERENCES labels (organization_id, id) ON DELETE CASCADE
);

-- "Tasks with label Y" (label filter) + the label-delete cascade.
CREATE INDEX task_labels_label_idx ON task_labels (label_id, task_id);
