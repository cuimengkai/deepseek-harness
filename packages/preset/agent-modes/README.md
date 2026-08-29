---
description: "Product modes that bind an agent preset to an executable entry flow for users and maintainers."
kind: "reference"
---

# @deepseek-ai/dsh-agent-modes

English | [中文](README.zh.md)

## Summary

An **agent mode** is a product unit that binds one [agent preset](../agent-presets/README.md) to an executable [flow](../../workflow/flow/README.md) graph. Creating a session with `agentMode` resolves the bind, mounts the named preset, and stamps both `agentMode` and `agentPreset` on the session header. Modes do not mount plugins themselves and do not replace the preset composer: branching orchestration lives in the mode's `flows/`, while capability composition stays in the preset. This package ships a runtime benchmark sample (`hello-orchestration` → `orchestration-sample`) whose entry graph uses only engine-backed features (agent + provider/model, condition, loop, parallel fan-out, OUT/loop interpolation); user modes land under `$DSH_HOME/.agent-modes`.

## On-disk layout

```
<mode-id>/
  mode.yml                 # optional display metadata
  bind.yml                 # preset + entryFlow + defaultArgs
  flows/<id>.flow.json     # FlowGraph documents (formatVersion 1)
```

User modes land in `$DSH_HOME/.agent-modes` when `includeUserRoot` is true. `includeShippedRoot` defaults on so the learning sample under package `modes/` is visible.

## Config

| Field | Default | Role |
|---|---|---|
| `default` | unset | Mode id when a caller names none |
| `roots` | `[]` | Extra scan roots (`path`, `trust`) |
| `includeShippedRoot` | `true` | Prepend the package `modes/` root (ships `hello-orchestration`) |
| `includeUserRoot` | `true` | Append `$DSH_HOME/.agent-modes` |

## Service API (`ctx.agentModes`)

| Method | Role |
|---|---|
| `list` / `resolve` | Roster discovery (broken modes stay visible) |
| `resolveBind` | Healthy bind (`preset`, `entryFlow`, `defaultArgs`) |
| `readEntryFlow` / `readFlow` / `saveFlow` | Mode-owned flow documents |
| `create` / `updateBind` / `copy` / `write` / `remove` | User-root authoring |
| `select` | Blank-session switch: remount bound preset + log mode |
| `tryRun` / `getTryRun` | Canvas try-run under a session agent via `flowEngine` |
| `startEntry` | Scenario session start: run the bound entry flow under the live agent |

Remote namespace `agentModes`: `list`, `read`, `readFlow`, `saveFlow`, `create`, `saveBind`, `copy`, `deleteMode`, `select`, `tryRun`, `getTryRun`, `startEntry`.

## Model Experience

### Request context and condition

#### What the model sees

Nothing directly from this package. A mode only chooses which preset mounts and which flow may later run; tool schemas and prompt sections come from the bound preset and from subagents the flow starts.

#### Token effect

Zero-direct.

#### KV Cache effect

Independent — no prompt contribution.

## Known Limitations and Deferred Work

- Session create stamps the mode and mounts the preset; it does not auto-start the entry flow. The client calls `agentModes.startEntry` on first user intent ([scenario product path](../../../.agents/notes/implemented/architecture/2026-08-29-scenario-agent-product-path.md)).
- Per-node `childPresetId` mounts that preset for one-shot in-process children (workflow try-run / `agent()`); continuable cold-resume still joins the parent until the descriptor persists the override.
- Parallel fan-out join and HITL nodes remain flow-engine follow-ons; `modelKinds.text` request routing has landed ([Agent Note](../../../.agents/notes/implemented/architecture/2026-08-30-agent-loop-modelkinds-text-routing.md)).
- Web new-session hero chip is not wired yet; use `session.create({ agentMode })` or blank-session `select` after authoring.
