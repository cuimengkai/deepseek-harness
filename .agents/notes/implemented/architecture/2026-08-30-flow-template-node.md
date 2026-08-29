# Agent Note: Flow Template node (pure string interpolation, no LLM call)

Status: implemented

English | [中文](2026-08-30-flow-template-node.zh.md)

## Problem

The flow canvas ([packages/workflow/flow](../../../../packages/workflow/flow)) had six node kinds (`start`/`end`/`agent`/`condition`/`loop`/`http`) and no way to interpolate upstream outputs into a string without spinning up a subagent — Dify's node palette has a dedicated Template node for exactly this: pure string interpolation, no model call. Before this change, a canvas author who only needed `"Hello ${OUT['fetch-name']}"` had to author an `agent` node whose prompt happened to need no completion, which is both a wasted subagent call and a misleading node (an `agent` node's contract is "this runs a subagent prompt", not "this is inert interpolation").

## Decision

1. **`FlowTemplateNode`** ([types.ts](../../../../packages/workflow/flow/src/types.ts)) carries a single required `template` (a JS template-literal expression, same interpolation rules as an agent prompt or the `http` node's `url`: `${variable}`, `${OUT['<nodeId>']}`). `validateFlow` rejects an empty `template`; `compile.ts`'s `templateBody` reuses the existing `templateLiteral` helper (already used for agent prompts) to emit `OUT[id] = \`...\`` synchronously — no hook call, no host round trip — then visits its edge(s), fanning out through `parallel()` like an agent when it has several. `expand.ts` rewrites `OUT[...]` references inside a sub-graph's `template` the same way it rewrites prompts and `http` `url`s.
2. **Run-surface tracking follows `condition`/`loop`, not `http`** — a template node has no child event pair to move it through `running`: `service.ts`'s `onPhase` marks it `running` on its compiled `phase(id)` call and lets the next node event (or `workflow/end`) settle it, exactly like a condition/loop gate. The `http` node's `workflow/node-start`/`node-end` pair exists specifically because that node makes a host round trip; a template node's body is a synchronous script-realm expression, so it gets the gate treatment, not a lifecycle event pair.
3. **No new interpolation syntax** — the node reuses the same `templateLiteral`/`rewriteOutRefs` machinery an agent prompt and an `http` `url` already use, formalized as its own node type purely for Dify-name parity and to stop conflating "subagent prompt" with "pure interpolation" in the canvas vocabulary.
4. **Canvas wiring** — `mode-graph.ts` adds `template` to the placeable node types and its own `wireOutgoing` fan-out case; `ModeComposer.tsx` adds a "Transform" palette group with a Template entry, a node-card preview, and a template-source inspector textarea (`setSelectedTemplate` action mirrors the existing `setSelectedUrl`/`setSelectedExpression` pattern); `AgentModeSection.module.css` adds the node's glyph/card/type styling (amber, distinct from `http`'s color).
5. **Preset composition graphs reject `template` nodes** — `packages/preset/agent-presets/src/conversion.ts`'s `graphToRows` throws for a `template` node exactly like it already does for `condition`/`loop`/`http`: a preset row is an agent composition entry, and a template node carries no agent semantics to project onto one.

## Alternatives considered

- **Give `template` its own `workflow/node-start`/`node-end` event pair like `http`** — rejected: that event pair exists to narrate a host round trip's start and end; a template node's body never leaves the script realm, so wrapping it in a `phase()` gate (as `condition`/`loop` already do) is the correct fit and adds no new event-pairing invariant for `dsh-workflow`'s `invariant.ts` to enforce.
- **Let an `agent` node express pure interpolation by never issuing a completion** — rejected as the status quo this node fixes: it is indistinguishable from a misconfigured agent node in the canvas, in validation, and in the run surface, and it still pays for a subagent-request lifecycle it does not need.
- **Introduce Jinja/Handlebars syntax instead of JS template literals** — rejected: JS template literals are already the interpolation language for agent prompts and the `http` node's `url`; a second templating syntax would fragment `expand.ts`'s `OUT`-reference rewriting logic across two different parsers for the same feature ("Dify-name parity", not "Dify-syntax parity", is the goal per the roadmap).

## Consequences

- A template node participates in today's exclusivity-only merge rule exactly like an agent or http node: it can fan out through `parallel()` but cannot be a reconvergence point for two branches (join-after-parallel remains deferred, [engine followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.md)).
- Every future non-agent, non-host-round-trip node (e.g. a script-realm Aggregator/List Operator) has a second precedent to follow, in addition to `http`'s host-round-trip precedent: `service.ts`'s phase-based run-surface treatment for pure script-realm nodes, versus its node-start/node-end treatment for host round trips.
- No new dependency on `dsh-web` or the workflow worker-thread's `http()` hook: a template node compiles and runs even in a composition that never loads `dsh-web`.

## Testing

Keyless: `packages/workflow/flow/tests/{compile,validate,service}.spec.ts` (template node compilation including fan-out and sub-graph `template` rewriting, empty-`template` validation, branch-label and fan-out exclusivity checks, `phase`-based lifecycle projection onto `nodeStatuses`/`nodeOutputs`). `packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` (new file) covers `mode-graph.ts`'s node-authoring helpers at 100% statement/branch coverage, including the `template` node's default factory, type parsing, and outgoing-edge wiring. No client-render test yet for the new Template palette entry, card, and inspector field in `ModeComposer.tsx` — the same debt as the Checklist panel ([mode-composer-checklist-gating](2026-08-30-mode-composer-checklist-gating.md)) and the HTTP node ([flow-http-node](2026-08-30-flow-http-node.md)); `apps/web/tests/orchestration-studio.e2e.ts` exercises the composer's general chrome but does not assert the Template node specifically.
