# Agent Note: Embed sub-graphs for flow sub-orchestration

Status: implemented

English | [中文](2026-08-24-flow-embed-subgraph.zh.md)

## Problem

The flow engine already branches (`condition`/`loop`) and fans out (an agent with two or more edges compiles to `parallel`), but an agent node could only run a single subagent. Composing a hierarchy of orchestrators — one agent whose decision dispatches a whole self-contained flow of several agents — required hand-writing a workflow script, because the flat graph gave no way for a node to own a sub-flow. The request was multi-agent orchestration and branching, and this is the engine slice that lets one graph node run a sub-graph.

## Decision

An agent node may carry a `subgraph` — a self-contained `FlowGraph` the node runs in place of a subagent. The sub-graph's own `agent()` calls are the orchestration; no outer machinery schedules its nodes. The embedding node's `agentOptions` are inherited route defaults for sub-nodes that omit their own, and its prompt is unused, so an embedding node may carry an empty prompt (the empty-prompt check skips it).

Compilation flattens first. `expandGraph(graph)` returns one flat graph plus an owner map: sub-node and sub-edge ids are namespaced `${embedId}-sub-${subId}` (recursively, so a nested embedding yields `embed-sub-embed-sub-…`), and the embedding node's compiled body runs the sub-graph's namespaced start (`await visit("…-sub-start")`) before its own continuation — a single edge visits the child, a terminal returns `OUT`, and two or more edges fan out through `parallel`. The script begins at the root start, the one node whose owner is itself.

Sub-internal `OUT` references — in agent prompts, condition expressions, and loop iterables — are rewritten from the bare sub-node id to the namespaced id by a strict-token substitution: `OUT['a']`/`OUT["a"]`/`OUT.a` are rewritten only when `a` is an id in that sub-graph, and only when `OUT` is not itself a member of a longer expression (`MYOUT.a`, `foo.OUT.a`, and references to outer or sibling ids stay). In the flow vocabulary that spelling IS the reference syntax, so a literal that was never meant as a reference is rewritten too — a documented contract, not a bug (recorded in the README's Known Limitations).

Validation is recursive per level rather than over the flattened graph: each `subgraph` is validated as its own standalone flow (exactly one start, acyclic, branch labels, exclusivity), with `checkIdentity` false because a sub-graph's `id`/`name` are labels, not the persisted file name. The union graph through an embedding node is acyclic and well-typed iff each level is — a sub-graph has a single entry and its terminals have no outgoing edges, so a cycle, an unreachable node, a bad branch label, or a reconvergent merge can only live at one level, and validating the flat graph would wrongly trip the exactly-one-start rule on its multiple start-typed nodes.

The run surface is seeded from the expanded id set, so `getRun` reports per-sub-node statuses under their namespaced ids, and `WorkflowMeta.phases` carries the expanded namespaced titles, which match the sub-graph's `phase()` calls by exact string. The embedding node itself stays `pending` while its sub-graph runs.

## Testing

`compile.spec.ts` pins the compiled embedding shape (namespaced keys, rewritten refs, `visit(nsStart)`, deterministic recompile); `validate.spec.ts` accepts a plain and a branching sub-graph and refuses a cyclic sub-graph, a missing true/false edge, and an unreachable sub-node; `service.spec.ts` seeds the expanded id set, forwards the nested branch to both terminals, and derives namespaced sub-node statuses from `phase` and agent events. The full flow suite is green (compile 13, validate 24, service 17) and `tsc` is clean.

## Alternatives considered

**Validate the flattened graph.** The flat graph carries the sub-starts, all start-typed, so the exactly-one-start rule would reject every embedded graph. Recursive per-level validation keeps each level's own rules intact, and the single-entry/no-outgoing-terminal property makes the union's soundness follow from both levels'.

**Capture the embedding node's output and aggregate its status.** A terminal sub-graph returns the shared `OUT`; recording it under the embedding node's id would be self-referential, so the node records no output and the supported route is reading a sub-node's output by its namespaced id (`OUT['e-sub-x']`). Rolling the sub-graph's statuses up onto the embedding node is deferred with the canvas.

**Run the sub-graph as a nested flow.** A separate engine run per embedding node would keep two run surfaces, two phase vocabularies, and two cancellation domains, and re-open the merge-exclusivity question across runs. Inlining into one flat graph keeps one of each and preserves the acyclic guarantee trivially.

## Consequences

The engine slice ships now: `FlowAgentNode.subgraph` compiles, validates, and runs in-process, with the expanded run surface and the rewritten references. The sub-orchestration authoring UX (embedding a sub-graph on the canvas), the `flow.run` wire for sub-graphs (the request schema strips `subgraph`, so a remote `flow.run` treats an embedding node as a plain subagent), and run-surface aggregation onto embedding nodes are deferred with the canvas. There is no `FLOW_FORMAT_VERSION` bump — `subgraph` is an optional node field, and a persisted graph that carries one validates on read.
