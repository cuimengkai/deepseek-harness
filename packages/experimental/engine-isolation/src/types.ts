/**
 * Engine-isolation driver seam types: the reserved adapter-layer interfaces
 * `DriveAgentRun` / `ListSessions` / `ReadLog` (architecture D3) and the
 * request/handle values they exchange. A driver runs a workspace's agent
 * either in the current process (shared workspaces) or delegates the run to a
 * dedicated child engine whose data lives in a per-workspace store and log
 * root (isolated workspaces).
 * @module @deepseek-ai/dsh-experimental-engine-isolation/types
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell'

/** The engine a driver runs one workspace's agent in. */
export type EngineKind = 'in-process' | 'process-out'

/** One agent run a driver executes in a workspace's engine. */
export interface AgentDrive {
  /** The user directive the engine's agent turn starts from. */
  readonly prompt: string
  /** The model route the engine's agent uses. */
  readonly provider: string
  /** The model id on that route. */
  readonly model: string
  /** The working directory for the engine's agent session. */
  readonly cwd: string
}

/** Request one engine run for a workspace. */
export interface AgentRunRequest {
  /** The session the run's agent acts in. */
  readonly sessionId: SessionId
  /** The workspace the run serves (the isolation unit, architecture D2). */
  readonly workspaceId: WorkspaceId
  /** The agent run to execute. */
  readonly drive: AgentDrive
}

/** The durable outcome of one driven engine run. */
export interface RunHandle {
  readonly sessionId: SessionId
  readonly workspaceId: WorkspaceId
  /** The engine process that ran the drive (the current process when in-process). */
  readonly pid: number
  readonly status: 'completed' | 'failed'
  /** The workspace store the run committed to (shared or per-workspace). */
  readonly storePath: string
  /** The session-log root the run appended to. */
  readonly logRoot: string
}

/** The D3 engine-driver seam: DriveAgentRun / ListSessions / ReadLog. */
export interface EngineDriver {
  /** Which engine this driver runs. */
  readonly kind: EngineKind
  /** Drive one agent run in the workspace's engine. */
  drive(request: AgentRunRequest): Promise<RunHandle>
  /** List the sessions the engine holds durably for one workspace. */
  listSessions(workspaceId: WorkspaceId): Promise<readonly SessionId[]>
  /** Read one engine session's durable event log back. */
  readLog(sessionId: SessionId): Promise<readonly SessionEvent[]>
}
