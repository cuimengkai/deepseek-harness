# Platform Engine Isolation

English | [中文](platform-engine-isolation.zh.md)

> Companion to [platform-architecture.md](platform-architecture.md) (D2, D3): on-demand physical isolation and the engine process-out seam. Decision D2 makes the workspace the isolation unit with physical isolation optional; D3 reserves the adapter-layer driver interfaces `DriveAgentRun` / `ListSessions` / `ReadLog` for a process-out implementation. This spec defines the driver seam, the isolation record that routes each workspace to its engine, and the process-out protocol, grounded in `examples/engine-isolation-demo/`.

## 1. The driver seam

`EngineDriver` is the reserved adapter-layer interface. One `drive` call runs one agent run in the workspace's engine; `listSessions` enumerates the sessions that engine holds durably; `readLog` reads a session's durable event log back.

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

A `RunHandle` reports which engine process ran the drive (`pid`) and where its data committed (`storePath`, `logRoot`), so the caller can locate the run's durable world without knowing which engine ran it.

## 2. The isolation record

A workspace is the isolation unit (D2); physical isolation is optional per workspace. The platform control plane holds that decision as the workspace's isolation record (`workspaces.isolated`):

- `createWorkspace(name, {isolated})` accepts the flag at creation.
- `setWorkspaceIsolation(actor, workspaceId, isolated)` flips it under the `platform.isolation` permission; the flip is audited on the control plane.
- `workspaceIsolation(workspaceId)` probes the record for the engine seam and the invariant.

The engine that ran an isolated drive emits the durable `platform/workspace/isolated` session event as the per-session projection of the flip; the control-plane audit log is the authoritative record. Model-visible input stays reconstructable from the session log (`Model-visible ⟺ logged`).

## 3. Engine kinds

- **in-process** — the current process runs the drive through a caller-supplied runner. Shared workspaces use this engine; the handle's pid is the current process and the data commits to the caller's own store and log root.
- **process-out** — a dedicated child engine process runs the drive. Isolated workspaces use this engine; the child's store and JSONL logs live in per-workspace roots under the configured scratch root, so the isolation is physical at the process and data level.

## 4. Routing

`resolveEngineDriver` consults the isolation record: an isolated workspace routes to the process-out engine, a shared one to the in-process engine. An unknown workspace fails loud (`PlatformShellError` with `UNKNOWN_WORKSPACE`) — routing is never silent, so a workspace can never drift between engines unnoticed.

## 5. The process-out protocol

The process-out driver spawns the child engine through `ctx.subprocess` (env-scrubbed, tree-managed) with the drive JSON on stdin and the store/log roots on the command line:

```
node <workerScript> --store <storePath> --logroot <logRoot> --session <sessionId> --workspace <workspaceId>
```

The child boots the platform-shell assembly at its per-workspace store path, seeds the isolated world, runs the drive, persists the session log, and prints one JSON result line on stdout before exiting:

| Field | Meaning |
|---|---|
| `ok` | whether the drive completed |
| `sessionId` | the session the child drove |
| `pid` | the child engine's process id |
| `storePath` | the per-workspace store the child committed to |
| `logRoot` | the per-workspace JSONL root the child appended to |

Session persistence is file-backed and process-agnostic, so the parent's `readLog` and `listSessions` read the child's durable JSONL logs directly — the `DriveAgentRun` / `ListSessions` / `ReadLog` seam realized with existing primitives. A non-zero child exit or a missing result line fails the drive loudly.

## 6. Verification

`examples/engine-isolation-demo/` proves the mechanism keyless: the demo creates a shared and an isolated workspace, runs an in-process drive (shared) and a process-out drive (isolated), and asserts routing by the isolation record, a child pid distinct from the parent, the isolated store holding only the isolated workspace's rows while the shared store lacks them, and the child's session log reconstructable through `readLog` — with the scratch roots cleaned up at the end.
