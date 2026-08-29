/**
 * Per-session scenario entry-flow run state (ready → running → settled).
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { FlowRunSnapshot } from '@deepseek-ai/dsh-flow/types'

/** Phase of a scenario session's entry orchestration. */
export type ScenarioPhase = 'idle' | 'ready' | 'starting' | 'running' | 'settled' | 'failed'

/** One session's scenario-run snapshot. */
export interface ScenarioRunState {
  readonly phase: ScenarioPhase
  readonly agentMode: string | null
  readonly runId: string | null
  readonly status: string | null
  readonly error: string | null
}

const IDLE: ScenarioRunState = {
  phase: 'idle', agentMode: null, runId: null, status: null, error: null,
}

/** Tracks entry-flow runs keyed by session. */
export class ScenarioRunController {
  private readonly bySession = new Map<string, SnapshotStore<ScenarioRunState>>()
  private readonly polls = new Map<string, ReturnType<typeof setInterval>>()

  constructor(private readonly remote: Pick<ClientRemote, 'agentModes'>) {}

  /**
   * Snapshot store for one session.
   * @param sessionId - session id.
   * @returns store.
   */
  storeFor(sessionId: SessionId): SnapshotStore<ScenarioRunState> {
    let store = this.bySession.get(sessionId)
    if (store === undefined) {
      store = createSnapshotStore(IDLE)
      this.bySession.set(sessionId, store)
    }
    return store
  }

  /**
   * Mark a session ready when it carries an agent mode and has not started.
   * @param sessionId - session id.
   * @param agentMode - mode id or null/undefined.
   */
  syncMode(sessionId: SessionId, agentMode: string | null | undefined): void {
    const store = this.storeFor(sessionId)
    const snap = store.getSnapshot()
    if (agentMode === undefined || agentMode === null || agentMode === '') {
      this.stopPoll(sessionId)
      store.set(IDLE)
      return
    }
    if (snap.phase === 'running' || snap.phase === 'starting' || snap.phase === 'settled') {
      if (snap.agentMode === agentMode) return
    }
    if (snap.phase === 'failed' && snap.agentMode === agentMode) return
    store.set({
      phase: 'ready',
      agentMode,
      runId: null,
      status: null,
      error: null,
    })
  }

  /**
   * Start the bound entry flow with optional user input.
   * @param sessionId - session id.
   * @param input - flow args (opening text).
   * @returns once the run started or failed to start.
   */
  async start(sessionId: SessionId, input?: string): Promise<void> {
    const store = this.storeFor(sessionId)
    const snap = store.getSnapshot()
    if (snap.phase !== 'ready' && snap.phase !== 'failed') return
    store.set({
      ...snap,
      phase: 'starting',
      error: null,
    })
    const trimmed = input?.trim()
    const result = await this.remote.agentModes.startEntry(
      sessionId,
      trimmed === undefined || trimmed === '' ? undefined : trimmed,
    )
    if (!result.ok) {
      store.set({
        phase: 'failed',
        agentMode: snap.agentMode,
        runId: null,
        status: null,
        error: result.error.message,
      })
      return
    }
    store.set({
      phase: 'running',
      agentMode: result.value.agentMode,
      runId: result.value.runId,
      status: 'running',
      error: null,
    })
    this.beginPoll(sessionId, result.value.runId)
  }

  private beginPoll(sessionId: SessionId, runId: string): void {
    this.stopPoll(sessionId)
    const tick = async (): Promise<void> => {
      const result = await this.remote.agentModes.getTryRun(runId)
      if (!result.ok) {
        this.finish(sessionId, 'failed', null, result.error.message)
        return
      }
      const run = result.value.run
      if (run === null) {
        this.finish(sessionId, 'failed', null, 'run not found')
        return
      }
      this.applyRun(sessionId, run)
    }
    void tick()
    this.polls.set(sessionId, setInterval(() => { void tick() }, 800))
  }

  private applyRun(sessionId: SessionId, run: FlowRunSnapshot): void {
    const store = this.storeFor(sessionId)
    const snap = store.getSnapshot()
    if (run.status === 'running') {
      store.set({
        ...snap,
        phase: 'running',
        status: run.status,
        error: null,
      })
      return
    }
    if (run.status === 'completed') {
      this.finish(sessionId, 'settled', run.status, null)
      return
    }
    this.finish(sessionId, 'failed', run.status, run.error ?? run.status)
  }

  private finish(
    sessionId: SessionId,
    phase: 'settled' | 'failed',
    status: string | null,
    error: string | null,
  ): void {
    this.stopPoll(sessionId)
    const store = this.storeFor(sessionId)
    const snap = store.getSnapshot()
    store.set({
      ...snap,
      phase,
      status,
      error,
    })
  }

  private stopPoll(sessionId: string): void {
    const handle = this.polls.get(sessionId)
    if (handle !== undefined) {
      clearInterval(handle)
      this.polls.delete(sessionId)
    }
  }
}
