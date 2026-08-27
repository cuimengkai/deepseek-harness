# Engine Isolation

English | [中文](engine-isolation.zh.md)

The engine-driver seam that runs a workspace's agent in a dedicated child engine process when the workspace's isolation record demands it, and in the current process otherwise. The seam realizes the adapter-layer `DriveAgentRun` / `ListSessions` / `ReadLog` reserved by [product architecture](../platform-architecture.md) decision D3; the [isolation mechanism spec](../platform-engine-isolation.md) owns the process-out protocol. The durable seam contract lives in [`packages/experimental/engine-isolation/src/types.ts`](../../packages/experimental/engine-isolation/src/types.ts); the control-plane isolation record lives in [platform-shell](platform-shell.md).

## Isolation record

A workspace is the isolation unit (architecture D2); physical isolation is optional per workspace. The platform control plane holds that decision as the workspace's isolation record (`workspaces.isolated`), flipped by `platformShell.setWorkspaceIsolation` under the `platform.isolation` permission and probed by `platformShell.workspaceIsolation`. An isolation flip is audited on the control plane, and the engine that ran the isolated drive emits the durable `platform/workspace/isolated` session event as the per-session projection of that flip.

## The driver seam

`EngineDriver` is the reserved adapter-layer interface: `drive` runs one agent run in the workspace's engine, `listSessions` enumerates the sessions that engine holds, and `readLog` reads a session's durable event log back. A `RunHandle` reports which engine process ran the drive and where its data committed.

```ts
import type { AgentRunRequest, RunHandle } from '@deepseek-ai/dsh-experimental-engine-isolation'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell'

interface EngineDriver {
  readonly kind: 'in-process' | 'process-out'
  drive(request: AgentRunRequest): Promise<RunHandle>
  listSessions(workspaceId: WorkspaceId): Promise<readonly SessionId[]>
  readLog(sessionId: SessionId): Promise<readonly SessionEvent[]>
}
```

## Engine kinds

- **in-process** — the current process runs the drive through a caller-supplied runner. Shared workspaces use this engine; the handle's pid is the current process.
- **process-out** — a dedicated child engine process runs the drive. Isolated workspaces use this engine; the child's store and JSONL logs live in per-workspace roots under the configured scratch root, so the isolation is physical at the process and data level.

## Routing

`ctx.engineIsolation.driver(workspaceId)` consults `ctx.platformShell.workspaceIsolation(workspaceId)`: an isolated workspace routes to the process-out engine, a shared one to the in-process engine. An unknown workspace fails loud — routing is never silent.

## Process-out protocol

The process-out driver spawns the child engine through `ctx.subprocess` with the drive JSON on stdin and the store/log roots on the command line. The child boots the platform-shell assembly at its per-workspace store path, seeds the isolated world, runs the drive, persists the session log, and prints one JSON result line (`ok`, `sessionId`, `pid`, `storePath`, `logRoot`) on stdout before exiting. Session persistence is file-backed and process-agnostic, so the parent's `readLog` and `listSessions` read the child's durable JSONL logs — the `DriveAgentRun` / `ListSessions` / `ReadLog` seam realized with existing primitives.

## Known limitations

Process-out is process-level delegation, not a security boundary: the child shares the host machine, kernel, and filesystem access policy. Container or VM isolation is a backend swap on the same seam (the e2b family is the remote-VM backend) and is deferred.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxengineisolation--engineisolationservice"></a>

### `ctx.engineIsolation` — `EngineIsolationService`

The engine-isolation service. Register via `ctx.plugin(EngineIsolationService, config)`; the service is injected as `ctx.engineIsolation`. Requires the platformShell control-plane service, whose isolation record routes each workspace to its engine.

```ts cordis-catalog
/**
 * Resolve the engine driver one workspace's runs use.
 * @param workspaceId - the workspace to route.
 * @returns the process-out driver for an isolated workspace, the in-process
 * driver for a shared one.
 * @throws the platform store's UNKNOWN_WORKSPACE when the workspace does not exist.
 */
driver(workspaceId: WorkspaceId): EngineDriver

/**
 * Drive one agent run in the workspace's engine (routed by isolation).
 * @param request - the run to execute.
 * @returns the durable outcome handle.
 */
async drive(request: AgentRunRequest): Promise<RunHandle>

/**
 * List the sessions one workspace's engine holds durably.
 * @param workspaceId - the workspace whose engine to ask.
 * @returns the engine's durable session ids for that workspace.
 */
async listSessions(workspaceId: WorkspaceId): Promise<readonly SessionId[]>

/**
 * Read one session's durable log from the workspace engine that owns it.
 * A session id alone does not name its workspace, so the process-out engine
 * is asked first (isolated sessions live in its per-workspace roots) and the
 * in-process engine only when the process-out roots hold no such session.
 * @param sessionId - the session to read.
 * @returns the committed events, or an empty list when the session is absent
 * from both engines.
 */
async readLog(sessionId: SessionId): Promise<readonly SessionEvent[]>
```

Types: [SessionEvent](session.md) · [SessionId](core.md) · [WorkspaceId](workspace.md)

Source: [`packages/experimental/engine-isolation/src/service.ts`](../../packages/experimental/engine-isolation/src/service.ts)
<!-- END GENERATED cordis-surface -->
