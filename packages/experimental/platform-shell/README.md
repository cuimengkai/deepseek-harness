# @deepseek-ai/dsh-experimental-platform-shell

English | [中文](README.zh.md)

A self-built platform control plane: tenant/RBAC, a business-object asset store with lineage, a business-approval flow, an audit log, a capability market, and a billing ledger, all over one SQLite database. The service injects as `ctx.platformShell`; `registerPlatformShellTools` mounts the model-visible tools. A workspace is the isolation unit, and the control plane holds a per-workspace physical-isolation record the [engine-isolation package](../../../packages/experimental/engine-isolation/README.md) routes on. The durable record types are documented in the [platform-shell subsystem catalog](../../../docs/subsystems/platform-shell.md), the [keyless demo](../../../examples/platform-shell-demo/README.md) drives the control-plane surface, the [capability-market demo](../../../examples/capability-market-demo/README.md) proves the market and ledger keyless, and the [Agent Note](../../../.agents/notes/implemented/architecture/2026-08-21-platform-shell-control-plane.md) records the placement and preset decisions.

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

## Engine isolation

A workspace is the isolation unit, and physical isolation is optional per workspace: `createWorkspace(name, {isolated})` accepts the flag at creation, `setWorkspaceIsolation(actor, workspaceId, isolated)` flips it under the `platform.isolation` permission (the `platform-admin` default role carries it), and `workspaceIsolation(workspaceId)` probes the record. An isolation flip writes one audit row, and the engine that ran the isolated drive emits the durable `platform/workspace/isolated` session event. The engine seam routes each workspace's runs on this record — see the [isolation mechanism spec](../../../docs/platform-engine-isolation.md) and the [engine-isolation package](../../../packages/experimental/engine-isolation/README.md).

## Asset store

Each asset is one durable business object with a kind, producing role, content, and workspace. `registerAsset` commits the record and writes one audit row in the same transaction, or throws; the store never half-applies. `AssetId` is allocated as `<kind>-<seq>`, so the ids chain visibly across roles (`requirement-1 → code-2 → test-case-3`).

## Lineage

`linkAsset` records that one asset derives from another; `ancestors`/`descendants`/`parents`/`children` trace the derivation DAG. The lineage bridge also emits a session reference event per read and register, so the session log and the store stay interlinked.

## Business approval

A ticket carries one subject asset through the state machine `draft → review → approved → released` (rejected returns to `draft`). The `approved` transition requires a `ReviewScope` naming the roles and workspace the approval grants; the release transition clears it. Every transition is recorded, and the first row records `from: null → draft` at creation so the history always contains the chain start.

## Capability market

The market makes capabilities publishable, combinable, and billable. `publishCapability` validates id uniqueness, dependency existence, and dependency semver ranges, and records the tool names the capability governs; `publishScenario` registers a workbench bundle — a per-customer-group capability set plus a preset binding. `assemble_capabilities` resolves a requested set dependency-first, validating version ranges and conflict pairs, and applies the execution gate: a disabled capability refuses any assembly that reaches it, and a rollout-0 capability refuses every workspace. Registering `registerCapabilityExecutionGate` turns the same gate into a runtime block: every `tools/execute` call re-checks the owning capability's live gate state per workspace and refuses `CAPABILITY_DISABLED` at invocation time. The market tools mount on every agent that consumes the seam. See the [capability-market meta-model](../../../docs/platform-capability-market.md).

Each capability's publish request also carries a `rows` fragment — the preset-tree rows the capability contributes to a workbench. `assemble_preset` closes the assembly path: it renders a workbench preset tree by appending each selected capability's rows to the role preset's base rows in catalog order, applies the overlay patches, and validates before commit — a duplicate row id refuses `ROW_ID_CONFLICT`, a tool name owned by two capabilities refuses `TOOL_NAME_CONFLICT`, and rows disabled for the current platform are reported, not refused. The tool reads the base through the consumer-supplied `resolveBaseRows` binding and appends the durable `preset/assembled` session event carrying the rendered rows; the host commits the returned rows (the capability-market demo writes them through the agent-presets `write` primitive). See the [preset assembler design](../../../docs/platform-preset-assembler.md).

## Billing ledger

