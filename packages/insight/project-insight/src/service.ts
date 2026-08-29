/**
 * The project-insight service: deterministic workspace scanning owned by the
 * host plane, with a session-lifecycle auto-scan hook and read/scan RPC
 * surfaces.
 *
 * The service is inert outside develop-mode sessions: the auto-scan triggers
 * only when a session's resolved agent preset is in `config.autoScanPresets`
 * (default `['develop']`) AND the session carries a working directory. A scan
 * commits `<root>/.dsh/insight/` — a meta file plus six typed section files —
 * atomically and, only after that commit, emits `project-insight/updated` for
 * the sessions waiting on that root — the commit-point rule keeps the event a
 * proof the document is readable. A fresh document (same stat signature) is
 * never rewritten and produces no event, so re-opening an already-scanned
 * project is a no-op.
 * @module @deepseek-ai/dsh-project-insight/service
 */

import { basename } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { MAX_FINGERPRINT_FILES } from './schema.ts'
import { PROJECT_INSIGHT_META_REL, ProjectInsightVersionError, readDocument, writeDocument } from './fingerprint.ts'
import { findProjectRoot } from './paths.ts'
import { scanProject, type ScanSummary } from './scanner.ts'
import { errorMessage } from './error.ts'
import type { ProjectInsightDoc } from './schema.ts'
import type { ProjectInsightReadResult } from './types.ts'

export type { ProjectInsightReadResult, ProjectInsightReadStatus } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectInsight: ProjectInsight
  }
}

/** Runtime schema for the project-insight service. */
export interface ProjectInsightConfig {
  /** Agent presets whose sessions auto-scan their workspace. */
  readonly autoScanPresets: string[]
  /** Milliseconds a session's scan waits after its last trigger before running. */
  readonly scanDebounceMs: number
}

/** The outcome of one scan attempt. */
export type ProjectInsightScanStatus = 'scanned' | 'unchanged' | 'error'

/** The result of {@link ProjectInsight.scan}. */
export interface ProjectInsightScanResult {
  readonly status: ProjectInsightScanStatus
  /** Project root basename — identity only, never a host path. */
  readonly root: string
  /** Document path relative to the project root, as the model sees it. */
  readonly path: string
  /** The compact summary when a scan ran; absent for `unchanged`/`error`. */
  readonly summary?: ScanSummary
  /** Human-readable failure text when `status` is `'error'`. */
  readonly error?: string
}

/**
 * Per-session workspace scanner. Auto-scan is debounced per root and
 * single-flight per root; a session arriving while its root is being scanned
 * joins the waiting set and is notified at the commit point. A read that
 * observes an absent or stale document schedules the same debounced scan, so a
 * session restored from the log after a host restart converges on a fresh
 * document even though it fires no session events.
 */
export class ProjectInsight extends TypertRemoteService {
  /** Runtime schema for the auto-scan trigger and debounce. */
  static Config = z.object({
    autoScanPresets: z.array(z.string()).default(['develop']),
    scanDebounceMs: z.number().default(1500),
  }) as z<ProjectInsightConfig>

  /** The presets whose sessions trigger a workspace scan. */
  private readonly autoScanPresets: ReadonlySet<string>

  /** Milliseconds a session's scan waits after its last trigger before running. */
  private readonly scanDebounceMs: number

  /** Pending debounce timers by project root. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /** In-flight scans by project root; single-flight idempotency. */
  private readonly inflight = new Map<string, Promise<void>>()

  /** Sessions waiting on each root's scan, notified at the commit point. */
  private readonly waiting = new Map<string, Set<SessionId>>()

