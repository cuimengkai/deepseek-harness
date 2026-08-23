# @deepseek-ai/dsh-flow

English | [中文](README.zh.md)

The visual flow engine (`ctx.flowEngine`) compiles a node/edge flow graph into a `@deepseek-ai/dsh-workflow` script and runs it off-loop. A canvas authors the graph — start, agent, condition, loop, end — and the engine compiles it to the recursive script shape a model writes by hand, so branching, parallelism, and sub-orchestration need no workflow-script authoring.

## Graph vocabulary

A `FlowGraph` carries `nodes` and `edges`. Node types: `start` (exactly one, with one outgoing edge), `end` (a terminal; any node with no outgoing edges also terminates the flow), `agent` (a subagent prompt with an optional per-node `provider`/`model` override and per-kind `modelKinds` routes), `condition` (two outgoing edges labeled `true`/`false`, decided by a JS boolean `expression`), and `loop` (two outgoing edges labeled `body`/`after`, driven by an `iterable` and a `variable` bound to each item). Every other edge carries no label.

An agent node may instead embed a `subgraph` — a self-contained `FlowGraph` the node runs in place of a subagent, so the sub-graph's own agent nodes are the orchestration. Its prompt is unused (an embedding node may carry an empty one) and its `agentOptions` act as inherited route defaults for sub-nodes that omit their own.

An agent node may also carry an optional `composition` field — `{ module, id?, group?, config?, disabled?, inject? }` — that annotates the node with a preset-row's semantics when the graph doubles as a preset composition graph. The engine does not read it: validation, compilation, and runs treat the node as an ordinary agent, and the preset domain (`@deepseek-ai/dsh-agent-presets`) owns the field's meaning.

## Compilation

Each node compiles to one entry in a `NODES` map, and the script starts at `visit("start")`. An agent with one edge runs the child, records `OUT[id]`, then visits the edge; an agent with several edges fans out through the engine's `parallel()` hook; a condition calls `phase(id)` and returns a ternary over its two branches; a loop calls `phase(id)`, runs its body in a `for...of`, then visits the `after` branch; an end or terminal returns `OUT`.

Compilation first expands the graph: an embedding agent node is flattened so its sub-graph's nodes share one `NODES` map under namespaced ids (`${embedId}-sub-${subId}`, recursively for nested embeddings), and the embedding node's body runs the sub-graph's start (`await visit("...-sub-start")`) before continuing with its own edges. The sub-graph's own `agent()` calls are the orchestration; its `OUT` references — in prompts, condition expressions, and loop iterables — are rewritten to the namespaced ids so they keep pointing at its own outputs. A terminal sub-graph returns the shared `OUT`, so an embedding node records no output of its own.

Agent prompts compile as JS template literals, so a prompt may interpolate the enclosing loop's `${variable}` and prior outputs `${OUT['<nodeId>']}`; a literal backtick is escaped as `\``. Condition expressions and loop iterables are injected verbatim and evaluated in the workflow script realm, with `OUT` and `args` in scope — the same trust model as a model-written workflow script. Compilation is deterministic: an unchanged graph recompiles to an identical script.

## Validation

`validateFlow` enforces the structural rules (one start node, kebab-case id, acyclic edges, branch labels, reachability, a terminal on every path) plus a branch-context analysis. A node with several incoming edges is a merge, and a merge is valid only when every pair of incoming branches is mutually exclusive: branches diverge exclusively at a condition (exactly one arm runs), while a parallel fan-out or a loop's body/after split can run more than one branch, so reconverging after either is rejected. An embedding agent node's `subgraph` is validated recursively as its own standalone flow — a sub-graph has a single entry and its terminals have no outgoing edges, so the union graph is acyclic and well-typed iff each level is.

## Runs

`run({ graph, input?, parent, signal? })` validates, compiles, and starts the script via `workflowEngine.start`, returning a `FlowRunHandle` whose `result` resolves (never rejects) to `{ status, error?, agentsStarted }` and whose `cancel(reason?)` cancels the run. The `parent` agent attributes every child to the invoking agent. `stop(runId)` cancels a live run; `listRuns(flowId?)` lists runs newest first; `getRun(runId)` reads a live snapshot.

