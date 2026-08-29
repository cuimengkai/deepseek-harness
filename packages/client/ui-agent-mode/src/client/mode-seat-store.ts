/**
 * Hero-chip controller: which scenario Agent (mode) the NEXT session gets.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-agent-modes/types'
import { modeDisplayText, type AgentModeSettingsKey } from './locales.ts'

/** One selectable scenario row. */
export interface ScenarioOption {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string
  readonly description?: string
  readonly preset?: string
  readonly broken?: string
}

/** Hero scenario-chip snapshot. */
export interface AgentModeSeatState {
  /** Modes the deployment supplies; empty means the chip renders nothing. */
  options: readonly ScenarioOption[]
  /** Staged scenario id, or empty until the roster loads / none selected. */
  current: string
  /** A rejected apply's message. */
  error: string | null
  busy: boolean
  /** One-shot introduce cue after staging from settings. */
  introduce: boolean
}

const INITIAL: AgentModeSeatState = {
  options: [], current: '', error: null, busy: false, introduce: false,
}

/**
 * Format a remote/refusal error for the chip.
 * @param error - unknown failure.
 * @returns display text.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Mode id currently on a session projection.
 * @param session - session summary.
 * @returns mode id or undefined.
 */
function modeOf(
  session: Pick<SessionSummary, 'projectionValues'> | undefined,
): string | undefined {
  const value = session?.projectionValues?.agentMode
  return typeof value === 'string' ? value : undefined
}

/** Stages the next session's scenario and applies it when a blank session appears. */
export class AgentModeSeatController {
  /** Chip snapshot. */
  readonly store: SnapshotStore<AgentModeSeatState> = createSnapshotStore(INITIAL)

  private fallback = ''
  private staged: string | undefined

  constructor(
    private readonly remote: Pick<ClientRemote, 'agentModes'>,
    private readonly currentSession: () => Pick<
      SessionSummary,
      'id' | 'blank' | 'projectionValues'
    > | undefined,
  ) {}

  private set(patch: Partial<AgentModeSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Load the mode roster.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const result = await this.remote.agentModes.list()
    if (!result.ok) {
      this.set({ error: result.error.message, options: [] })
      return
    }
    const options: ScenarioOption[] = result.value.modes
      .filter(mode => mode.broken === undefined)
      .map(mode => ({
        id: mode.id,
        trust: mode.trust,
        ...mode.name === undefined ? {} : { name: mode.name },
        ...mode.description === undefined ? {} : { description: mode.description },
        ...mode.preset === undefined ? {} : { preset: mode.preset },
      }))
    this.fallback = result.value.modes.find(mode => mode.isDefault)?.id
      ?? options[0]?.id
      ?? ''
    const session = this.currentSession()
    this.set({
      options,
      current: this.staged ?? (session === undefined ? this.fallback : modeOf(session) ?? this.fallback),
      error: null,
    })
  }

  /**
   * Stage and apply one scenario.
   * @param id - mode id.
   * @returns refusal text, or undefined.
   */
  async select(id: string): Promise<string | undefined> {
    if (this.store.getSnapshot().busy) return undefined
    this.stage(id)
    await this.apply()
    return this.store.getSnapshot().error ?? undefined
  }

  /**
   * Stage without immediate apply (settings "use for new session").
   * @param id - mode id.
   * @param introduce - announce on the landing session.
   */
  stage(id: string, introduce = false): void {
    this.staged = id
    this.set({ current: id, error: null, introduce })
  }

  /** Clear the introduce cue. */
  introduced(): void {
    if (!this.store.getSnapshot().introduce) return
    this.set({ introduce: false })
  }

  /**
   * Apply the staged scenario to the current blank session.
   * When nothing is staged but a blank session has no mode yet, apply the
   * chip's displayed current (usually the roster default) so Start can run.
   * @returns once settled.
   */
  async apply(): Promise<void> {
    const session = this.currentSession()
    const snap = this.store.getSnapshot()
    let target = this.staged
    if (target === undefined
      && session !== undefined
      && session.blank
      && modeOf(session) === undefined
      && snap.current !== '') {
      target = snap.current
    }
    if (target === undefined) {
      const current = session === undefined ? this.fallback : modeOf(session) ?? this.fallback
      if (current !== snap.current) this.set({ current })
      return
    }
    if (session === undefined) return
    if (!session.blank) return
    if (modeOf(session) === target) {
      this.staged = undefined
      return
    }
    this.set({ busy: true, error: null })
    try {
      const result = await this.remote.agentModes.select(session.id, target)
      this.staged = undefined
      if (!result.ok) {
        const { error } = result
        this.set({
          busy: false,
          error: 'reason' in error.details && typeof error.details.reason === 'string'
            ? error.details.reason
            : error.message,
          current: modeOf(session) ?? '',
        })
        return
      }
      this.set({ busy: false, current: result.value })
    } catch (error) {
      this.staged = undefined
      this.set({
        busy: false,
        error: messageOf(error),
        current: modeOf(session) ?? '',
      })
    }
  }
}

/**
 * Display name for a scenario option.
 * @param option - roster row.
 * @param t - locale lookup.
 * @returns display name.
 */
export function scenarioLabel(
  option: ScenarioOption,
  t: (key: AgentModeSettingsKey) => string,
): string {
  return modeDisplayText(option, t).name
}
