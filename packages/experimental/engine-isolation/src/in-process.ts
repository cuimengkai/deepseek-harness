/**
 * In-process engine driver: executes one agent run through a caller-supplied
 * runner on the current process — the shared-workspace default. The run's data
 * commits to the caller's own store and session-log root, so the handle
 * reports the current process id.
 * @module @deepseek-ai/dsh-experimental-engine-isolation/in-process
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell'
import type { AgentRunRequest, EngineDriver, RunHandle } from './types.ts'

/** Execute one agent run against the caller's in-process engine. */
export type EngineRunner = (request: AgentRunRequest) => Promise<void>

/** Configuration for the in-process engine driver. */
export interface InProcessConfig {
  /** The in-process engine runner that executes one drive. */
  readonly run: EngineRunner
  /** Where the in-process engine commits its workspace store. */
  readonly storePath: string
  /** The session-log root the in-process engine appends to. */
  readonly logRoot: string
  /** Read the durable event log of one session from the in-process log root. */
  readonly readLog: (sessionId: SessionId) => Promise<readonly SessionEvent[]>
  /** List the sessions durable in the in-process log root. */
  readonly listSessions: () => Promise<readonly SessionId[]>
}

/**
 * The in-process {@link EngineDriver}: runs every drive through the caller's
 * engine runner and reports the current process as the run's engine.
 */
export class InProcessEngineDriver implements EngineDriver {
  readonly kind = 'in-process' as const

  /** @param config - the runner and the in-process store/log facts. */
  constructor(private readonly config: InProcessConfig) {}

  /**
   * Drive one agent run through the in-process runner.
   * @param request - the run to execute.
   * @returns a handle whose engine is the current process; a run the runner
   * started but failed is reported in-band as `status: 'failed'`.
   */
  async drive(request: AgentRunRequest): Promise<RunHandle> {
    let status: RunHandle['status'] = 'completed'
    try {
      await this.config.run(request)
    } catch {
      // The runner reports a drive failure in-band so the seam never throws
      // for a run the engine started.
      status = 'failed'
    }
    return {
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      pid: process.pid,
      status,
      storePath: this.config.storePath,
      logRoot: this.config.logRoot,
    }
  }

  /**
   * List the sessions the in-process engine holds.
   * @param _workspaceId - the workspace (the in-process engine is not
   * per-workspace partitioned, so the id is ignored).
   * @returns the configured in-process session list.
   */
  async listSessions(_workspaceId: WorkspaceId): Promise<readonly SessionId[]> {
    return this.config.listSessions()
  }

  /**
   * Read one session's durable log from the in-process log root.
   * @param sessionId - the session to read.
   * @returns the configured in-process event log for that session.
   */
  async readLog(sessionId: SessionId): Promise<readonly SessionEvent[]> {
    return this.config.readLog(sessionId)
  }
}
