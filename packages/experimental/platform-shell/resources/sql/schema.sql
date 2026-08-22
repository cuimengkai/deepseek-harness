-- Platform control-plane schema (version 5).
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
  isolated     INTEGER NOT NULL DEFAULT 0,
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

-- Capability market: the catalog is global, consumption is per workspace.
CREATE TABLE capabilities (
  capability_id TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role_id       TEXT NOT NULL,
  execution     TEXT NOT NULL CHECK (execution IN ('managed', 'sandboxed', 'none')),
  version       TEXT NOT NULL,
  enabled       INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  rollout       REAL NOT NULL CHECK (rollout >= 0 AND rollout <= 1),
  rate          INTEGER NOT NULL CHECK (rate >= 0),
  description   TEXT NOT NULL,
  -- The D5 preset fragment: the JSON-serialized EntryOptions[] this capability
  -- contributes to a workbench tree the preset assembler renders.
  rows          TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE capability_dependencies (
  capability_id TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
  depends_on    TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE RESTRICT,
  range         TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (capability_id, depends_on)
) STRICT;

CREATE TABLE capability_conflicts (
  capability_id  TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
  conflicts_with TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE RESTRICT,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (capability_id, conflicts_with)
) STRICT;

-- The tool surface one capability owns: the tool names whose execution the
-- capability's gate governs. Unpublishing the capability cascades the rows.
CREATE TABLE capability_tools (
  capability_id TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,
  PRIMARY KEY (capability_id, tool_name)
) STRICT;

-- Scenario bundles: one pluggable C-side workbench surface per customer group.
CREATE TABLE scenario_bundles (
  scenario_id  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  workbench_id TEXT NOT NULL,
  role_id      TEXT NOT NULL,
  preset       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE scenario_capabilities (
  scenario_id   TEXT NOT NULL REFERENCES scenario_bundles(scenario_id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
  PRIMARY KEY (scenario_id, capability_id)
) STRICT;

-- Billing ledger: per-workspace integer-credit accounts.
CREATE TABLE accounts (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  balance      INTEGER NOT NULL CHECK (balance >= 0),
  created_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE usage_records (
  usage_id      TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL REFERENCES capabilities(capability_id) ON DELETE CASCADE,
  qty           INTEGER NOT NULL CHECK (qty >= 1),
  cost          INTEGER NOT NULL CHECK (cost >= 0),
  billed_at     INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE settlements (
  settlement_id TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  period        TEXT NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  status        TEXT NOT NULL CHECK (status IN ('open', 'settled')),
  created_at    INTEGER NOT NULL,
  settled_at    INTEGER,
  UNIQUE (workspace_id, period)
) STRICT;
