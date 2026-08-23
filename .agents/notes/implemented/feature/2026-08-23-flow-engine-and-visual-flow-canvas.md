# Agent Note: Flow engine and visual flow canvas

Status: implemented

English | [中文](2026-08-23-flow-engine-and-visual-flow-canvas.zh.md)

## Problem

The agent loop runs one linear turn chain; a session cannot orchestrate multiple agents with branches and loops, and the workbench offers no visual surface for authoring such a workflow. The requested capability is multi-agent orchestration with branching plus a canvas to build it, delivered without reworking the loop, which the "plugins, not loop changes" rule reserves for the extension points.

## Decision

A separate flow capability, `@deepseek-ai/dsh-flow`, compiles a visual `FlowGraph` into a `dsh-workflow` script via `compileFlow` and runs it off the main agent loop through `ctx.workflowEngine.start({ script, meta, parent, signal })`. The `FlowEngine` service declares `inject: ['workflowEngine']` and throws `FLOW_ENGINE_ABSENT` when the engine is not composed. A graph node is `start`, `end`, `agent`, `condition`, or `loop`; the engine emits `agentOptions.provider`/`model` only when `!== undefined`, so a cleared field must drop the key rather than send an empty string.

The host persists each graph as `<root>/.dsh/flows/<id>.flow.json` — atomic write (0600/0700), `FLOW_FORMAT_VERSION = 1`, path-traversal guard on the kebab-case `id`, and rejection of an oversized or no-longer-valid document. The apiproxy domain exposes the `flow.list/get/save/delete/run/getRun/listRuns/stop` RPC chain; an absent engine answers `flow-unavailable`.

`@deepseek-ai/dsh-client-ui-flow-editor` renders the canvas as one `conversation.view` entry ("Flow") at ring order 15 — after trajectory (10) and before the develop-mode insight tabs (20+). A per-session `FlowEditorController` keys off the session's current `cwd` from the sessions feed, so a workspace switch reloads the canvas for the new directory; it lists and opens saved flows, saves and deletes them (minting the id from the graph name on first save), edits nodes and edges locally, runs with a JSON input box (a parse failure refuses the run before any wire traffic), polls `flow.getRun` every 800 ms until a run settles, paints per-node status, and lists run history. Without the engine the canvas is read-only and renders a notice. The entry is general-purpose and not gated to any agent preset.

## Verification

The flow engine and apiproxy domain carry unit and RPC tests; the canvas carries 28 client tests covering the pure graph helpers, controller behaviors (starter graph, save/delete, connect refusals, invalid-input refusal, poll settle, stop, disposal), and the slot registration (order 15, per-session controller caching). The client bundle builds with only type-only `dsh-flow` imports, the client aggregate typechecks, the slot catalog regenerates and verifies, and the README trio passes `doc-sync`.

## Alternatives considered

**Branching inside the agent loop.** Rejected: extending `agent-loop` with condition and loop steps touches the core and contradicts the extension-point rule; the separate engine keeps the loop untouched.

**RPC-only orchestration without a canvas.** Rejected: the approved scope is the engine plus the visual canvas, so the web surface authors and watches flows instead of the model driving them.

**Client-side gating of the engine.** Rejected: the wire reports `flow-unavailable` when the engine is absent, so the canvas's read-only state follows the composed host rather than a client heuristic.

## Consequences

A session with the flow engine composed can author and run branching multi-agent workflows from the workbench; sessions without it see a read-only notice. Flows are scoped per session `cwd` and are not shared. v1 accepts acyclic graphs only (a loop cannot revisit a node with carried state) and rejects reconvergent parallelism (a merge after a parallel fan-out or loop split); run status is polled, not pushed, and the service emits no `flow/*` events. The model cannot author or run a flow mid-session — a `tool-flow` consumer is deferred.
