# Agent Note: Flow childPresetId runtime and try-run node I/O

Status: implemented

English | [中文](2026-08-30-flow-child-preset-and-try-run-io.zh.md)

## Problem

Mode orchestration graphs need Dify-like SYSTEM/USER authoring, per-node child presets, and Last Run inspection of node status, duration, and output. Compile already accepted `childPresetId` as authoring-only; try-run snapshots exposed only `nodeStatuses`, so ModeComposer could not show output or duration.

## Decision

1. **`FlowAgentNode.systemPrompt`** — optional; validate requires at least one of `systemPrompt` / `prompt` non-empty for non-embedding agents; compile concatenates system then user with a blank line via one template literal.
2. **`childPresetId` runtime** — compile emits it into `agent()` options; the worker-thread engine validates and forwards it on `ChildStartRequest` / `SubagentStartRequest`; `applyChildComposition` mounts that preset when set (async) instead of `composeFrom`; `childSessionMeta` stamps the child header `agentPreset`. No new subagent capability flag (in-process override).
3. **Try-run I/O** — `FlowRunSnapshot` adds `nodeDurationsMs` (agent-start → agent-end) and `nodeOutputs` (from the completed script's returned `OUT`); `getTryRun` / ModeComposer Last Run consume them.

## Alternatives considered

- **Capability-gate `childPresetId` like `agentOptions`** — rejected for now: only in-process drivers with `agentPresets` can mount; out-of-process providers ignore the field.
- **Stream outputs on `workflow/agent-end`** — deferred: the event payload has no result value; completed `OUT` is enough for Last Run.

## Consequences

- Continuable cold-resume still joins the parent unless a future descriptor persists `childPresetId`.
- Parallel join and `modelKinds` request routing remain deferred ([engine followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.md)).

## Testing

Keyless: `packages/workflow/flow/tests` (compile/validate/service), `packages/workflow/workflow-worker-thread/tests` (option forward), `packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts` (mount + header stamp).
