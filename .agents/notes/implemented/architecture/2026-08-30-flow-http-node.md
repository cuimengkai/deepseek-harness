# Agent Note: Flow HTTP Request node and generic processing-node lifecycle

Status: implemented

English | [中文](2026-08-30-flow-http-node.zh.md)

## Problem

The flow canvas ([packages/workflow/flow](../../../../packages/workflow/flow)) had five node kinds (`start`/`end`/`agent`/`condition`/`loop`) and no way to reach an external HTTP endpoint — Dify's node palette has an HTTP Request node as one of its most-used External Integration kinds. The run surface also had only one child-lifecycle event pair (`workflow/agent-start`/`workflow/agent-end`), so a non-agent processing node had no way to report `running`/`done` status or duration to the canvas.

## Decision

1. **`FlowHttpNode`** ([types.ts](../../../../packages/workflow/flow/src/types.ts)) carries a single required `url` (a JS template-literal expression, same interpolation rules as an agent prompt: `${variable}`, `${OUT['<nodeId>']}`) and no method, header, or body fields. `validateFlow` rejects an empty `url`; `compile.ts` emits `await http('<url>', { phase: '<id>' })`, records `OUT[id]`, then visits its edge(s) — fanning out through `parallel()` like an agent when it has several. `expand.ts` rewrites `OUT[...]` references inside a sub-graph's `url` the same way it rewrites prompts.
2. **Scope is GET-only, no custom headers, reusing `ctx.web.fetch()` directly** — rejected inventing a flow-specific URL allow-list `Config`: `dsh-web`'s own SSRF, redirect, and size/time policy is already the deployment-configured gate for any host-initiated fetch, and a second allow-list would duplicate that policy with its own drift risk. `dsh-workflow-worker-thread` now requires a `web` service in the same composition and fails loud at load when it is absent (added to `apps/cli`'s test profile, `dsh-tool-workflow`, and `dsh-tool-ralph`'s test setups, all of which mount the engine).
3. **Generic `workflow/node-start`/`workflow/node-end` event pair** ([dsh-workflow types.ts](../../../../packages/workflow/workflow/src/types.ts), [index.ts](../../../../packages/workflow/workflow/src/index.ts)) — rejected an `http`-specific event pair: the same infra (a `WorkflowNodeInfo`/`WorkflowNodeEndInfo` pairing by `seq`, mirroring `agent-start`/`agent-end`) will carry every future non-agent processing node (Template, Code, Aggregator) without adding a new event pair per kind. `dsh-workflow-worker-thread`'s worker (`runtime.ts`) emits them around its `http()` hook call; the host (`host.ts`) forwards them; `dsh-flow`'s service (`service.ts`) projects them onto `FlowRunSnapshot.nodeStatuses`/`nodeDurationsMs`/`nodeOutputs` exactly like agent nodes. The `dsh-workflow` invariant (`invariant.ts`) extends its pairing check to cover node lifecycles the same way it covers agent lifecycles, including the force-settle grace path that synthesizes a `cancelled` end for a stranded start.
4. **Canvas wiring** — `mode-graph.ts` adds `http` to the placeable node types; `ModeComposer.tsx` adds an HTTP palette entry, node-card preview, and a URL inspector field (`setSelectedUrl` action mirrors the existing `setSelectedExpression`/`setSelectedIterable` pattern); `AgentModeSection.module.css` adds the node's glyph/card/type styling.

## Alternatives considered

- **Full HTTP method/header/body support in v1** — considered and rejected for scope: GET-only with `ctx.web.fetch()` covers the common "call a webhook / read an API" case; method/header/body needs its own validated `Config` surface (which headers/methods are permitted) and is deferred to a follow-on rather than bolted on ad hoc.
- **Have the flow-graph node carry the RPC directly (worker calling `ctx.web` in-process)** — rejected: the worker thread has no direct access to host services; the existing host/worker RPC pattern used for `agent()` (a typed request/reply pair with cancellation racing the reply, `HttpFetch`/`HttpFetched`/`HttpFetchError` in `protocol.ts`) is the established, tested pattern for any host-side capability a script needs.

## Consequences

- A canvas author who needs a POST, custom headers, or a request body cannot express it yet; only `GET` with no headers is reachable from the `http` node.
- `dsh-workflow-worker-thread` now has a hard `web` service dependency, not merely an `agent()`-shaped one; any composition that loads the engine (directly, or via `dsh-tool-workflow`/`dsh-tool-ralph`) must also load `dsh-web` plus a fetch provider (`dsh-web-fetch-http`), and fails loud at load otherwise.
- `workflow/node-start`/`workflow/node-end` are the first event pair besides `agent-start`/`agent-end` that a `WorkflowRun` implementation must pair correctly (or let the grace force-settle synthesize a cancelled end); a future engine that skips them narrates no node lifecycle to a canvas caller, but nothing else breaks since they are additive, optional-in-practice events.
- Join-after-parallel and the Variable Inspector (per-node inputs, edit, single-node re-run) remain deferred ([engine followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.md)); an `http` node participates in today's exclusivity-only merge rule exactly like an agent node.

## Testing

Keyless: `packages/workflow/flow/tests/{compile,validate,service}.spec.ts` (http node compilation including fan-out and sub-graph `url` rewriting, empty-`url` validation, node-start/node-end lifecycle projection), `packages/workflow/workflow/tests/invariant.spec.ts` (node-start/node-end pairing, including the malformed/unpaired case), `packages/workflow/workflow-worker-thread/tests/session.spec.ts` and `tests/workflow-worker-thread.spec.ts` (the `http()` hook round-tripping through a real and a stubbed `ctx.web.fetch`, a refused fetch surfacing as a fatal `HTTP_FETCH` error, and the cancel-races-fetch timing cases). No client-render test yet for the new HTTP palette entry, card, and inspector field in `ModeComposer.tsx` — the same debt as its Checklist panel ([mode-composer-checklist-gating](2026-08-30-mode-composer-checklist-gating.md)); `apps/web/tests/orchestration-studio.e2e.ts` exercises the composer's general chrome but does not assert the HTTP node specifically.
