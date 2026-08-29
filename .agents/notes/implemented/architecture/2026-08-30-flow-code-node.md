# Agent Note: Flow Code node bound to ctx.codeRuntime (never bare eval)

Status: implemented

English | [中文](2026-08-30-flow-code-node.zh.md)

## Problem

The flow canvas ([packages/workflow/flow](../../../../packages/workflow/flow)) had seven node kinds (`start`/`end`/`agent`/`condition`/`loop`/`http`/`template`) and no way to run a short program against upstream outputs without spinning up a subagent or interpolating a string — Dify's node palette has a dedicated Code node for this. A tempting implementation is `eval`/`new Function` inside the workflow script's own `node:vm` realm; that would run author code with the same authority as the orchestration script and skip every compute, output, and heap cap `dsh-code-runtime` already owns.

## Decision

1. **`FlowCodeNode`** ([types.ts](../../../../packages/workflow/flow/src/types.ts)) carries a single required `source` (a JS/TS program body). `validateFlow` rejects an empty `source`; `compile.ts`'s `codeBody` emits `OUT[id] = await code(<quoted source>, { phase: id, out: OUT })`, then visits its edge(s), fanning out through `parallel()` like an agent when it has several. The source is quoted with `q()` (JSON string), never `templateLiteral`: `${...}` inside it stays literal program syntax for the sandbox. `expand.ts` rewrites `OUT[...]` references inside a sub-graph's `source` the same way it rewrites prompts, `http` `url`s, and templates.
2. **Host/worker RPC, not in-worker eval** — `dsh-workflow-worker-thread` adds a `code()` hook that posts `CodeExecute` to the host; the host calls `ctx.codeRuntime.run()` (`dsh-code-runtime-worker-thread`) and replies `CodeExecuted` / `CodeExecuteError`. When the hook receives `out`, it splices `const OUT = <json>;` ahead of `source` so the sandboxed program reads prior node outputs as `OUT['<nodeId>']`. A failed program is still a fulfilled `CodeRunResult` (value/error/logs); only an unusable runtime is a fatal `CODE_EXECUTE` workflow error. The hook pairs `workflow/node-start`/`workflow/node-end` like `http()`.
3. **`codeRuntime` is a hard engine dependency** — rejected a missing-runtime skip: the engine's `static inject` now includes `codeRuntime` next to `web`, and a composition that loads the engine without a `CodeRuntime` provider fails loud at load. `dsh-code-runtime-worker-thread` is mounted on the host plane (`dsh-base`), so PTC and the workflow Code node share one sandbox provider; the Web and headless overlays no longer remount it.
4. **Canvas wiring** — `mode-graph.ts` adds `code` to the placeable types and the same unlabeled `wireOutgoing` path as `http`/`template`; `ModeComposer.tsx` adds a Code entry under the Transform palette group, a node-card preview, and a source inspector textarea (`setSelectedSource`); `AgentModeSection.module.css` styles the node with `--dsw-static-deepseek-600` so it is distinct from `http` (blue) and `template` (amber).
5. **Preset composition graphs reject `code` nodes** — `graphToRows` throws for a `code` node exactly as it already does for `condition`/`loop`/`http`/`template`: a preset row is an agent composition entry, and a code node carries no agent semantics to project onto one.

## Alternatives considered

- **Bare `eval` / `new Function` in the workflow worker's vm** — rejected: that is the same trust realm as the orchestration script, has no compute/output/heap caps, and would make a Code node indistinguishable from a hostile script injection. The plan's "never bare eval" rule is the reason this node exists as a host-side sandbox call.
- **e2b or shell/subprocess as the first sandbox** — considered and rejected for v1: `ctx.codeRuntime` + `dsh-code-runtime-worker-thread` is the production-ready, already-composed worker-thread isolate used by PTC, with the same host-RPC pattern as `http()`. e2b remains experimental; shell/subprocess would force a language and a process-launch policy this node does not need.
- **Compile `source` as a JS template literal like an agent prompt** — rejected: a Code node's source is program text. Splicing `${OUT['id']}` at compile time would turn author-written template syntax into workflow-script interpolation and hide the real program from the sandbox. Prior outputs travel as a JSON `OUT` prelude instead.

## Consequences

- `dsh-workflow-worker-thread` now requires both `web` and `codeRuntime` in the same composition; any host that loads the engine (directly, or via `dsh-tool-workflow`/`dsh-tool-ralph`) must also load `dsh-code-runtime-worker-thread`, and fails loud at load otherwise.
- A code node participates in today's exclusivity-only merge rule exactly like an agent or http node: it can fan out through `parallel()` but cannot be a reconvergence point (join-after-parallel remains deferred, [engine followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.md)).
- The sandbox is containment, not a security boundary — the same caveat `dsh-code-runtime-worker-thread` already documents for PTC. A Code node is still preferable to `eval` in the workflow vm because it gets that runtime's caps and a separate worker.

## Testing

Keyless: `packages/workflow/flow/tests/{compile,validate,service}.spec.ts` (code node compilation including opaque quoting, fan-out, and sub-graph `source` rewriting; empty-`source` validation; branch-label and fan-out exclusivity; `node-start`/`node-end` lifecycle projection), `packages/workflow/workflow-worker-thread/tests/{session,workflow-worker-thread}.spec.ts` (the `code()` hook round-tripping through a stubbed and a real `ctx.codeRuntime.run`, `OUT` prelude splicing, a refused run surfacing as a fatal `CODE_EXECUTE` error, and the cancel-races-run timing cases). `packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` covers the Code node's default factory, type parsing, and outgoing-edge wiring. No client-render test yet for the new Code palette entry, card, and inspector field in `ModeComposer.tsx` — the same debt as the Checklist panel, HTTP node, and Template node; `apps/web/tests/orchestration-studio.e2e.ts` exercises the composer's general chrome but does not assert the Code node specifically.
