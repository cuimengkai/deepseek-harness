/**
 * Per-session context-composition read controller. Each context view tab owns
 * one instance bound to its session; the store's snapshot drives the tab's
 * frame, capacity bar, and tree. Latest-write-wins via a generation counter:
 * a newer `load` (or `dispose`) supersedes every older in-flight read, so a
 * session switch never flashes a previous session's composition.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The pure-types wire vocabulary the store republishes. */
export type ContextComposition = import('@deepseek-ai/dsh-context-composition/types').ContextComposition

/**
 * Human text for a rejected wire call (a transport rejection may be anything).
 * @param error - the rejected value.
 * @returns a stable human-readable message.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One read session's context-composition snapshot. */
export interface ContextCompositionState {
  /** `ready` = one composition landed; `empty` = the session has no requests yet. */
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  /** The failure message when `status` is `error`. */
  error: string | null
  /** The composition, present exactly when a read landed. */
  composition: ContextComposition | null
}

const INITIAL: ContextCompositionState = { status: 'idle', error: null, composition: null }

/** Drives one session's `contextComposition.read` into a snapshot store. */
export class ContextCompositionController {
  /** The snapshot the tab renders from. */
  readonly store: SnapshotStore<ContextCompositionState> = createSnapshotStore(INITIAL)
  /** Bumped on every `load` and `dispose`; older in-flight reads no-op. */
  private generation = 0

  /**
   * @param api - the wire face carrying `contextComposition.read`.
   * @param sessionId - the live session whose context this tab renders.
   */
  constructor(
    private readonly api: Pick<ClientRemote, 'contextComposition'>,
    private readonly sessionId: SessionId,
  ) {}

  private set(patch: Partial<ContextCompositionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the session's composition. Re-entrant safe: an already-loading
   * controller does not start a second read.
   */
  load(): void {
    if (this.store.getSnapshot().status === 'loading') return
    this.set({ status: 'loading', error: null })
    this.generation += 1
    void this.read(this.generation)
  }

  /**
   * Stop all in-flight reads and reset the snapshot. Called on view unmount;
   * a later `load` starts a fresh read cleanly (the generation bump above
   * discards any in-flight result, and resetting to initial avoids the
   * `loading` re-entrant guard blocking the remount's read).
   */
  dispose(): void {
    this.generation += 1
    this.store.set(INITIAL)
  }

  private async read(generation: number): Promise<void> {
    let response
    try {
      response = await this.api.contextComposition.read({ sessionId: this.sessionId })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ status: 'error', error: messageOf(error) })
      return
    }
    if (generation !== this.generation) return
    if (!response.ok) {
      this.set({ status: 'error', error: `${response.error.message} (${response.error.code})` })
      return
    }
    const composition = response.value
    const status = composition.envelope === null && composition.surface.length === 0
      ? 'empty'
      : 'ready'
    this.set({ status, error: null, composition })
  }
}
