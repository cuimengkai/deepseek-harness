# Agent Note: Preset composition as a chain-projected FlowGraph

Status: implemented

English | [中文](2026-08-24-preset-composition-flow-graph.zh.md)

## Problem

The preset composition model was an ordered row list, and the flow engine's `FlowGraph` was the session-flow canvas's vocabulary. The two never met: a preset could not be edited as a graph, the graph could not name the plugins a preset mounts, and the composition rows and the canvas layout (node ids, positions, edges) had no shared authoring path. Phase B ("Agent 即 Flow") requires the preset composer to become the flow canvas, which needs the graph to BE the composition's authoring source while the row order stays load-bearing for mounting.

## Decision

A preset composition is the **chain projection** of a `FlowGraph`: `start` → one agent node per row → `end`, in mount order. Row semantics ride on a new optional `composition` field on `FlowAgentNode` — `{ module, id?, group?, config?, disabled?, inject? }`, exactly the `ComposeRow` subset — so `graphToRows` is lossless and `AgentPresets.compose`'s row validation accepts its output unchanged. `agentOptions` stays the flow domain's LLM-binding vocabulary; validate/compile/run ignore `composition`, and the session flow canvas never sets it.

Two skins, one authoring primitive. `agent.cordis.yml` stays the discovery marker and MOUNT source; `mount`, `read`, and `readRows` are untouched. A companion `agent.flow.json` beside it holds layout, positions, and edges. `composeGraph` derives the rows from the graph (`graphToRows`) and writes both files in one atomic commit; on open, `readGraph` serves the stored graph only while `graphToRows(stored)` still equals the rows parsed from the composition file, and otherwise regenerates a fresh chain graph from the rows. The staleness rule is the safety net for a partial dual-file write: a hand edit or a legacy rows-compose write wins, and an older preset with no graph file regenerates on open.

The store is preset-owned: `agent.flow.json` lives under the preset directory, not `.dsh/flows`, because a preset's layout is per-deployment scope like its composition and `.dsh/flows` is the engine's session-flow store. The document carries its own `formatVersion` 1 and a 256 KiB cap; flow persistence is not imported.

The wire carries the graph through two privileged methods mirroring `read`/`compose`: `agentPreset.readGraph` and `agentPreset.saveGraph`. The payload is structure — the graph — never composition text or a path, the same trust class as rows. `saveGraph` runs `graphToRows` then the same three-way validation as `compose` (non-empty rows, module-per-row, unique ids; the inventory-backed `assertResolvable` proof; user-authored overwrite). Both keys are loopback-pinned in `dsh-client-connection` beside the other five composition methods.

## Alternatives considered

- **Carry row semantics on `agentOptions`** — rejected: `agentOptions` is the flow domain's LLM-binding vocabulary (provider/model/modelKinds); overloading it with mounting rows would leak preset semantics into the engine's compile path. A separate `composition` field keeps the engine ignorant and the row projection lossless.
- **Regenerate the layout from rows on every open, with no stored file** — rejected: the canvas must persist node ids, positions, and edges across edits; a stored layout file is the graph authoring surface.
- **Store the graph in `.dsh/flows` through flow persistence** — rejected: that store is the engine's session-flow store, scoped per `<cwd>` and owning the engine's own format version; a preset's layout is per-deployment like its composition, and reusing the engine store would couple the two domains' formats and lifetimes.
- **Make the stored graph authoritative and regenerate the rows from it on read** — rejected: the composition file is the mount source and the only composition editor besides this package; an authoritative graph would silently drop a hand edit to `agent.cordis.yml` on the next graph save. The staleness rule keeps the composition authoritative and the layout a cache.
- **Give `composeGraph` its own validation instead of reusing `compose`'s** — rejected: the projected rows are the same value `compose` validates, so a second validation would drift; `composeTo` is the single three-way validation both authors share.

## Consequences

- `agentPreset.readGraph`/`saveGraph` are the canvas-facing wire methods; `saveGraph` reuses `compose`'s validation, so a graph that cannot project rows is refused before any write.
- A condition or loop node, an agent node without `composition.module`, or a cycle is refused with "branching is a later phase" — the preset domain stays a chain until the B3 sub-orchestration slice.
- `copyComposition` is a whole-directory copy, so the companion graph travels verbatim with a copy while `preset.yml` is rewritten; the agent-presets README Known Limitations records the divergence.
- The composition file remains the mount source and the only row truth. Preset graphs are authoring-only and never compiled or run, so `model-visible ⟺ logged` is unaffected and no snapshot is due in this change.
- B1b's preset canvas consumes `readGraph`/`saveGraph` and reuses the pure graph helpers from `ui-flow-editor`; the module palette replaces PipelineCanvas, which retires.

## Testing

Keyless coverage pins the domain and the wire. `conversion.spec.ts` proves round-trip losslessness (order, id, module, config, disabled, group, inject), id-less rows, non-chain DAG ordering, condition/loop and cycle refusal, and `graphRowsMatch` staleness. `authoring.spec.ts` covers the dual-file write, the `readGraph` round-trip, stale-layout regeneration, the size cap, and the overwrite/occupancy refusals. The apiproxy wire suite covers `readGraph`/`saveGraph` over the full carrier path. The real-composition e2e in `web-agent-presets.e2e.ts` proves a graph-composed preset's agent mounts with the expected tools through the shipped bundle.
