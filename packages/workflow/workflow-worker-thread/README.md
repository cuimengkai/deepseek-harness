---
description: "The worker-thread workflow engine: executes model-written orchestration scripts off the host event loop, for users and maintainers choosing or configuring execution isolation."
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-worker-thread

English | [中文](README.zh.md)

## Summary

`dsh-workflow-worker-thread` implements the workflow engine with one Node worker thread per run: the orchestration script executes inside a fresh worker while its `agent()` calls reach host subagents over a typed host/worker protocol. A synchronous script loop cannot block the harness event loop, and a script that ignores cancellation can be terminated with its worker. The isolation is containment, not a security boundary — a model-written script has the same trust premise as the model's existing bash access, and escaping the `node:vm` context recovers the worker's process authority. Mount this engine to give `ctx.workflowEngine` a concrete implementation; a composition that loads it with `dsh-tool-workflow` gives the model the `workflow` tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this engine when a composition needs the workflow capability: each orchestration script runs in its own worker thread, off the host event loop, and the `workflow` and `ralph` tools in the shipped composition execute on it. Do not use it as a sandbox for genuinely untrusted scripts — hostile code needs a separate-process or container engine.

### Minimal configuration

Loading the engine registers `ctx.workflowEngine`; adding `dsh-tool-workflow` on top gives the model the `workflow` tool. The engine also requires a `web` service (e.g. `dsh-web` + `dsh-web-fetch-http`) for its `http()` hook and a `codeRuntime` service (e.g. `dsh-code-runtime-worker-thread`) for its `code()` hook, and fails loud at load when either is absent. Every config field is optional:

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-web-fetch-http'
- name: '@deepseek-ai/dsh-code-runtime-worker-thread'
- name: '@deepseek-ai/dsh-workflow-worker-thread'
- name: '@deepseek-ai/dsh-tool-workflow'
```

Inside the worker, the script receives `args` and these hooks:

- `agent(prompt, { label, phase, schema, model, modelKinds, childPresetId })` starts one host-side subagent. With a schema it returns the structured value; otherwise it returns final text. An ordinary failed child yields `null`. `modelKinds` binds model kinds to per-kind provider/model routes, forwarded into the child's `AgentOptions`; the child's single request channel consumes the `text` binding to override its base provider/model, while `image`/`audio`/`embedding` bindings stay carried and inert until a request channel for those kinds exists. `childPresetId` is forwarded on the host start request so in-process composition can mount that preset on the child.
- `http(url, { phase })` issues one host-side `GET` through `ctx.web.fetch()` and returns `{ status, headers, body }` (or `null` on an ordinary fetch failure). This engine requires the `web` service in the same composition and fails loud at load when it is absent; there is no separate flow-specific allow-list — `dsh-web`'s own SSRF, redirect, and size/time policy is the only gate. `http()` carries no method, header, or body options in v1.
- `code(source, { phase, out? })` runs `source` host-side through `ctx.codeRuntime.run()` — never a bare `eval` inside the script's own vm context — and returns the run's `{ value?, logs, error? }` (a failed program is still a fulfilled call; only an unusable code runtime is fatal). When `out` is present it is spliced ahead of `source` as a `const OUT = <json>;` prelude, giving the sandboxed program the same `OUT['<nodeId>']` access pattern the flow compiler gives other node kinds. This engine requires the `codeRuntime` service in the same composition and fails loud at load when it is absent.
- `parallel(thunks)` runs thunks under the configured concurrency limit.
- `pipeline(items, ...stages)` passes `(previous, item, index)` without a cross-stage barrier.
- `phase(title)` and `log(message)` emit observer narration.

Every `agent()`, `http()`, and `code()` call pairs `workflow/agent-start`/`workflow/agent-end` or `workflow/node-start`/`workflow/node-end` narration around it, so a canvas-driven caller (e.g. `dsh-flow`) can project per-node running/done status without polling the script.

Unknown options, malformed arguments, unsupported schemas, tripped caps, provider-start failures, a refused `http()` fetch or `code()` run, and infrastructure result failures are fatal workflow errors. No timers or filesystem API are intentionally injected; the only network reachable from the script is `http()`'s bounded path through `ctx.web`, and the only code execution is `code()`'s bounded path through `ctx.codeRuntime`, though the trust caveat above still applies.

## Run sequence

`start()` validates meta, parses the body, resolves a registered normalized provider route, and resolves any per-run total-child cap before creating a worker or publishing `workflow/start`. A requested `maxTotalAgents` must be a positive safe integer no greater than the engine's configured deployment ceiling. Source mode installs TypeScript transforms through a data-URL bootstrap; built mode passes sibling `lib/worker.cjs` as a filesystem path because pkg's VFS hook expects CommonJS. Both work under ordinary Node. A ready/go handshake prevents a start-signal cancellation racing worker boot from executing the script's initial synchronous slice.

For each `agent()` call:

1. The worker sends `child-start` with a plain-data prompt and options.
2. The host calls the start request's provider override, or otherwise the configured provider, through async `SubagentRuntime.start`, passing the workflow's parent and one canonical per-run abort signal. Provider choice applies to every child in that run and is not visible to the script.
3. If start rejects, the host sends `child-start-error`; provider startup has already reached quiescence and no child lifecycle event is emitted.
4. If start fulfills while the workflow still admits work, the host records the run, observes `result`, then sends `child-started`. Even an already-settled result is forwarded afterward, preserving start-before-result order.
5. The worker emits paired `workflow/agent-start` and `workflow/agent-end` narration and requests child disposal after collection.

Provider starts are tracked separately from published children. If cancellation, worker death, or normal workflow settlement closes admission while a start is pending, the shared signal aborts it. A provider that nevertheless fulfills after closure is disposed by the host and never announced to the worker.

## Value boundary

Values leaving the script pass through `materializeFromRealm`, which accepts plain, lossless JSON data and rejects exotic prototypes, functions, symbols, cycles, sparse arrays, non-finite numbers, and nested `undefined`. The walk runs in the worker, and defines object keys as data properties so `__proto__` cannot mutate a prototype.

Child results are projected and snapshotted before crossing from the host to the worker. This is a real process-like serialization boundary; it is deliberately different from trusted same-process workflow and subagent event payloads, which are borrowed immutable values.

## Cancellation and disposal

`WorkflowRun.cancel()` records the first reason, tells the worker to cancel, aborts the one signal shared by every pending and published child, and arms the `disposeGraceMs` timer. Worker hooks then throw `CANCELLED` at their next await. If the run remains unsettled at the deadline, the host resolves it as cancelled, pairs stranded child lifecycle events, and terminates the worker.

The subagent seam has one cancellation channel: the request signal. There is no separate child-cancel RPC. Published child teardown uses `run.dispose()`; pending provider starts remain provider-owned until their promise rejects or fulfills.

Normal settlement also aborts pending starts and begins disposing any published fire-and-forget children before the result becomes externally settled. The host's quiescence condition includes both pending starts and published child disposals, so cleanup does not forget an async startup transaction.

`dispose()` is idempotent. It cancels the run, starts host-driven disposal immediately, waits for result plus child quiescence up to the same grace, terminates the worker unconditionally, and performs a final survivor sweep. Per-child disposal is memoized so worker RPC, host cancellation, death cleanup, and public disposal all join one operation.

## Outcome and event guarantees

Terminal outcome is first-wins at host claim points. An accepted external cancellation overrides a later non-cancelled worker result; a result or worker death that claims first cannot be rewritten by reentrant cleanup callbacks.

Worker error, message failure, or premature exit closes message admission before cleanup, then resolves `error` unless cancellation already owns the run. Late queued messages cannot create children or narrate after that logical boundary.

The host keeps a ledger of forwarded child starts. A graceful worker supplies their ends; death or force termination synthesizes any missing end as cancelled. Every forwarded `workflow/agent-start` is therefore paired exactly once, although cleanup after an already-arrived workflow result may complete afterward.

## Config

| Field | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | Host-side subagent provider used by `agent()` calls. |
| `maxConcurrentAgents` | `0` | Concurrent `agent()` ceiling; `0` resolves from available CPU parallelism. |
| `maxTotalAgents` | `1000` | Total `agent()` calls one run may start — the runaway-loop backstop. |
| `maxItemsPerCall` | `4096` | Items accepted by one `parallel()` or `pipeline()` call. |
| `syncTimeoutMs` | `5000` | VM timeout for the script's initial synchronous slice, in milliseconds. |
| `disposeGraceMs` | `5000` | Bound before force-settlement and worker termination; also bounds `dispose()`. |

An owning consumer may set `WorkflowStartRequest.subagentProvider` and `WorkflowStartRequest.maxTotalAgents` for one run — engine-level policy, not script hooks; the ordinary `workflow` tool leaves both unset, and a per-run total-child cap may lower but never raise the configured ceiling. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-workflow-worker-thread) is the exhaustive source for every accepted field.

### What a run gives you

When a run starts, the script body executes in the worker with top-level `await` and the hooks `agent()`, `parallel()`, `pipeline()`, `phase()`, and `log()`; `meta` and `args` arrive as plain JSON data, never evaluated code. Every `agent()` call starts a host-side subagent under the configured provider, with the run's parent as the parent of every child. The run settles with the script's final JSON value; an ordinary child failure resolves `agent()` to `null` so the script can handle it.

A malformed meta block, a body that does not parse, an unavailable provider route, or a per-run cap above the ceiling is rejected synchronously before a worker exists, so the caller sees a violation list and can correct the call. During execution, hook misuse and tripped caps kill the script with a fatal workflow error. Cancellation is bounded: a script that ignores it is force-settled as cancelled and its worker terminated after `disposeGraceMs`.

### Trust expectations

Script CPU work and synchronous spins stay off the host event loop, `worker.terminate()` gives disposal a real final stop, and the worker starts with a scrubbed environment — only platform temp paths and, in source mode, `TSX_TSCONFIG_PATH` — so ambient credentials do not cross through `process.env`. Host/worker messages use structured-clone data with plain-JSON validation at the script boundary.

None of this is a security boundary: no timers, filesystem API, or Node globals are intentionally injected, but escaped code can still reach Node with the worker's process authority.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the engine's isolation design and run mechanics; observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

One worker thread per run keeps a misbehaving script from stalling the host and makes force termination possible: the script runs in an escapable `node:vm` context inside the worker, and `agent()` calls cross a typed host/worker protocol back to `ctx.subagents`. The vm context shapes the script's API surface; it is not a security sandbox.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, up-front validation, `start()` wiring |
| [`src/host.ts`](src/host.ts) | Host side of a run: worker spawn, child orchestration, settlement, disposal |
| [`src/worker.ts`](src/worker.ts) | Worker entry: script execution, hook implementation, value materialization |
| [`src/runtime.ts`](src/runtime.ts) | Script runtime: hook contracts, `parallel()` and `pipeline()` combinators |
| [`src/realm.ts`](src/realm.ts) | Cross-realm materialization: plain-JSON acceptance and rejection rules |
| [`src/protocol.ts`](src/protocol.ts) | Typed host/worker message protocol |
| [`src/meta.ts`](src/meta.ts) | `meta` shape validation and normalization |
| [`src/session.ts`](src/session.ts) | Child run projection and snapshotting before crossing to the worker |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; worker tests cover the boundary) |

### Run sequence

`start()` validates the meta block, parses the body, resolves the provider route, and resolves the per-run total-child cap before creating a worker or publishing `workflow/start`. A ready/go handshake prevents a start-signal cancellation racing worker boot from executing the script's initial synchronous slice; source mode installs TypeScript transforms through a data-URL bootstrap, while built mode passes the sibling `lib/worker.cjs` bundle.

For each `agent()` call the worker sends a `child-start`; the host starts the provider (the request's override, or the configured provider) through the subagent seam, attributes the child to the run's parent, and reports start or start-error back. Provider choice applies to every child in the run and is not visible to the script. Provider starts are tracked separately from published children, so a pending start is aborted by the shared signal when cancellation, worker death, or normal settlement closes admission.

### Value boundary

Values leaving the script pass through realm materialization, which accepts plain lossless JSON data and rejects exotic prototypes, functions, symbols, cycles, sparse arrays, non-finite numbers, and nested `undefined`. Child results are projected and snapshotted before crossing from host to worker — a real process-like serialization boundary, deliberately different from the borrowed immutable values of same-process workflow events.

### Cancellation and disposal

`cancel()` records the first reason, tells the worker to cancel, aborts the one signal shared by every pending and published child, and arms the `disposeGraceMs` timer; worker hooks then throw `CANCELLED` at their next await. If the run remains unsettled at the deadline, the host resolves it as cancelled, pairs stranded child lifecycle events, and terminates the worker.

`dispose()` is idempotent: it cancels the run, starts host-driven disposal immediately, waits for result and child quiescence up to the same grace, terminates the worker unconditionally, and performs a final survivor sweep. Per-child disposal is memoized so worker RPC, host cancellation, death cleanup, and public disposal all join one operation.

### Outcome and event guarantees

Terminal outcome is first-wins at host claim points: an accepted external cancellation overrides a later non-cancelled worker result, and a result or worker death that claims first cannot be rewritten by reentrant cleanup callbacks. Worker error, message failure, or premature exit closes message admission before cleanup, then resolves `error` unless cancellation already owns the run.

The host keeps a ledger of forwarded child starts; a graceful worker supplies their ends, while death or force termination synthesizes any missing end as cancelled — every forwarded `workflow/agent-start` is paired exactly once.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the engine-level contract is not enough. They move from the seam contract to the model-facing consumers and the design decisions.

- [Workflow subsystem](../../../docs/subsystems/workflow.md) — the seam contract this engine implements.
- [Workflow seam](../workflow/README.md) — the run and result vocabulary behind `ctx.workflowEngine`.
- [workflow tool](../tool-workflow/README.md) — the model-facing consumer that runs scripts on this engine.
- [Group map](../README.md) — the workflow capability family and its packages.
- [Dynamic workflows Agent Note](../../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md) — the seam design and its decisions.

-----

<a id="model-experience"></a>
## Model Experience

### Child-agent requests

#### What the model sees

Every script `agent()` call sends its prompt verbatim and optional model or structured-output schema to a subagent provider. Each child sees that provider's own context; phase and log narration stays on observer events.

#### Token effect

Potentially many independent child contexts are paid, bounded by `maxConcurrentAgents`, `maxTotalAgents`, and `maxItemsPerCall`; they never join the parent history directly.

#### KV Cache effect

Independent of the parent request cache and of sibling children. Each child can reuse only a byte-identical prefix under its own provider, model, prompt, and schema; its later history grows append-only.

### Parent tool result, indirectly

#### What the model sees

Through [`dsh-tool-workflow`](../tool-workflow/README.md), success exposes only the materialized final JSON value and child count in that consumer's wrapper. This engine supplies stable errors including `workflow script does not parse: <error>`, `invalid meta: <violations>`, `agent() requires a non-empty prompt string`, `agent() could not start a child: <error>`, and `child agent run failed: <error>`, plus its exact `parallel()`, `pipeline()`, `phase()`, option, schema, and JSON-boundary validation messages. Intermediate child outputs are available to the script but not the parent model.

#### Token effect

Zero direct parent tokens from this engine. Final result size is capped by the tool consumer and retained until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the engine is a poor fit or needs special operational care. They are current constraints, not a task backlog.

- **The worker and vm are not a security boundary** — model-written code can escape `node:vm` and reach the worker's process authority; a hostile-code deployment needs a separate-process or container engine.
- **One worker thread is paid per run** — there is no pool, warm runtime, or cross-run script cache.
- **No ambient timers or filesystem are injected, and the only network is `http()`'s bounded path, but escaped code can still reach Node** — the missing globals are a portability API, not containment.
- **Termination can only report host-observed starts** — `agentsStarted` excludes worker-side calls still queued behind concurrency when a forced termination makes them unknowable.
- **Cross-realm errors fail `instanceof Error` inside scripts** — workflow authors must branch on stable fields such as `name` and `code`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: measured artifacts and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

Open directions: a pooled or warm runtime and a cross-run script cache to avoid one worker per run; a genuine process or container engine for untrusted scripts behind the same seam. The built `./worker` entry ships as a CommonJS bundle because pkg's VFS hook expects CommonJS; source mode installs tsx transforms through a data-URL bootstrap.

</details>
