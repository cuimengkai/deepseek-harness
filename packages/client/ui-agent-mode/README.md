---
description: "Web GUI agent-mode roster and orchestration canvas."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-mode

English | [中文](README.zh.md)

## Summary

Settings **Agent** hub **Orchestration** tab for [agent modes](../../preset/agent-modes/README.md): create and maintain user scenarios under `$DSH_HOME/.agent-modes`, bind each to a capability preset, and edit the entry `FlowGraph` on a Dify-style canvas. Registers `settings.agent.tab` `modes` into the hub owned by `@deepseek-ai/dsh-client-ui-agent-preset` (`/settings/agent?tab=modes`). **Use for new session** starts a blank session and calls `agentModes.select` so the session stamps **`agentMode`** and mounts the bound capability preset, then returns home (session UI does not show a scenario chip). Try-run starts a draft graph under the current session via `agentModes.tryRun` (does not switch that session's preset). Creator handoff saves dirty changes, starts a blank session, and selects the `cordis` preset so the model can edit mode files. Bound-capability links open `/settings/agent?tab=presets&preset=…`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package alongside `@deepseek-ai/dsh-client-ui-agent-preset` and `@deepseek-ai/dsh-agent-modes`; the Orchestration tab then appears under `/settings/agent?tab=modes`.

### Canvas node palette

The composer places six node kinds on the `FlowGraph`: `start`/`end` (structural), `agent` (a subagent prompt), `condition` (a JS boolean branch), `loop` (a `for...of` body/after split), `http` (a `GET` fetch), and `template` (pure string interpolation over prior outputs, no model call). Each kind gets its own palette entry, node-card preview, and inspector field set; `mode-graph.ts` owns the shared node-authoring helpers (default node shape, id minting, edge wiring) that every kind reuses.

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

Nothing from this package. Mode selection and flow authoring are host/client UI; runtime model-visible content comes from the bound preset and flow child agents.

#### Token effect

Zero-direct.

#### KV Cache effect

Independent.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Canvas palette / insert-on-edge / connect gestures are wired for Agent, Condition, Loop, HTTP Request, Template, Code, Aggregator, List, Classifier, Extractor, and Join; HITL nodes remain deferred with the flow engine. Live `childPresetId` mount and try-run `nodeOutputs` / `nodeDurationsMs` / `nodeInputs` ship with the flow engine.
- Scenario start needs a stamped `agentMode` and an open session; it does not create one.
- Try-run needs an open session (to attribute child agents); it does not create one.
- No client-render test yet for the palette entry, card preview, and inspector field of the `http` or `template` node kinds — `apps/web/tests/orchestration-studio.e2e.ts` exercises the composer's general chrome but does not assert either node specifically; unit coverage lives in `tests/mode-graph.client.spec.ts` for the shared authoring helpers only.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: per-node-kind render tests

Each new processing node kind (`http`, `template`, and any that follow) currently ships with engine-side unit coverage (`dsh-flow`'s `compile`/`validate`/`service` specs) and shared-helper coverage (`mode-graph.client.spec.ts`) but no render assertion for its own palette entry, card preview, or inspector field in `ModeComposer.tsx`. A per-kind render test suite would close this gap without waiting for the whole composer to reach full coverage.

</details>
