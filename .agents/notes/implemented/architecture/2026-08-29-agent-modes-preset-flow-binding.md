# Agent Note: Product modes bind a preset to an executable flow

Status: implemented

English | [中文](2026-08-29-agent-modes-preset-flow-binding.zh.md)

## Problem

Users want Dify-style interactive orchestration when creating product modes such as short-video generation or multi-person audio drama: per-node models, branching, and multi-agent collaboration. The agent-preset canvas correctly refuses branching because `agent.cordis.yml` is an ordered plugin list with no runtime edges ([preset canvas note](2026-08-23-agent-preset-canvas-composer.md)). Putting orchestration into the preset format would invent affordances the mount cannot express.

## Decision

Introduce **agent modes** as a parallel product unit: `Mode = preset bind + entry FlowGraph + display metadata`. Modes live under `packages/preset/agent-modes` (`ctx.agentModes`), with on-disk layout `mode.yml` / `bind.yml` / `flows/<id>.flow.json`. Session create accepts `agentMode`, resolves `bind.preset`, mounts that preset, and stamps both `agentMode` and `agentPreset` on the session header. Branching orchestration stays in `dsh-flow`; capability composition stays in `dsh-agent-presets`. The Web Agent hub (`/settings/agent`) hosts presets and modes as sibling tabs (`dsh-client-ui-agent-preset` owns the hub + presets tab; `dsh-client-ui-agent-mode` registers the modes tab) so operators **create**, bind, and edit modes under `$DSH_HOME/.agent-modes`. The package ships a learning sample pair: preset `orchestration-sample` and mode `hello-orchestration` (read-only; copy to edit). The sample entry graph is a **runtime benchmark**: only engine-backed features — agent prompts with `${OUT[…]}` / loop-variable interpolation, per-node `provider`/`model`, condition `true`/`false`, loop `body`/`after`, and parallel fan-out without join. Deferred authoring fields (`childPresetId`, `modelKinds` routing, join, HITL, subgraph) are omitted from the sample. `includeShippedRoot` defaults to true so that sample is visible. Read-only canvas keeps React Flow handles mounted so shipped sample edges still render.

`FlowAgentNode.childPresetId` is emitted into `agent()` options; the workflow worker forwards it on the child start, and in-process composition mounts that preset (stamping the child header) instead of joining the parent when set.

## Alternatives considered

- **Branching on the preset composition canvas** — rejected: the composition is a mount-time row list; condition/loop edges have no mount semantics ([canvas note](2026-08-23-agent-preset-canvas-composer.md)).
- **Store mode flows only under `.dsh/flows`** — rejected: a mode's entry flow is deployment-scoped like its bind, not workspace-scoped like the engine's session-flow store.
- **Auto-start the entry flow on session create** — deferred then rejected for empty auto-run: create stamps and mounts; the client starts `agentModes.startEntry` / `flowEngine.run` on first user intent ([scenario product path](2026-08-29-scenario-agent-product-path.md)).

## Consequences

- `agentModes` is optional beside `agentPresets`; a deployment without modes keeps the preset-only path.
- Session header gains optional `agentMode` without bumping `SESSION_FORMAT_VERSION` (pre-release: no on-disk compatibility promise).
- Mode Remote namespace mounts through `dsh-api-remotes` beside `agentPresets`.
- Engine follow-ons that remain deferred: parallel join, HITL nodes, and `modelKinds` request routing ([engine followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.md); [childPresetId runtime](2026-08-30-flow-child-preset-and-try-run-io.md)).

## Testing

Keyless `packages/preset/agent-modes/tests` cover discovery, bind health, create/updateBind/copy/delete, empty shipped root, session projection, and the invariant companion. Session-controller create maps `UnknownModeError` / `ModeInvalidError` to Remote codes.
