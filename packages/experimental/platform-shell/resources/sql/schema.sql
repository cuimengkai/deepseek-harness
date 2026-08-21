-- Platform control-plane schema (version 1).
--
-- This is a NEW business-object database, independent of the dsh session
-- database (application id 0x504C5348 'PLSH', not the session store's
-- 0x44534850). Every mutation runs inside a begin-immediate transaction and is
-- validated by validateSchemaForMutation before commit.

CREATE TABLE users (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE workspaces (
  workspace_id TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE roles (
  role_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
) STRICT;

CREATE TABLE role_permissions (
  role_id    TEXT NOT NULL REFERENCES roles(role_id),
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
) STRICT;

CREATE TABLE members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_id      TEXT NOT NULL REFERENCES roles(role_id),
  PRIMARY KEY (workspace_id, user_id)
) STRICT;

CREATE TABLE assets (
  asset_id     TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  content      TEXT NOT NULL,
  role_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE lineage (
  asset_id   TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
  parent_id  TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (asset_id, parent_id)
) STRICT;

CREATE TABLE approval_tickets (
  ticket_id     TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  subject_kind  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'released')),
  actor_user_id TEXT NOT NULL,
  review_scope  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE approval_transitions (
  ticket_id     TEXT NOT NULL REFERENCES approval_tickets(ticket_id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, seq)
) STRICT;

CREATE TABLE audit_events (
  event_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT NOT NULL,
  workspace_id  TEXT,
  action        TEXT NOT NULL,
  target_kind   TEXT,
  target_id     TEXT,
  detail        TEXT,
  created_at    INTEGER NOT NULL
) STRICT;
