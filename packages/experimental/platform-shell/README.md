# @deepseek-ai/dsh-experimental-platform-shell

English | [中文](README.zh.md)

A self-built platform control plane: tenant/RBAC, a business-object asset store with lineage, a business-approval flow, and an audit log, all over one SQLite database. The service injects as `ctx.platformShell`; `registerPlatformShellTools` mounts the model-visible tools. The durable record types are documented in the [platform-shell subsystem catalog](../../../docs/subsystems/platform-shell.md), the [keyless demo](../../../examples/platform-shell-demo/README.md) drives the full surface, and the [Agent Note](../../../.agents/notes/implemented/architecture/2026-08-21-platform-shell-control-plane.md) records the placement and preset decisions.

## Config

```yaml
# cordis.yml
- id: platform-shell
  name: '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts'
  config:
    path: './.platform-shell.sqlite'   # or ':memory:'
    journalMode: wal                  # wal | delete | truncate | persist
    busyTimeoutMs: 5000
```

`path` is the SQLite database file, `:memory:` for an ephemeral store. `journalMode` picks the SQLite journal; `busyTimeoutMs` bounds how long concurrent writers wait on the single connection.

## Identity and tenancy

`UserId`, `WorkspaceId`, `RoleId`, `AssetId`, `TicketId`, and `AuditEventId` are branded ids. A workspace is the isolation unit: users register globally, while roles and memberships are workspace-scoped. `assignRole` is idempotent — re-assigning a role overwrites the membership. The default roles seed `product`, `dev`, `qa`, and `platform-admin` into a fresh database.

Enforcement happens at the service boundary: every actor-scoped method resolves the caller's workspace membership and denies with `PERMISSION_DENIED` before any mutation or read commits. A caller who is not a workspace member cannot read, register, or approve.

## Asset store

Each asset is one durable business object with a kind, producing role, content, and workspace. `registerAsset` commits the record and writes one audit row in the same transaction, or throws; the store never half-applies. `AssetId` is allocated as `<kind>-<seq>`, so the ids chain visibly across roles (`requirement-1 → code-2 → test-case-3`).

## Lineage

`linkAsset` records that one asset derives from another; `ancestors`/`descendants`/`parents`/`children` trace the derivation DAG. The lineage bridge also emits a session reference event per read and register, so the session log and the store stay interlinked.

## Business approval

A ticket carries one subject asset through the state machine `draft → review → approved → released` (rejected returns to `draft`). The `approved` transition requires a `ReviewScope` naming the roles and workspace the approval grants; the release transition clears it. Every transition is recorded, and the first row records `from: null → draft` at creation so the history always contains the chain start.

## Audit

Every mutation writes one durable audit row in the same transaction as the store commit; denied reads write none. `listAudit` filters by workspace and action, and a workspace-less actor resolves to its single membership.

## Durability and replay

The store is one SQLite database with a monotonic `SCHEMA_VERSION` and `application_id 0x504c5348` (`'PLSH'`). Reference events (`asset/read`, `asset/register`, `platform/approval/transition`) are committed to the session log only after the store call succeeds. The package invariant companion validates every committed reference event against the store on replay, so a replayed session cannot name an asset or status the store does not hold.

## Model Experience

### Tool results as durable records

#### What the model sees

The ten tools (`register_asset`, `get_asset`, `link_asset`, `asset_ancestors`, `asset_descendants`, `submit_ticket`, `get_ticket`, `list_tickets`, `approve_ticket`, `audit_query`) return the control-plane records — asset, lineage edge, ticket, and audit event — as their result content. These are the same records the store committed; the model reads the authoritative durable form, never a derived view. A read denied by RBAC returns a `PERMISSION_DENIED` tool error instead of a record.

#### Token effect

Each tool result appends the returned record or records to the session history. A denied call appends the error text, not the record. Lineage, ticket, and audit reference events are log-only and add no model tokens.

#### KV Cache effect

Tool results append after the reusable history prefix. The control-plane service mutates no system prompt and no earlier request tokens, so an already-reusable prefix stays reusable across the turn; the durable records appear only in new result content.

## Known Limitations and Deferred Work

- **In-process single-file store** — one SQLite file in one process; the package provides no network or multi-process control plane, so concurrent harness processes over one store are unsupported.
- **Actor resolution is a consumer obligation** — the tools need a session→platform-user mapping supplied by the consumer (`ResolveActor`); without one, the tools fail loud with `UNKNOWN_ACTOR`. The package ships the resolver type, not a built-in binding.
- **Approval is a recorded state machine, not an execution gate** — the service enforces the allowed transition edges, but nothing prevents a caller with direct store access from acting; the service boundary is the only enforced wall.
- **Audit is not tamper-evident** — audit rows commit in the same transaction, but the file has no signing or append-only enforcement against external writers.
