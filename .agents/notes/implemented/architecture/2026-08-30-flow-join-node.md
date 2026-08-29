# Agent Note: Flow Join node (explicit reconverge after parallel fan-out)

Status: implemented

English | [中文](2026-08-30-flow-join-node.zh.md)

## Problem

`validateFlow` rejected any merge whose incoming branches could both run. A condition or classify class split is exclusive, so those merges were legal; a parallel fan-out is not exclusive, so two arms that met at an agent, template, or aggregator were refused. Dify's palette has an explicit Join for that reconverge. Without it, a canvas could fan out but could not wait and continue once.

## Decision

1. **`FlowJoinNode`** (`type: 'join'`) carries no extra fields. `validateFlow` allows at most one unlabeled outgoing edge, refuses a labeled edge, and skips the "both can run" merge error when the shared successor is a join. A merge after a loop body/after split is still rejected. `graphToRows` refuses `join`, same as other non-agent types.
2. **Compile waits at the fan-out, not inside each arm.** An arm whose only successor is a join returns `OUT` instead of `visit(join)`. A fan-out whose every arm is that join, or a node whose only successor is that join, emits `await parallel([...]); return await visit(joinId)`. The join body is `phase(id)` then unlabeled continuation. Join is not seedable.
3. **Run surface follows template.** `service.ts` `onPhase` treats `join` like `condition`/`loop`/`template`/`aggregate`/`list`: mark `running` on `phase(id)`, settle on the next node event or `workflow/end`.
4. **Canvas** — Join lands in the Logic palette group. Inspector is the type/id hint only. Glyph/card/type use `--dsw-static-green-500`.

## Alternatives considered

- **Implicit join at any shared successor** — rejected: an unlabeled merge after fan-out would hide whether the author meant exclusive or concurrent work, and exclusivity analysis would stop being a fail-loud check.
- **Give join `workflow/node-start`/`node-end`** — rejected: the node does no host round trip; `phase()` is the same gate as template.

## Consequences

- Fan-out without a join is still rejected when the arms share a non-join successor.
- A join does not combine outputs; authors place an aggregator after the join when they need one object.

## Testing

Keyless: `packages/workflow/flow/tests/{compile,validate,service}.spec.ts` (fan-out waits then visits join; arms return `OUT`; merge at join accepted; two outgoing edges and a label rejected; `phase`-based status). `packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` covers the default factory and type parse. No client-render test for the palette entry — same debt as HTTP/Template/Code.
