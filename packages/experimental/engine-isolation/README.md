# @deepseek-ai/dsh-experimental-engine-isolation

English | [中文](README.zh.md)

The D3 engine-driver seam: it runs a workspace's agent runs in a dedicated child engine process when the workspace's isolation record demands it, and in the current process otherwise. The service injects as `ctx.engineIsolation` and routes on the isolation record the [platform-shell control plane](../../../packages/experimental/platform-shell/README.md) holds. The [engine-isolation subsystem catalog](../../../docs/subsystems/engine-isolation.md), the [isolation mechanism spec](../../../docs/platform-engine-isolation.md), and the [keyless demo](../../../examples/engine-isolation-demo/README.md) document the seam, protocol, and proof.

## Config

The service is mounted programmatically (never from `cordis.yml`): the in-process runner closure and the process-out child facts are host-supplied.

```ts
import { EngineIsolationService, type AgentRunRequest } from '@deepseek-ai/dsh-experimental-engine-isolation'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare const runInProcess: (request: AgentRunRequest) => Promise<void>
declare const readInProcessLog: (sessionId: SessionId) => Promise<readonly SessionEvent[]>
declare const listInProcessSessions: () => Promise<readonly SessionId[]>

ctx.plugin(EngineIsolationService, {
  inProcess: {
    run: (request) => runInProcess(request),
    storePath: './.platform-shell.sqlite',
    logRoot: './logs',
    readLog: readInProcessLog,
    listSessions: listInProcessSessions,
  },
  processOut: {
    workerScript: './src/worker.ts',
    storeRoot: './.storages/isolated',
    logRoot: './logs/isolated',
    cwd: process.cwd(),
    graceMs: 5000,
    nodeArgs: ['--import', 'tsx/esm'],
  },
})
```

`inProcess` carries the shared-workspace runner and its store/log facts; `processOut` carries the child worker script, the per-workspace scratch roots, and the spawn facts. `nodeArgs` precedes the worker script, so a TypeScript source worker passes `['--import', 'tsx/esm']`.

## The driver seam

`EngineDriver` is the reserved adapter-layer interface (`drive`, `listSessions`, `readLog`). `drive` runs one agent run in the workspace's engine and returns a `RunHandle` naming which process ran it and where its data committed; `listSessions` and `readLog` read the durable session world back, so a caller never needs to know which engine ran a run to locate it.

## Engine kinds

- **in-process** — the current process runs the drive through the caller-supplied runner. Shared workspaces use this engine; the handle's pid is the current process.
- **process-out** — a dedicated child engine process runs the drive. Isolated workspaces use this engine; the child's store and JSONL logs live in per-workspace roots under the configured scratch root.

## Routing

`ctx.engineIsolation.driver(workspaceId)` consults `ctx.platformShell.workspaceIsolation(workspaceId)`: an isolated workspace routes to the process-out engine, a shared one to the in-process engine. An unknown workspace fails loud — routing is never silent.

## Process-out protocol

The process-out driver spawns the child through `ctx.subprocess` with the drive JSON on stdin and the store/log roots on the command line. The child boots the platform-shell assembly at its per-workspace store path, seeds the isolated world, runs the drive, persists the session log, and prints one JSON result line on stdout before exiting. The parent reads the result line; a non-zero exit or a missing line fails the drive loudly with `ENGINE_SPAWN_FAILED`. Session persistence is file-backed and process-agnostic, so the parent's `readLog` and `listSessions` read the child's durable JSONL logs.

## Session events

The engine that ran an isolated drive emits the durable `platform/workspace/isolated` session event as the per-session projection of the control-plane isolation flip. The event is log-only and carries no model tokens.

## Model Experience

Indirectly, through the driven agent: the in-process runner and the process-out child engine own every model-facing registration the drive makes visible.

#### KV Cache effect

The engine seam appends no prompt and no request tokens; the driven agent's plugins own all model-visible additions, and the session log the drive appends keeps an already-reusable prefix reusable across the turn.

## Known Limitations and Deferred Work

- **Process-out is process-level delegation, not a security boundary** — the child engine shares the host machine, kernel, and filesystem access policy; container or VM isolation is a backend swap on the same seam (the e2b family is the remote-VM backend) and is deferred.
- **Isolation is per-workspace, not per-request** — the flag lives on the workspace record and flips via the service; there is no model-facing tool to flip it mid-session.
- **The in-process runner is a host obligation** — the seam owns the driver and the routing, not the assembly; the runner closure and the child worker are supplied by the mounting host.
- **Process-out needs the scratch roots and worker configured** — a misconfigured `workerScript` or scratch root fails the drive loudly (`ENGINE_SPAWN_FAILED`), never silently.
