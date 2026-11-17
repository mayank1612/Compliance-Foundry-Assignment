-- =============================================================================
-- 0004_comments_and_activity.sql — task comments and the task activity history
-- =============================================================================
-- Schema v1 (Task 1.1).
--
-- A task's timeline in the UI is the merge (by time) of two streams:
--   * task_comments   — what people SAID (user-authored, editable, soft-deletable)
--   * task_activities — what CHANGED: who changed which field, from what, to what,
--                       when (system-recorded, append-only, immutable)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- task_comments
-- -----------------------------------------------------------------------------
CREATE TABLE task_comments (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid        NOT NULL,
  task_id          uuid        NOT NULL,
  -- Defaults to the requesting user and is not insertable by the API (0005),
  -- so a comment cannot be posted "as" someone else. Kept (as NULL = "former
  -- user") if the user is deleted, so the conversation survives.
  author_id        uuid        DEFAULT app.current_user_id() REFERENCES users (id) ON DELETE SET NULL,
  body             text        NOT NULL,  -- Markdown
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- NULL until the body is first edited (trigger-maintained) → "edited" badge.
  edited_at        timestamptz,
  -- Soft delete: the API shows "comment deleted" in place, keeping the thread.
  deleted_at       timestamptz,

  CONSTRAINT task_comments_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT task_comments_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000)
);

-- A task's comments in order, paginated by (created_at, id). Also serves the
-- task-delete cascade (task_id equality, organization_id checked as a filter).
CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at, id);

CREATE FUNCTION app.task_comments_mark_edited() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER task_comments_mark_edited
  BEFORE UPDATE OF body ON task_comments
  FOR EACH ROW EXECUTE FUNCTION app.task_comments_mark_edited();


-- -----------------------------------------------------------------------------
-- task_activities — append-only audit trail of task changes
-- -----------------------------------------------------------------------------
-- Design choice: rows are written by TRIGGERS on tasks/task_labels, not by API
-- code. An audit trail is only trustworthy if it is complete, and triggers record
-- every change regardless of which code path (API, script, future service) made
-- it. The actor comes from the same request setting row-level security uses
-- (app.user_id); NULL actor = a system change (migration, seed).
-- Rows are immutable: app_user may only SELECT (0005).
CREATE TYPE task_activity_kind AS ENUM (
  'created',        -- task created
  'updated',        -- one tracked field changed (see `field`)
  'deleted',        -- soft-deleted
  'restored',       -- soft-delete undone
  'label_added',
  'label_removed'
);

CREATE TABLE task_activities (
  id               uuid               PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid               NOT NULL,
  task_id          uuid               NOT NULL,
  actor_id         uuid               REFERENCES users (id) ON DELETE SET NULL,
  kind             task_activity_kind NOT NULL,
  -- For kind = 'updated': which field changed. One row per field, so the
  -- timeline can render "Alice changed priority from Low to High".
  field            text,
  -- Before/after values as JSON so one column fits every field type. Status
  -- and label values are SNAPSHOTS ({"id", "name", …}): history must show the
  -- name a status had at the time, even if it is renamed or deleted later.
  old_value        jsonb,
  new_value        jsonb,
  created_at       timestamptz        NOT NULL DEFAULT now(),

  -- History lives and dies with its task: kept through soft delete; removed only
  -- by a hard delete (i.e. deleting the whole project/organization).
  CONSTRAINT task_activities_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT task_activities_field_matches_kind CHECK ((kind = 'updated') = (field IS NOT NULL)),
  CONSTRAINT task_activities_field_known
    CHECK (field IN ('title', 'description', 'status', 'priority', 'assignee', 'due_date'))
);

-- One task's timeline, newest first, keyset-paginated by (created_at, id).
CREATE INDEX task_activities_task_idx ON task_activities (task_id, created_at DESC, id DESC);


-- -----------------------------------------------------------------------------
-- Recording task changes
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: app_user has no INSERT right on task_activities — only these
-- trigger functions can write history.

-- INSERT → one 'created' row.
CREATE FUNCTION app.tasks_record_creation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.task_activities (organization_id, task_id, actor_id, kind)
  VALUES (NEW.organization_id, NEW.id, app.current_user_id(), 'created');
  RETURN NULL;
END
$$;

CREATE TRIGGER tasks_record_creation
  AFTER INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_record_creation();

