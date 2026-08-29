# Agent Note: Flow Question Classifier and Parameter Extractor nodes

Status: implemented

English | [中文](2026-08-30-flow-classify-extract-nodes.zh.md)

## Problem

The flow canvas had script-realm helpers (template, aggregate, list) and host-round-trip nodes (http, code) but no dedicated LLM-backed structured node. Dify's palette has a Question Classifier (classify input into exclusive classes, then branch) and a Parameter Extractor (fill a named-parameter object). Authors could fake both with a plain `agent` node plus a later `condition`, but that overloads `agent` (whose contract is "run a subagent prompt") and leaves class edges unlabeled, so exclusivity analysis treats a reconverge as a parallel merge.

## Decision

1. **`FlowClassifyNode`** (`type: 'classify'`) carries `query` (JS template literal) and `classes: { id, name? }[]`. `validateFlow` requires a non-empty query, at least two unique non-empty class ids, and reserves `default` as the unmatched-class label. Each class id needs exactly one outgoing edge; `default` is optional. Compile emits `agent(instruction, { phase, schema: { class: enum } })`, then exclusive `if (_cls === id) visit(...)` arms; a null / unknown structured result visits `default` or returns `OUT`. Class splits are exclusive, like a condition.
2. **`FlowExtractNode`** (`type: 'extract'`) carries `query` and `parameters: { name, type, description?, required? }[]` with `type` in `string | number | integer | boolean`. Compile emits `agent(instruction, { phase, schema })` whose schema is that object, then unlabeled continuation (terminal / one edge / `parallel()` fan-out) like an agent. `graphToRows` refuses both types.
3. **Run surface follows `agent`, not `phase()`** — both nodes make a real `agent()` host round trip, so `service.ts` already moves them through `agent-start`/`agent-end`. No new hook.
4. **Canvas** — Classifier lands in the Logic palette group; Extractor in Transform. Inspector is a query textarea plus `id: name` (classify) or `name[!]: type description` (extract) lines.

## Alternatives considered

- **Keep these as configured `agent` nodes** — rejected: class edges would stay unlabeled, exclusivity would reject a legal reconverge, and the inspector would hide the schema contract behind a free-form prompt.
- **Give classify a script-realm `phase()` gate only** — rejected: the work is an LLM call; wrapping it as a gate would hide `agent-start`/`agent-end` from Last Run.

## Consequences

- A classify merge is valid; an extract fan-out merge is still rejected until join lands.
- The compiled schema is the closed `assertObjectJsonSchema` subset already enforced by `agent({ schema })`.

## Testing

Keyless: `packages/workflow/flow/tests/{compile,validate,service}.spec.ts` (schema emission, default fallback, subgraph query rewrite, class-edge validation, exclusive merge, `agent-start`/`agent-end` status). `packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` covers defaults, type parsing, inspector text, and classify edge wiring. No client-render test for the new inspector fields — same debt as HTTP/Template/Code/Aggregator.
