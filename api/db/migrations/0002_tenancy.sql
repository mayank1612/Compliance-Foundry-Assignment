-- =============================================================================
-- 0002_tenancy.sql — users, organizations (tenants), settings, memberships/roles
-- =============================================================================
-- Schema v1 (Task 1.1).
--
-- Model: a USER is a global identity (one login, many organizations). An
-- ORGANIZATION is the tenant boundary — "organization" and "workspace" are the
-- same concept in this product. ORGANIZATION_MEMBERS is the many-to-many link that
-- also carries the user's ROLE in that organization (RBAC is per organization).
--
-- Why many-to-many (a membership table) instead of `users.organization_id`:
--   If every user belonged to exactly one organization — typical of a product sold
--   to single companies — organization_id and role could simply be columns on
--   `users` (one organization → many users), and organization_members would not
--   exist. That assumption does not hold for a project-management platform.
--   Example: a group that runs several companies — Compliance Foundry, Comperis
--   Cybersecurity and Fixpliance AI — is three organizations, each with its own
--   projects, members and settings, yet the same people may work in two or all
--   three of them. They should use ONE login and switch between organizations,
--   not hold three accounts. So one organization has many users AND one user has
--   many organizations: many-to-many, which needs a link table.
--   The link row is also the only correct home for the ROLE: the same person can
--   be an admin in one organization and a viewer in another, which a single
--   users.role column cannot express.
--   Cost: "what may this user do here?" is a membership lookup rather than a
--   column read — one index-only scan (organization_members_user_idx below).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Roles, in ascending order of power.
-- -----------------------------------------------------------------------------
-- A Postgres enum (not text + CHECK) because enum values compare by declaration
-- order: `role >= 'admin'` means "admin or owner", which is how every permission
-- check in 0005 is written. Adding a role later is `ALTER TYPE … ADD VALUE …
-- BEFORE/AFTER`, which preserves the ordering.
--   viewer — read-only access to everything in the organization
--   member — creates and edits tasks, comments, labels
--   admin  — manages projects, statuses, settings and non-owner members
--   owner  — everything, incl. managing owners and deleting the organization
CREATE TYPE organization_role AS ENUM ('viewer', 'member', 'admin', 'owner');


-- -----------------------------------------------------------------------------
-- users — global identities
-- -----------------------------------------------------------------------------
-- Authentication is out of scope (no password/IdP columns); in production this row
-- would be keyed to an identity provider subject.
CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  email         text        NOT NULL,
  display_name  text        NOT NULL,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_email_unique UNIQUE (email),
  -- Stored normalised (trimmed + lower-case), so the plain UNIQUE above is
  -- effectively case-insensitive without the citext extension.
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  CONSTRAINT users_display_name_length CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  CONSTRAINT users_avatar_url_length CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048)
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- -----------------------------------------------------------------------------
-- organizations — the tenant
-- -----------------------------------------------------------------------------
CREATE TABLE organizations (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  name        text        NOT NULL,
  -- URL identifier: app.example.com/acme/… Lower-case, digits, inner hyphens.
  slug        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organizations_slug_unique UNIQUE (slug),
  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
  CONSTRAINT organizations_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 100)
);

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- -----------------------------------------------------------------------------
-- organization_settings — organization-level (workspace-level) settings
-- -----------------------------------------------------------------------------
-- One row per organization, with TYPED columns rather than a jsonb bag: each
-- setting gets a real type, a default and a CHECK, and adding a setting is a
-- reviewed migration. (jsonb is the right call only for user-defined/unknown keys.)
-- Kept apart from `organizations` because settings are edited by a different
-- audience (admins) and change on a different cadence than the tenant identity.
CREATE TABLE organization_settings (
  organization_id              uuid        PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  -- IANA zone that defines "today" for the organization — and therefore what
  -- "overdue" means (a task due on the 20th is overdue from the 21st *there*).
  timezone                     text        NOT NULL DEFAULT 'UTC',
  -- First day of the week in calendar views: 0 = Sunday … 6 = Saturday (ISO: 1).
  week_starts_on               smallint    NOT NULL DEFAULT 1,
  -- Lets admins decide whether plain members may create projects; enforced by
  -- the projects INSERT policy in 0005 (settings drive authorization).
  members_can_create_projects  boolean     NOT NULL DEFAULT true,
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  -- Evaluating a zone conversion rejects unknown zone names ("Mars/Olympus") with
  -- an error, so only real IANA zones are ever stored.
  CONSTRAINT organization_settings_timezone_valid CHECK ((now() AT TIME ZONE timezone) IS NOT NULL),
  CONSTRAINT organization_settings_week_starts_on_range CHECK (week_starts_on BETWEEN 0 AND 6)
);

CREATE TRIGGER organization_settings_set_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Every organization always has a settings row (created with the defaults), so
-- readers never need a LEFT JOIN + COALESCE. SECURITY DEFINER: the settings row
-- is created on behalf of whoever created the organization, whatever their grants.
CREATE FUNCTION app.organizations_create_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.organization_settings (organization_id) VALUES (NEW.id);
  RETURN NULL; -- AFTER trigger: return value ignored
END
$$;

CREATE TRIGGER organizations_create_settings
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION app.organizations_create_settings();


-- -----------------------------------------------------------------------------
-- organization_members — who belongs to which organization, with which role
-- -----------------------------------------------------------------------------
-- The users ↔ organizations many-to-many link (rationale: header of this file).
CREATE TABLE organization_members (
  organization_id  uuid              NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Deleting a user removes their memberships (their tasks become unassigned via
  -- the ON DELETE SET NULL on tasks — see 0003).
  user_id          uuid              NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role             organization_role NOT NULL DEFAULT 'member',
  created_at       timestamptz       NOT NULL DEFAULT now(), -- "joined at"
  updated_at       timestamptz       NOT NULL DEFAULT now(),

  -- PK serves "who is in organization X" (organization_id first) and is the
  -- target of tasks' composite assignee FK.
  PRIMARY KEY (organization_id, user_id)
);

-- The reverse direction, "which organizations is user Y in, with what role", runs
-- at the start of EVERY request (row-level security). Covering index: the
-- membership lookup is answered from the index alone (index-only scan).
CREATE INDEX organization_members_user_idx
  ON organization_members (user_id, organization_id) INCLUDE (role);

CREATE TRIGGER organization_members_set_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- -----------------------------------------------------------------------------
-- Invariant: an organization always has at least one owner
-- -----------------------------------------------------------------------------
-- Not expressible as a CHECK (it spans rows), so it is a CONSTRAINT TRIGGER.
-- DEFERRABLE INITIALLY DEFERRED: the check runs at COMMIT, so ownership can be
-- transferred in one transaction (promote the new owner, then demote/remove the
-- old one) without tripping on the intermediate state.
-- Deleting the whole organization is allowed: by commit time the organization row
-- is gone, so there is nothing left to protect.
CREATE FUNCTION app.organization_keeps_an_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'owner'
     AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id)
     AND NOT EXISTS (
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

CREATE CONSTRAINT TRIGGER organization_members_keep_an_owner
  AFTER UPDATE OF role OR DELETE ON organization_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.organization_keeps_an_owner();