-- {"id", "name", "category"} of a status at this moment (NULL if it doesn't exist).
CREATE FUNCTION app.status_snapshot(p_status_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category)
    FROM public.task_statuses s
   WHERE s.id = p_status_id
$$;

-- UPDATE → one row per changed tracked field, plus deleted/restored transitions.
-- Not tracked: rank (card reordering is noise in a history) and the trigger-owned
-- columns (status_category, completed_at, updated_at), which follow from status.
CREATE FUNCTION app.tasks_record_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
BEGIN
  -- AFTER triggers queued by a cascade fire at the END of the outer statement.
  -- Deleting an organization ends its memberships, whose FK action clears
  -- tasks.assignee_id (an UPDATE → this trigger) — but by the time this trigger
  -- runs, the same cascade has already deleted the task. Nothing to record then;
  -- inserting would violate task_activities' foreign key. (Caught by
  -- api/test/schema.test.ts › "cascading through every table".)
  IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = NEW.id) THEN
    RETURN NULL;
  END IF;

  IF (OLD.deleted_at IS NULL) <> (NEW.deleted_at IS NULL) THEN
    INSERT INTO public.task_activities (organization_id, task_id, actor_id, kind)
    VALUES (NEW.organization_id, NEW.id, v_actor,
            CASE WHEN NEW.deleted_at IS NOT NULL THEN 'deleted' ELSE 'restored' END::public.task_activity_kind);
  END IF;

  -- One statement for all fields: each VALUES row is (field, old, new, changed?).
  INSERT INTO public.task_activities (organization_id, task_id, actor_id, kind, field, old_value, new_value)
  SELECT NEW.organization_id, NEW.id, v_actor, 'updated', c.field, c.old_value, c.new_value
    FROM (VALUES
      ('title',       pg_catalog.to_jsonb(OLD.title),    pg_catalog.to_jsonb(NEW.title),
                      OLD.title IS DISTINCT FROM NEW.title),
      -- Descriptions can be 50k characters: record THAT it changed, not a copy.
      ('description', NULL::jsonb,                       NULL::jsonb,
                      OLD.description IS DISTINCT FROM NEW.description),
      ('status',      app.status_snapshot(OLD.status_id), app.status_snapshot(NEW.status_id),
                      OLD.status_id IS DISTINCT FROM NEW.status_id),
      ('priority',    pg_catalog.to_jsonb(OLD.priority), pg_catalog.to_jsonb(NEW.priority),
                      OLD.priority IS DISTINCT FROM NEW.priority),
      ('assignee',    pg_catalog.to_jsonb(OLD.assignee_id), pg_catalog.to_jsonb(NEW.assignee_id),
                      OLD.assignee_id IS DISTINCT FROM NEW.assignee_id),
      ('due_date',    pg_catalog.to_jsonb(OLD.due_date), pg_catalog.to_jsonb(NEW.due_date),
                      OLD.due_date IS DISTINCT FROM NEW.due_date)
    ) AS c(field, old_value, new_value, changed)
   WHERE c.changed;

  RETURN NULL;
END
$$;

-- Column list: the trigger does not even fire for rank-only updates (board drags).
CREATE TRIGGER tasks_record_changes
  AFTER UPDATE OF title, description, status_id, priority, assignee_id, due_date, deleted_at ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_record_changes();

-- task_labels INSERT/DELETE → label_added / label_removed.
CREATE FUNCTION app.task_labels_record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_link  public.task_labels; -- the link row that was added or removed
  v_label jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN v_link := NEW; ELSE v_link := OLD; END IF;

  -- When the TASK itself is being hard-deleted (organization/project deletion
  -- cascading down), there is no history left to append to — and inserting would
  -- violate task_activities' foreign key. Skip.
  IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = v_link.task_id) THEN
    RETURN NULL;
  END IF;

  -- Snapshot the label; if the LABEL is being deleted (cascade), only its id remains.
  SELECT coalesce(
           (SELECT pg_catalog.jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color)
              FROM public.labels l WHERE l.id = v_link.label_id),
           pg_catalog.jsonb_build_object('id', v_link.label_id))
    INTO v_label;

  INSERT INTO public.task_activities (organization_id, task_id, actor_id, kind, old_value, new_value)
  VALUES (v_link.organization_id, v_link.task_id, app.current_user_id(),
          CASE WHEN TG_OP = 'INSERT' THEN 'label_added' ELSE 'label_removed' END::public.task_activity_kind,
          CASE WHEN TG_OP = 'DELETE' THEN v_label END,
          CASE WHEN TG_OP = 'INSERT' THEN v_label END);
  RETURN NULL;
END
$$;

CREATE TRIGGER task_labels_record_change
  AFTER INSERT OR DELETE ON task_labels
  FOR EACH ROW EXECUTE FUNCTION app.task_labels_record_change();