A simulated integer-credit ledger. `creditAccount` opens or credits a workspace account; `consume_capability` meters usage at the capability's rate (`cost = rate × qty`), refusing `INSUFFICIENT_BALANCE` with the debit rolled back; `settle_account` closes a workspace's `open` settlement for a `YYYY-MM` period as `settled`. See the [billing ledger spec](../../../docs/platform-billing-ledger.md).

## Audit

Every mutation writes one durable audit row in the same transaction as the store commit; denied reads write none. `listAudit` filters by workspace and action, and a workspace-less actor resolves to its single membership.

## Durability and replay

The store is one SQLite database with a monotonic `SCHEMA_VERSION` and `application_id 0x504c5348` (`'PLSH'`). Reference events (`asset/read`, `asset/register`, `platform/approval/transition`) are committed to the session log only after the store call succeeds. The package invariant companion validates every committed reference event against the store on replay, so a replayed session cannot name an asset or status the store does not hold.

## Model Experience

### Tool results as durable records

#### What the model sees

The twenty tools (the ten control-plane tools `register_asset`, `get_asset`, `link_asset`, `asset_ancestors`, `asset_descendants`, `submit_ticket`, `get_ticket`, `list_tickets`, `approve_ticket`, `audit_query`, plus the ten market tools `publish_capability`, `list_capabilities`, `assemble_capabilities`, `assemble_preset`, `set_capability_gate`, `publish_scenario`, `list_scenarios`, `consume_capability`, `account_balance`, `settle_account`) return the control-plane records — asset, lineage edge, ticket, audit event, capability, scenario, usage record, settlement, and the assembled preset tree — as their result content. These are the same records the store committed; the model reads the authoritative durable form, never a derived view. A read denied by RBAC returns a `PERMISSION_DENIED` tool error instead of a record.

#### Token effect

Each tool result appends the returned record or records to the session history. A denied call appends the error text, not the record. Lineage, ticket, audit, capability, and settlement reference events are log-only and add no model tokens.

#### KV Cache effect

Tool results append after the reusable history prefix. The control-plane service mutates no system prompt and no earlier request tokens, so an already-reusable prefix stays reusable across the turn; the durable records appear only in new result content.

## Known Limitations and Deferred Work

- **In-process single-file store** — one SQLite file in one process; the package provides no network or multi-process control plane, so concurrent harness processes over one store are unsupported.
- **Isolation is a per-workspace record, not an enforcement wall** — the control plane records and routes on physical isolation, but the process-out engine the record routes to is process-level delegation (see the [engine-isolation package](../../../packages/experimental/engine-isolation/README.md)), not a security boundary; container or VM isolation is deferred to that seam's e2b-family backend.
- **Actor resolution is a consumer obligation** — the tools need a session→platform-user mapping supplied by the consumer (`ResolveActor`); without one, the tools fail loud with `UNKNOWN_ACTOR`. The package ships the resolver type, not a built-in binding.
- **The assembler renders and validates; it does not commit** — `assemble_preset` returns the validated tree and never touches the roster; the host commits the rows (the capability-market demo writes them through the agent-presets `write` primitive), and loader-level checks such as inactive rows and leaked services stay at roster mount.
- **`resolveBaseRows` is a consumer obligation** — `assemble_preset` needs the host to resolve the role preset's base rows from the roster (`ResolveBaseRows`); without the binding the tool fails loud with `INVALID_ARGUMENT`.
- **Approval is a recorded state machine, not an execution gate** — the service enforces the allowed transition edges, but nothing prevents a caller with direct store access from acting; the service boundary is the only enforced wall.
- **Audit is not tamper-evident** — audit rows commit in the same transaction, but the file has no signing or append-only enforcement against external writers.
- **Billing is a simulated ledger** — integer credits with a per-capability rate card; there is no real payment, currency, or settlement outside the store.
- **A workbench is a scenario bundle, not a page** — the proven artifact is the bundle descriptor (capability set + preset binding) served per customer group over the harness plugin mechanism; actual page rendering lives in the web-app layer.
- **Runtime gating is an opt-in registration, not the default** — `resolveCapabilities` and `consumeCapability` always refuse a disabled or rollout-excluded capability loudly; turning that gate into a runtime block requires registering `registerCapabilityExecutionGate` with the consumer's session→workspace binding, and without it a gated tool is enforced only by its absence from the mounted composition.
- **A dangling dependency edge cannot exist** — publish validates every dependency and the foreign-key chain refuses unpublishing a referenced capability, so `CAPABILITY_DEPENDENCY_MISSING` is unreachable through the service.
