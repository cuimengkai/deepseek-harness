# Agent Note: Flow Variable Aggregator and List Operator nodes

Status: implemented

English | [中文](2026-08-30-flow-aggregate-list-nodes.zh.md)

## Problem

The flow canvas had eight node kinds and no script-realm way to combine several upstream outputs or take first/last/length of a list without an `agent` call or a Code node. Dify's palette has a Variable Aggregator (named inputs → one variable) and a List Operator (first/last/length/reverse/flatten) for exactly this. Join-after-parallel is still refused, so a Dify-shaped aggregator that *waits* for concurrent arms cannot exist yet; the missing piece that *can* ship now is a combine over serial or exclusively-branched outputs, plus closed list operators.

## Decision

1. **`FlowAggregateNode`** (`type: 'aggregate'`) carries `items: { name, expression }[]` and `mode: 'object' | 'first' | 'concat'`. `validateFlow` requires at least one item, unique non-empty names, non-empty expressions, and a known mode. `compile.ts` emits `phase(id)` then a script-realm IIFE that evaluates each expression (same trust model as a condition) and combines them: `object` writes `{ [name]: value }`, `first` returns the first non-nullish value, `concat` flattens arrays and wraps scalars. `expand.ts` rewrites `OUT[...]` inside each item expression.
2. **`FlowListNode`** (`type: 'list'`) carries `source` (a JS expression) and `op: 'first' | 'last' | 'length' | 'reverse' | 'flatten'`. `validateFlow` rejects an empty source or unknown op. Compile emits `phase(id)` then an IIFE that coerces a non-array to a one-element list (`null`/`undefined` → `[]`) and applies the operator. Filter-by-predicate is deferred: v1 is the closed op set.
3. **Run surface follows template, not http** — both nodes are synchronous script-realm expressions, so `service.ts` marks them `running` on `phase(id)` and settles them on the next node event or `workflow/end`. No new host hook, no `workflow/node-start` pair.
4. **Canvas** — palette Transform group gains Aggregator and List Operator; inspector is a mode/op select plus a `name: expression` textarea (aggregate) or source textarea (list). `graphToRows` refuses both types, same as `http`/`template`/`code`.

## Alternatives considered

- **Wait for A3 join and only then add aggregator** — rejected: exclusive condition merges already exist, and serial combine/list ops are useful without join. The node documents that it does not wait for parallel arms.
- **One node type with an open expression language** — rejected: a free-form reducer is a Code node. Closed `mode`/`op` tags keep validation and the inspector enumerable.
- **Give these nodes `workflow/node-start`/`node-end`** — rejected for the same reason as template: there is no host round trip to narrate.

## Consequences

- An aggregator after a parallel fan-out is still rejected by exclusivity analysis; authors combine exclusive branches or serial outputs until join lands.
- List filter/map/sort-by-expression remain a Code node, not a second language on `list`.

## Testing

Keyless: `packages/workflow/flow/tests/{compile,validate,service}.spec.ts` (compile including fan-out and sub-graph rewrite; empty/duplicate/unknown-mode validation; `phase`-based status). `packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` covers defaults, type parsing, and item-text round-trip. No client-render test for the new inspector fields — same debt as HTTP/Template/Code.
