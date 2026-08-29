# Agent Note: Deferred flow-engine gaps for mode orchestration

Status: proposed

English | [中文](2026-08-29-mode-orchestration-engine-followups.zh.md)

## Problem

Product modes reuse `FlowGraph` for Dify-like orchestration, but several engine and runtime gaps still block parity with a full visual workflow product: join after parallel fan-out, human-in-the-loop nodes, live `modelKinds` request routing, and applying `childPresetId` when a flow agent node starts a subagent.

## Proposal

Land each gap as its own Agent Note and PR, ordered by real mode-template pain:

1. **`childPresetId` runtime** — **landed**: compile emits the option; worker accepts it; in-process `applyChildComposition` mounts the named preset and stamps the child header.
2. **`modelKinds` request routing** — **landed** for the loop's one request channel: `dsh-agent-loop`'s `buildRequest` seeds its route from `AgentOptions.modelKinds.text` before the base `provider`/`model` ([agent-loop-modelkinds-text-routing](../../implemented/architecture/2026-08-30-agent-loop-modelkinds-text-routing.md)). Other kinds (`image`, `audio`, `embedding`) remain carried-but-unconsumed until a request channel that issues them exists.
3. **Join after parallel** — **landed**: `FlowJoinNode` plus exclusivity skip and compile wait-at-fan-out ([flow-join-node](../../implemented/architecture/2026-08-30-flow-join-node.md)).
4. **Try-run node I/O** — **landed**: `FlowRunSnapshot.nodeOutputs` / `nodeDurationsMs` from OUT + agent timing; ModeComposer Last Run shows them.
5. **HITL / media nodes** — deferred until a shipped mode template needs them.
6. **Resume mid-run** — deferred.

## Open questions

- Whether `childPresetId` should require a capability flag on the subagent provider (like `agentOptions`) or stay an in-process-only override.
- Whether mode try-run should be a settings-local `flowEngine.run` or always create a visible session first.

## Success criteria

- [x] A mode agent node with `childPresetId` mounts that preset for the child and records it on the child session header.
- [x] Parallel fan-out with an explicit `join` validates and compiles; a merge at a non-join after fan-out is still rejected.
- [x] `modelKinds` on a flow agent node changes the child's routed requests in a keyless test.
