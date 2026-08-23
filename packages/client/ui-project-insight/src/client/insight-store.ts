/**
 * Per-session project-insight read controller. Each conversation view tab owns
 * one instance bound to its session; the store's snapshot drives the tab's
 * frame and body. A fresh committed document renders immediately; `none` and
 * `stale` mean the host may still be scanning, so the controller re-reads on a
 * short interval until the wire reports `fresh`. Latest-write-wins via a
 * generation counter: a newer `load` (or `dispose`) supersedes every older
 * in-flight read and scheduled poll, so a session switch never flashes a
 * previous session's document.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectInsightDoc } from '@deepseek-ai/dsh-project-insight/src/schema.ts'

/** How long a `none`/`stale` read waits before asking the host again. */
export const POLL_INTERVAL_MS = 2_000

/**
 * Human text for a rejected wire call (a transport rejection may be anything).
 * @param error - the rejected value.
 * @returns a stable human-readable message.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One read session's insight snapshot. */
export interface ProjectInsightState {
  /** `ready` = a fresh document is committed; `none`/`stale` poll for completion. */
  status: 'idle' | 'loading' | 'none' | 'stale' | 'ready' | 'error'
  /** The failure message when `status` is `error`. */
  error: string | null
  /** The committed document, present exactly when a fresh read landed. */
  doc: ProjectInsightDoc | null
}

const INITIAL: ProjectInsightState = { status: 'idle', error: null, doc: null }

/** Drives one session's `projectInsight.read` into a snapshot store. */
export class ProjectInsightController {
  /** The snapshot the tab renders from. */
  readonly store: SnapshotStore<ProjectInsightState> = createSnapshotStore(INITIAL)
  /** Bumped on every `load` and `dispose`; older in-flight reads no-op. */
  private generation = 0
  private pollTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param api - the wire face carrying `projectInsight.read`.
   * @param cwd - the session's current project root, resolved lazily (the
   * session row may not exist yet when the view first mounts).
   */
  constructor(
    private readonly api: Pick<IApiClient, 'projectInsight'>,
    private readonly cwd: () => string | undefined,
  ) {}

  private set(patch: Partial<ProjectInsightState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the session's document. A session with no project root (no `cwd`)
   * renders nothing — there is no project to scan. Re-entrant safe: an
   * already-loading controller does not start a second read.
   */
  load(): void {
    const cwd = this.cwd()
    if (cwd === undefined) return
    if (this.store.getSnapshot().status === 'loading') return
    this.set({ status: 'loading', error: null })
    this.generation += 1
    void this.read(cwd, this.generation)
  }

  /**
   * Stop all pending and in-flight reads and reset the snapshot. Called on view
   * unmount; a later `load` starts a fresh read cleanly (the generation bump
   * above discards any in-flight result, and resetting to initial avoids the
   * `loading` re-entrant guard blocking the remount's read).
   */
  dispose(): void {
    this.generation += 1
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
    this.store.set(INITIAL)
  }

  private async read(cwd: string, generation: number): Promise<void> {
    let response
    try {
      response = await this.api.projectInsight.read({ cwd })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ status: 'error', error: messageOf(error) })
      return
    }
    if (generation !== this.generation) return
    const result = response.result
    if (!result.ok) {
      this.set({ status: 'error', error: result.error.message })
      return
    }
    const { status, doc } = result.value
    if (status === 'fresh' && doc !== undefined) {
      this.set({ status: 'ready', error: null, doc })
      return
    }
    this.set({ status: status === 'none' ? 'none' : 'stale', error: null, doc: doc ?? null })
    this.schedulePoll(cwd, generation)
  }

  private schedulePoll(cwd: string, generation: number): void {
    if (this.pollTimer !== undefined) return
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined
      if (generation !== this.generation) return
      void this.read(cwd, generation)
    }, POLL_INTERVAL_MS)
  }
}
