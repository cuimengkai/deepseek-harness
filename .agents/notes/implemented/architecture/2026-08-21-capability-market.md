# Agent Note: Complete the capability market with billing and a pluggable workbench

Status: implemented

English | [中文](2026-08-21-capability-market.zh.md)

## Problem

The platform-architecture doc ([§7, D1, D4, D5, D8](../../../../docs/platform-architecture.md)) plans a C-side capability market after the B-side control plane ships: explicit dependency/conflict checks, graded versions, billing/settlement, a C-side workbench where users assemble capabilities to taste, and restricted execution gated per capability on a gray-release basis. The increment-1 control plane (`@deepseek-ai/dsh-experimental-platform-shell`) owns tenant/RBAC, assets, lineage, approval, and audit, but no catalog, resolution, gating, or billing. The planned Phase 2 called for completing the market in the same store and proving it keyless.

## Decision

`packages/experimental/platform-shell` gains a `capability-market` module: pure database functions plus pure resolution, wired into the existing mutate/audit/RBAC/session-event machinery. Catalog and billing are new tables in the same SQLite store (`SCHEMA_VERSION` → 2): `capabilities`, `capability_dependencies`, `capability_conflicts`, `scenario_bundles`, `scenario_capabilities`, `accounts`, `usage_records`, `settlements`. The service surface grows `publishCapability`, `unpublishCapability`, `listCapabilities`, `getCapability`, `setCapabilityGate`, `publishScenario`, `unpublishScenario`, `listScenarios`, `getScenario`, `resolveCapabilities`, `consumeCapability`, `accountBalance`, `listUsage`, and `settleAccount`, plus nine model-visible tools.

Resolution (`resolveCapabilities`) is a pure function: it walks the dependency graph dependency-first, validates every visited capability's semver range, checks the full conflict-pair matrix, and asserts each capability's execution gate (disabled or rollout-0 refuses loudly with `CAPABILITY_DISABLED`). The resolved set is ordered dependency-first, which is the order the workbench mounts.

Billing is a simulated integer-credit ledger: each catalog entry carries a `rate`, `consumeCapability` debits `rate × qty` and refuses `INSUFFICIENT_BALANCE` with the debit and audit rolled back, and `settleAccount` closes a workspace's `open` settlement for a `YYYY-MM` period as `settled`.

The workbench is a scenario bundle: a per-customer-group capability set plus a preset binding registered through the harness plugin mechanism and served by the market. In this harness repo the proven artifact is the mechanism — the bundle descriptor and its service — not the rendered page, which belongs to the web-app layer.

`examples/capability-market-demo/` proves the market keyless: the operator publishes the catalog and closes billing periods, the product-engineering customer assembles and meters consumption, and the short-video-creation customer assembles its own workbench; two scenario bundles serve disjoint capability sets, and the roster binds each agent to its workbench's preset.

Two facts shaped the implementation beyond the plan:

- **`unpublishScenario` joined the service surface.** Unpublishing a capability cascades its workbench memberships (`scenario_capabilities` is ON DELETE CASCADE), so the demo's catalog-fix — unpublish and re-publish a corrected capability — requires re-publishing its scenario to restore the workbench. The plan's tool surface lacked the scenario unpublish, so it joined alongside `publishScenario`.
- **`CAPABILITY_DEPENDENCY_MISSING` is unreachable through the service.** `publishCapability` validates every dependency edge, and the foreign-key chain RESTRICTs deleting a referenced capability (`capability_dependencies.depends_on`), so a dependency edge can never dangle. The demo proves the nearest reachable case instead: a gated-off dependency refuses the assembly loudly with `CAPABILITY_DISABLED`, and the orphan-proof probe shows the raw foreign-key refusal.

## Alternatives considered

**Move the market into its own package.** The module is self-contained (pure db functions + pure resolution) and could be lifted to a package in a later phase, but keeping it in platform-shell reuses the mutate/audit/invariant/session-event machinery and one store, which is the right foundation while the market is experimental.

**Bill with real payment.** The user directed a simulated integer-credit ledger with a per-capability rate card — keyless, no real currency, no external settlement — so the ledger is durable and audited but not real money.

**Render the workbench as a page.** The workbench is a web-end, pluggable surface; different customer groups get different workbenches. In this harness repo the proven artifact is the mechanism (scenario bundle + capability set + preset binding), with page rendering deferred to the web-app layer and recorded as a Known Limitation.

**Read the roster binding from a session event.** `roster.mount` binds the agent's scope chain but appends no `agent-preset/selected` session event (only the apiproxy host layer writes it). The demo reads the live binding via `roster.composedPreset` instead of the event.

**Key the scripted mock off total user message count.** The tool-skill plugin injects its skill catalog as a user message (`source.kind === 'skill-catalog'`) at each turn start after the prior turn's tool results, which breaks naive turn counting and last-message tool-result access at turn boundaries. The mock filters directives by `source.kind === 'user'` and treats a turn boundary whose last message carries no tool-result block (the prior turn's text reply or the injected catalog) as the first step of the new turn.

## Consequences

The market, gating, and billing live in one durable, replayable store with the control plane, so the session log and the invariant companion cover them like every other record; the cost is that the market is part of an experimental package that no release package depends on. The simulated ledger and descriptor-only workbench are deliberate scope boundaries — real payment and page rendering remain outside this repo. The FK-restricted dependency edges make one planned error code unreachable through the service; the demo documents the nearest reachable refusal and the evidence JSON notes the gap.
