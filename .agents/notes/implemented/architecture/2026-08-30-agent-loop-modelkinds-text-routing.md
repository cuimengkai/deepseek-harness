# Agent Note: `AgentOptions.modelKinds.text` overrides the agent loop's one request channel

Status: implemented

English | [中文](2026-08-30-agent-loop-modelkinds-text-routing.zh.md)

## Problem

`AgentOptions.modelKinds`, `FlowAgentOptions.modelKinds`, and the worker-thread `agent()` call's `modelKinds` option all already carried a per-[`ModelKind`](../../../../packages/llm/llm/src/types.ts) provider/model override end to end — compile emission, worker validation, `ChildStartRequest`, and the mounted child's durable `AgentOptions` — but every layer's own comment said "declaration only until request routing consumes kinds." Nothing at request time ever read the field, so setting `modelKinds` on a flow agent node changed nothing about how that node's child actually made model calls.

## Decision

`dsh-agent-loop`'s single request channel is always [`ModelKind`](../../../../packages/llm/llm/src/types.ts) `text` — the loop has exactly one waterfall (`agent/request`) and it always serves the turn/step conversation loop, never an image, audio, or embedding call. `ReactLoopAgent.buildRequest` ([packages/core/agent-loop/src/agent.ts](../../../../packages/core/agent-loop/src/agent.ts)) therefore seeds its base route as `{ provider: modelKinds?.text?.provider ?? options.provider, model: modelKinds?.text?.model ?? options.model }` instead of always reading `options.provider`/`options.model` directly. Either side of a `modelKinds.text` binding may be absent, inheriting the same-named base field, matching every other per-kind binding's stated semantics. This seed still only applies on the loop instance's first request (later turns restore from the persisted header, same as before); the `agent/request` waterfall (live model switching, `dsh-core/agent` `model-selection.ts`) still runs afterward and can override further.

Other kinds (`image`, `audio`, `embedding`) remain carried into `AgentOptions.modelKinds` on the child but have no live consumer: no request channel in this codebase issues an image, audio, or embedding call yet. Every JSDoc that called this "declaration only" is updated to state which kind is live and why the rest are not yet.

## Alternatives considered

- **Add a `kind` parameter to the `agent/request` waterfall payload** — rejected: no caller has a second kind to pass yet (see above); adding an unused parameter now would be speculative surface with no exercising caller, against this repo's "no hardcoded tunables"/"explicit at the point of use" conventions. Revisit when a real image/audio/embedding request channel exists.
- **Resolve `modelKinds` in `dsh-workflow-flow`/`dsh-workflow-worker-thread` instead of `dsh-agent-loop`** — rejected: those packages only assemble the child's `AgentOptions`; they never make a model request themselves, so resolving there would duplicate the loop's own provider/model precedence logic instead of composing with it.

## Consequences

- A flow agent node's `agentOptions.modelKinds.text` now changes the *live* provider/model of the compiled `agent()` call's child, not just its persisted options — closing the acceptance criterion in [mode-orchestration-engine-followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.md).
- `image`/`audio`/`embedding` bindings remain inert until their own request channel lands; that channel's design (and whether it reuses this same seed shape) is deferred, not decided here.
- Join after parallel fan-out is the one remaining item from the engine-followups note that Track A still needs.

## Testing

Keyless: `packages/core/agent-loop/tests/agent.spec.ts` (a `modelKinds.text` override routes the request to a different registered provider/model; a partial override inherits the missing field from the base route; a `modelKinds` entry for another kind never affects the text request).