The service requires the `workflowEngine` service in the same composition and fails loud at load when it is absent. `Config` bounds the run surface: `maxLiveRuns` (default 20) caps concurrent runs, and `maxRunHistory` (default 100) bounds the settled runs kept in memory.

The run surface is derived from the engine's `workflow/*` events and seeded from the expanded id set: agent nodes move `pending → running → done/failed/cancelled` from `agent-start`/`agent-end`; condition/loop gates, which have no child event, are marked running by their `phase()` call and settled by the next node event or by `workflow/end`. Sub-node statuses key on their namespaced ids; an embedding node itself stays `pending` while its sub-graph runs (rolling the sub-graph's status up onto it is deferred). The service emits no events of its own — the canvas polls `getRun`.

## Persistence

`save(root, graph)` writes `<root>/.dsh/flows/<id>.flow.json` atomically (mode 0600, dirMode 0700). The kebab-case `id` doubles as the file name and is the path-traversal guard. A saved document carries `FLOW_FORMAT_VERSION = 1`; `get(root, flowId)` refuses any other version, an oversized document (1 MiB), or a document that no longer validates. `list(root)` and `delete(root, flowId)` round out the store.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-workflow`: the engine's `agent()` calls create child-agent requests and produce the `OUT` values later condition expressions, loop iterables, and prompts interpolate. The flow engine itself is driven programmatically (by the canvas RPC) and exposes no model-facing tool in v1.

#### KV Cache effect

No direct invalidation; the `dsh-workflow` provider configuration owns any request-prefix changes for the subagent calls a flow run makes.

## Known Limitations and Deferred Work

- **No model-facing tool** — v1 exposes the `FlowEngine` service and its RPC chain only; the model cannot author or run a flow mid-session. A `tool-flow` consumer is deferred.
- **Acyclic graphs only** — validation rejects cycles, so a loop cannot revisit a node with carried state; control flow beyond the `loop` node's for-of body is deferred.
- **No reconvergent parallelism** — a merge after a parallel fan-out or a loop body/after split is rejected, so a canvas cannot model a join of concurrent work.
- **Sub-graph references are rewritten by spelling** — expansion rewrites a sub-graph's `OUT['<subId>']` and `OUT.<subId>` references to the namespaced ids, because that spelling IS the reference syntax; a literal that was never meant as a reference is rewritten too. References to outer nodes (`OUT['<outerId>']`) and near-misses (`MYOUT.x`, `foo.OUT.x`) are left alone.
- **No canvas for embedding a sub-graph yet** — the engine compiles and runs `FlowAgentNode.subgraph` in-process, but the flow canvas and the `flow.*` wire schema do not carry it: a graph sent over RPC drops its sub-graphs (the request schema strips the field), so a remote `flow.run` treats an embedding node as a plain subagent. Authoring and running sub-orchestrations through the canvas is a follow-on.
- **Embedding nodes aggregate no run status** — the run surface seeds each sub-node's namespaced id, but the embedding node itself stays `pending` while its sub-graph runs; rolling the sub-graph's status up onto the embedding node is deferred.
- **Embedding nodes record no output** — a terminal sub-graph returns the shared `OUT`, so capturing it under the embedding node's id would be self-referential; read a sub-node's output by its namespaced id (`OUT['e-sub-x']`) instead.
- **No journaling or resume** — inherited from `dsh-workflow`; a process restart cannot continue a flow run.
- **Per-kind model routes are declared, not routed** — `agentOptions.modelKinds` binds a kind to a provider/model route and the compiler forwards it into the child's `AgentOptions`, but request routing does not consume kinds yet; a bound kind is carried and ignored until routing lands.
- **Run status is polled, not pushed** — the service emits no `flow/*` events, so the canvas polls `getRun` and no forwarded-RPC event is required for v1.
