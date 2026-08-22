# Capability Market Meta-model

English | [中文](platform-capability-market.zh.md)

> Companion to [platform-architecture.md](platform-architecture.md) (D5, D4): the capability market is the catalog-and-assembly layer that makes a platform capability (plugin + preset + asset schema) discoverable, combinable, and traceable. This spec defines the meta-model — the packaging unit, the catalog entry, and the publish/consume flow. The packaging triple is grounded in `examples/platform-agent-demo/`; the catalog, resolution, gating, and billing are realized in `@deepseek-ai/dsh-experimental-platform-shell` and proven keyless by `examples/capability-market-demo/`.

## 1. The packaging unit

One capability packages three things (D5):

| Part | Meaning |
|---|---|
| plugin | the tool(s) / service(s) behind the capability |
| preset | the role tool surface the capability contributes |
| asset schema | the data shape the capability produces (see [platform-asset-schema.md](platform-asset-schema.md)) |

A capability is not one of these — it is the triple. `register_asset`, `get_asset`, and the credential tools in the prototype are the demo's capability; each role preset contributes the role surface; each asset kind is the schema.

## 2. The catalog entry

| Field | Meaning |
|---|---|
| `id` | the capability id (plugin name) |
| `name` | display name |
| `role` | which role preset it attaches to |
| `dependencies` | capabilities it requires, each with a semver range |
| `conflicts` | capabilities it cannot coexist with |
| `execution` | `managed \| sandboxed \| none` (D4) |
| `tools` | the tool names the capability governs; a registered runtime gate blocks their execution when the gate is closed |
| `rows` | the preset-tree rows the capability contributes to a workbench — appended after the role's base rows in catalog order and validated by the assembler before the tree is committed |
| `version` | the packaged semver |
| `rate` | the per-unit credit cost (see [platform-billing-ledger.md](platform-billing-ledger.md)) |
| `enabled` / `rollout` | the execution gate: a disabled or rollout-excluded capability refuses assembly loudly, and a registered runtime gate refuses its tools at call time |

The market catalog stores each entry as a `capabilities` row plus `capability_dependencies` / `capability_conflicts` edge tables, and the capability's workbench memberships in `scenario_capabilities` — all in the platform-shell control-plane store.

## 3. Publish and consume

- **Publish**: `publishCapability` validates id uniqueness, dependency existence, and each dependency range; `publishScenario` registers a workbench bundle (id, display name, workbench id, role, preset id, capability ids). Unpublishing a capability that others depend on is refused by the foreign-key chain, so a dependency edge can never dangle.
- **Consume**: `assemble_capabilities` resolves the requested set (see §4) into the ordered capability set the workbench mounts, and `consume_capability` meters the usage against the workspace account.

## 4. Assembly-time checking

`resolveCapabilities` walks the dependency graph dependency-first, validates every visited capability's version range, checks the full conflict-pair matrix, and applies the execution gate — a disabled capability refuses any assembly that reaches it, directly or as a dependency, and a rollout-0 capability refuses every workspace. Every refusal is loud (`PlatformShellError` with `CAPABILITY_CONFLICT`, `VERSION_MISMATCH`, or `CAPABILITY_DISABLED`); nothing is skipped silently. The resolved set is ordered dependency-first, which is the order the workbench mounts. The same gate also governs execution at call time when the runtime gate is registered (§5).

## 5. The realized market

The market's catalog, resolution, gating, and billing live in the `capability-market` module of `@deepseek-ai/dsh-experimental-platform-shell`, served to agents through the `publish_capability`, `list_capabilities`, `publish_scenario`, `list_scenarios`, `assemble_capabilities`, `assemble_preset`, `set_capability_gate`, `consume_capability`, `account_balance`, and `settle_account` tools. The workbench is a scenario bundle — a per-customer-group capability set plus a preset binding — registered over the harness plugin mechanism; page rendering is the web-app layer's concern. Billing is the simulated integer-credit ledger specified in [platform-billing-ledger.md](platform-billing-ledger.md).

`assemble_preset` closes the assembly path: it renders a workbench preset tree by appending each selected capability's `rows` fragment to the role preset's base rows in catalog order, applies the overlay patches, and validates before commit — a duplicate row id refuses `ROW_ID_CONFLICT`, a tool name owned by two capabilities refuses `TOOL_NAME_CONFLICT`, and rows disabled for the current platform are reported, not refused (see [platform-preset-assembler.md](platform-preset-assembler.md)).

The catalog entry also records the tool names each capability governs (`capability_tools`), and `runtimeCapabilityOwningTool(toolName)` reverse-looks-up the live catalog row for one tool. `registerCapabilityExecutionGate(ctx, { resolveWorkspace })` plugs a `tools/execute` waterfall that re-checks every gated tool's owning capability against the calling session's workspace and throws `CAPABILITY_DISABLED` at invocation time — the assembly-time gate becomes a runtime block. The read joins the live gate row, so an operator's gate flip takes effect on the next call.

## 6. Verification

`examples/capability-market-demo/` proves the market keyless: the operator publishes the catalog, two customer-group workbenches serve disjoint capability sets, the product assembly rejects a conflict and a version-range mismatch loudly, a disabled dependency and a rollout-0 capability refuse, and the billing ledger meters usage and settles both periods — all reconstructed from persisted session logs. The same drive proves the runtime gate: the same `analyze_code` call is admitted while `code-analysis` is enabled and refused `CAPABILITY_DISABLED` after the operator disables it between turns. The guided-build section proves the assembler: a creator agent renders a validated preset tree from declared capabilities, the host commits the rows to the roster, and a fresh agent mounts them, with the composed system prompt carrying the base persona plus each capability persona in catalog order.
