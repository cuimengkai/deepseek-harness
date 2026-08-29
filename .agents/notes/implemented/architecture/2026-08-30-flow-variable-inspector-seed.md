# Agent Note: Flow Variable Inspector seed and per-node inputs

Status: implemented

English | [中文](2026-08-30-flow-variable-inspector-seed.zh.md)

## Problem

Try-run Last Run showed `nodeOutputs` / durations but not what a node *saw*, and there was no way to edit a cached output and re-run only the downstream — Dify's Variable Inspector model. Re-running the whole graph to tweak one node's result wastes every upstream `agent()` / `http()` / `code()` call.

## Decision

1. **Compile consults `SEED`** — `compileFlow(graph, { seed })` emits `const SEED = …`, records `IN[id] = { ...OUT }` at every `visit(id)`, and if `SEED` has a seedable id, writes `OUT[id] = SEED[id]` and runs `SEED_CONT[id]` (the node's unlabeled or classify continuation) instead of the body. Seedable types are agent (non-embed), http, template, code, aggregate, list, classify, extract. Start/end/condition/loop/embedding are not seedable.
2. **Script return is `{ OUT, IN }`** — `applyNodeOutputs` unwraps that envelope into `nodeOutputs` and `nodeInputs`; a bare `OUT` map (stubs / older scripts) still projects as outputs only.
3. **`FlowRunRequest.seed`** and `agentModes.tryRun(..., seed)` forward the map. ModeComposer Last Run shows selected `nodeInputs`, an editable cached-output textarea, and **Re-run from here**, which builds a seed of last-run outputs minus the selected node and its descendants (plus the edited JSON when it parses).

## Alternatives considered

- **Pass seed through `args.__dshSeed`** — rejected: pollutes the author-visible `args` global.
- **Reconstruct inputs only from predecessor outputs after the run** — rejected: that is not the `OUT` the node actually saw when a seed skip or exclusive branch omitted siblings.

## Consequences

- A seeded classify still takes exclusive class edges from the seeded `{ class }` value; a null / unknown class still hits `default` or returns `OUT`.
- Re-run-from-here does not re-execute the selected node when the edited JSON parses — it seeds that value and re-executes descendants only.

## Testing

Keyless: `packages/workflow/flow/tests/{compile,service}.spec.ts` (SEED / SEED_CONT emission, `{ OUT, IN }` projection, seed forwarded on `run`). `packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` covers `descendantIds` / `seedForRerun`. No client-render test for the Last Run textarea — same debt as other inspector fields.
