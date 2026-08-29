# Agent Note: WorkBuddy full parity with Dify-grade mode orchestration

Status: proposed

English | [中文](2026-08-30-workbuddy-dify-full-parity.zh.md)

## Problem

WorkBuddy-aligned shell IA and a Mode = preset + flow split already ship, but Operators still lack Dify-grade fine control (node Settings / Last Run, SYSTEM·USER, categorized palette, live `childPresetId` / `modelKinds` / join) and Experts depth (Skill Map, Integrations cards). Placeholders for Projects / Automation and “connectors” chrome overpromise Host backends that do not exist. A single demo slice cannot close the gap; the product needs a phased, engine-honest landing plan.

## Proposal

Land full parity in ordered phases on the existing architecture (dsw tokens; presets mount tools/skills; modes own FlowGraph):

0. Contract note + **Use for new session** stamps `agentMode` via `agentModes.select` (not preset-only).
1. ModeComposer Settings | Last Run, SYSTEM·USER authoring, model catalog, publish-as-save.
2. Engine: `childPresetId` runtime, `modelKinds` routing, join after parallel, try-run node I/O.
3. Categorized palette with honest capability deep-links (no fake tool nodes).
4. Experts tabs: Skills Map + Integrations from `pluginInventory` (no marketplace ratings).
5. Models / Plugins product polish and cross-links.
6. Projects / Automation as real Harness surfaces (workspaces; jobs / flow runs); retire connector-market nav copy.
7. Results / session density + orchestration e2e.
8. Samples, docs, gate hygiene.

Reject dark Dify reskins, fake OAuth connector stores, branching on `agent.cordis.yml`, and session dual chips (scenario + capability).

## Alternatives considered

- **One mega-PR demo studio** — rejected: cannot land engine join / routing safely; review blast radius.
- **Hosted expert / skill marketplace** — rejected: no backend; map to local presets, filesystem skills, inventory cards.
- **Restore session scenario dock** — rejected: [scenario product path](../../implemented/architecture/2026-08-29-scenario-agent-product-path.md).

## Success criteria

- Each phase merges with tests and an updated acceptance row in this note’s Consequences checklist.
- Mode “Use for new session” leaves `projectionValues.agentMode` set and the bound preset mounted.
- Operators can author SYSTEM·USER, inspect Last Run I/O, and run engine-backed join / childPreset / modelKinds on a shipped sample.
- Experts Skills + Integrations browse real Host data; Projects / Automation are operable without inventing SaaS backends.

## Consequences

Checklist (update when a phase ships):

- [x] Phase 0 — contract + `agentModes.select` on use-for-session
- [x] Phase 1 — inspector Settings / Last Run + SYSTEM·USER + Publish
- [x] Phase 2 — `childPresetId` runtime mount + try-run `nodeOutputs` / durations (`modelKinds` request routing and join-after-parallel remain deferred)
- [x] Phase 3 — categorized palette (Basic / Logic / Capability deep-link; no fake tool nodes)
- [x] Phase 4 — Skills Map + Integrations inventory cards
- [x] Phase 5 — Models / Plugins intro cross-links to Integrations / catalog sharing
- [x] Phase 6 — Projects workspaces page + Automation jobs/modes links; Experts nav without connector market
- [x] Phase 7 — Results toggle retained; orchestration-studio + WorkBuddy IA e2e
- [x] Phase 8 — this note checklist + deferred engine items documented in followups

Deferred (engine honesty, not faked in UI): live `modelKinds` request routing; join after parallel fan-out; HITL / resume.

Related: [agent-modes binding](../../implemented/architecture/2026-08-29-agent-modes-preset-flow-binding.md), [engine followups](2026-08-29-mode-orchestration-engine-followups.md), [WorkBuddy IA](../../implemented/architecture/2026-08-29-workbuddy-final-ia.md).