  constructor(ctx: Context, config: ProjectInsightConfig) {
    super(ctx, 'projectInsight')
    this.autoScanPresets = new Set(config.autoScanPresets)
    this.scanDebounceMs = config.scanDebounceMs

    // A fresh develop session auto-scans once; a preset switch while the session
    // is blank re-triggers, so changing into develop mode scans the workspace
    // even when the session started under another preset.
    ctx.on('session/created', (session) =>{  this.maybeSchedule(session) })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'agent-preset/selected') return
      this.maybeSchedule(session)
    })

    // Debounce timers must not outlive the service; an in-flight scan is
    // fire-and-forget and its completion clears the inflight map itself.
    ctx.effect(() => () => {
      for (const timer of this.timers.values()) clearTimeout(timer)
      this.timers.clear()
    }, 'projectInsight.autoscan()')
  }

  /**
   * Read the stored document for a working directory, without scanning inline.
   *
   * Resolves the project root upward from `cwd`, reads the committed `.dsh/insight/`
   * document, and reports fresh/stale by recomputing the stat-only structural
   * signature. An over-cap, unparsable, or missing-section document is a `'error'`
   * result, not an absent one. A document under an older `formatVersion` is one
   * recoverable case: it reads `'stale'` and schedules a debounced background
   * rebuild, so a format bump self-heals an existing project's committed doc
   * instead of stranding it in an error state. An absent or stale document also
   * schedules the debounced rebuild: a session restored from the log after a
   * host restart fires neither `session/created` nor a fresh
   * `agent-preset/selected`, so the read itself is the trigger that keeps the
   * polling reader converging on a fresh document.
   * @param cwd - absolute working directory to resolve the project root from.
   * @param signal - aborts the stat walk.
   * @returns the document state and, when present, the parsed document.
   */
  async read(cwd: string, signal?: AbortSignal): Promise<ProjectInsightReadResult> {
    const root = await findProjectRoot(cwd)
    try {
      const existing = await readDocument(root, MAX_FINGERPRINT_FILES, signal)
      if (existing === undefined || existing.status === 'stale') this.scheduleScan(root)
      if (existing === undefined) return { status: 'none', root: basename(root) }
      return { status: existing.status, root: basename(root), doc: existing.doc }
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof ProjectInsightVersionError) {
        this.scheduleScan(root)
        return { status: 'stale', root: basename(root) }
      }
      return { status: 'error', root: basename(root), error: errorMessage(error) }
    }
  }

  /**
   * Remote adapter for the browser insight tabs' document read.
   *
   * The result carries only the project root's basename — identity, never a
   * Host path — and the stored document exactly as the read produced it, so
   * the conversation-reconnaissance posture of the old privileged RPC holds.
   * @param cwd - absolute working directory to resolve the project root from.
   * @param signal - caller cancellation supplied by the Remote carrier.
   * @returns the document state and, when present, the parsed document.
   */
  @Remote('read')
  readRemote(cwd: string, signal: AbortSignal): Promise<ProjectInsightReadResult> {
    return this.read(cwd, signal)
  }

  /**
   * Scan a working directory's project now and commit the document.
   *
   * A fresh stored document is left untouched (`'unchanged'`); otherwise the
   * deterministic scanner rebuilds it, the document is written atomically, and
   * — only after the write commits — `project-insight/updated` is emitted for
   * the caller's session. A stored document that cannot be read (wrong version,
   * over-cap, missing section, unparsable) is treated as absent, so a scan is
   * the operation that repairs it.
   * @param cwd - absolute working directory to resolve the project root from.
   * @param sessionId - session to notify at the commit point; absent skips the event.
   * @param signal - aborts the scan.
   * @returns the scan outcome.
   */
  async scan(cwd: string, sessionId?: SessionId, signal?: AbortSignal): Promise<ProjectInsightScanResult> {
    const root = await findProjectRoot(cwd)
    try {
      const existing = await this.storedDocument(root, signal)
      if (existing?.status === 'fresh') {
        return { status: 'unchanged', root: basename(root), path: PROJECT_INSIGHT_META_REL }
      }
      const { doc, summary } = await scanProject(root, signal)
      await writeDocument(root, doc)
      if (sessionId !== undefined) this.ctx.emit('project-insight/updated', sessionId)
      return { status: 'scanned', root: basename(root), path: PROJECT_INSIGHT_META_REL, summary }
    } catch (error) {
      signal?.throwIfAborted()
      return { status: 'error', root: basename(root), path: PROJECT_INSIGHT_META_REL, error: errorMessage(error) }
    }
  }

  /**
   * Trigger the auto-scan path for one session, when its preset and cwd qualify.
   *
   * Reads the session's resolved preset (newest selection wins) and working
   * directory, then debounces a background scan of the resolved project root.
   * Inert for non-develop presets and sessions without a cwd.
   * @param session - the session whose workspace may need scanning.
   */
  private maybeSchedule(session: Session): void {
    const cwd = session.header.cwd
    if (cwd === undefined) return
    const preset = resolveSessionPreset({ header: session.header, events: session.events })
    if (preset === undefined || !this.autoScanPresets.has(preset)) return
    void findProjectRoot(cwd).then(
      (root) =>{  this.scheduleScan(root, session.id) },
      // A cwd that cannot be resolved is not worth a scan; the tool path can
      // retry explicitly.
      () => {},
    )
  }

  /**
   * Debounce one root's scan, joining the session to its waiting set.
   * A root with an in-flight scan or a pending timer covers the session.
   * A `sessionId` is optional because a wrong-version read schedules its own
   * rebuild without a session to notify; the commit point then only serves
   * sessions that were already waiting.
   * @param root - absolute project root to scan.
   * @param sessionId - session to notify when the scan commits, if any.
   */
  private scheduleScan(root: string, sessionId?: SessionId): void {
    const waiting = this.waiting.get(root) ?? new Set<SessionId>()
    if (sessionId !== undefined) waiting.add(sessionId)
    this.waiting.set(root, waiting)
    if (this.inflight.has(root)) return
    if (this.timers.has(root)) return
    const timer = setTimeout(() => {
      this.timers.delete(root)
      void this.runScan(root)
    }, this.scanDebounceMs)
    this.timers.set(root, timer)
  }

  /**
   * Read the stored document for a scan decision, treating an unreadable
   * stored document (wrong version, over-cap, missing section, unparsable) as
   * absent — the scan is the rebuild that repairs it. Only an aborted read
   * propagates.
   * @param root - absolute project root to read.
   * @param signal - aborts the stored-document read.
   * @returns the stored document, or `undefined` when absent or unreadable.
   */
  private async storedDocument(
    root: string,
    signal?: AbortSignal,
  ): Promise<{ doc: ProjectInsightDoc; status: 'fresh' | 'stale' } | undefined> {
    try {
      return await readDocument(root, MAX_FINGERPRINT_FILES, signal)
    } catch {
      signal?.throwIfAborted()
      return undefined
    }
  }

  /**
   * Run one root's scan, single-flight, notifying waiters at the commit point.
   *
   * The inflight entry is registered before the first await so a concurrent
   * session joins the waiting set rather than scheduling a second scan. A fresh
   * document is a no-op; a scan failure is logged, never thrown to a session
   * listener.
   * @param root - absolute project root to scan.
   */
  private runScan(root: string): Promise<void> {
    const pending = (async () => {
      try {
        const existing = await this.storedDocument(root)
        if (existing?.status === 'fresh') return
        const { doc } = await scanProject(root)
        await writeDocument(root, doc)
        this.announce(root)
      } catch (error) {
        this.ctx.logger.warn(`project-insight: auto-scan of "${root}" failed: ${errorMessage(error)}`)
      } finally {
        this.inflight.delete(root)
      }
    })()
    this.inflight.set(root, pending)
    return pending
  }

  /**
   * Notify every session waiting on a root, then retire the waiting set.
   * Emits only after the scan's write committed (called from the success path).
   * @param root - the project root whose scan completed.
   */
  private announce(root: string): void {
    const waiting = this.waiting.get(root)
    this.waiting.delete(root)
    if (waiting === undefined) return
    for (const sessionId of waiting) {
      this.ctx.emit('project-insight/updated', sessionId)
    }
  }
}

export default ProjectInsight
