/**
 * App-running-only automation scheduler: persist rules and fire a session
 * prompt while this process is alive. Does not claim wake-from-closed.
 * @module @deepseek-ai/dsh-automation
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  deleteAutomationFile,
  idFromName,
  listAutomationFiles,
  writeAutomationFile,
} from './persist.ts'
import { isDue } from './schedule.ts'
import type { AutomationDraft, AutomationId, AutomationRule } from './types.ts'

export type { AutomationDraft, AutomationKind, AutomationRule } from './types.ts'
export { AUTOMATION_FORMAT_VERSION, AutomationId } from './types.ts'
export { AUTOMATION_ID_PATTERN, idFromName } from './persist.ts'
export { isDue } from './schedule.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    automation: AutomationScheduler
  }
}

/** Deployment-tunable store root and timer period. */
export interface Config {
  /** Directory that holds `<id>.json` rule documents. */
  readonly root: string
  /** How often the in-process timer re-evaluates due rules. */
  readonly tickMs: number
}

/**
 * File-backed scheduler. The timer runs only while this plugin is loaded.
 */
export class AutomationScheduler extends TypertRemoteService {
  static inject = []

  static Config = z.object({
    root: z.string().default(dshHomePath('automation')),
    tickMs: z.number().min(1_000).max(3_600_000).default(30_000),
  }) as unknown as z<Config>

  private readonly rules = new Map<string, AutomationRule>()
  private sessions: SessionController | undefined
  private ready: Promise<void>
  private ticking = false

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'automation')
    ctx.inject(['sessionController'], (scope) => {
      this.sessions = scope.sessionController
      scope.effect(() => () => {
        this.sessions = undefined
      }, 'automation.sessionController()')
    })
    this.ready = this.hydrate()
    /* v8 ignore start -- the timer is process-lifetime; tests call tick() */
    const timer = setInterval(() => {
      void this.tick()
    }, config.tickMs)
    timer.unref?.()
    /* v8 ignore stop */
    ctx.effect(() => () => {
      clearInterval(timer)
    }, 'automation.timer')
  }

  /**
   * List every persisted rule.
   * @returns rules, id order.
   */
  @Remote('list')
  async list(): Promise<readonly AutomationRule[]> {
    await this.ready
    return [...this.rules.values()]
  }

  /**
   * Create one rule.
   * @param draft - name, prompt, schedule fields.
   * @returns the saved rule.
   */
  @Remote('create')
  async create(draft: AutomationDraft): Promise<AutomationRule> {
    await this.ready
    const rule = this.normalize(idFromName(draft.name, new Set(this.rules.keys())), draft)
    return this.put(rule)
  }

  /**
   * Replace one rule's authoring fields (keeps lastFiredAt).
   * @param id - existing id.
   * @param draft - replacement fields.
   * @returns the saved rule.
   */
  @Remote('update')
  async update(id: AutomationId, draft: AutomationDraft): Promise<AutomationRule> {
    await this.ready
    const current = this.rules.get(id)
    if (current === undefined) throw new Error(`automation "${id}" is not saved`)
    return this.put({
      ...this.normalize(id, draft),
      ...current.lastFiredAt === undefined ? {} : { lastFiredAt: current.lastFiredAt },
    })
  }

  /**
   * Enable or disable one rule.
   * @param id - existing id.
   * @param enabled - the new flag.
   * @returns the saved rule.
   */
  @Remote('setEnabled')
  async setEnabled(id: AutomationId, enabled: boolean): Promise<AutomationRule> {
    await this.ready
    const current = this.rules.get(id)
    if (current === undefined) throw new Error(`automation "${id}" is not saved`)
    return this.put({ ...current, enabled, updatedAt: Date.now() })
  }

  /**
   * Delete one rule.
   * @param id - existing id.
   */
  @Remote('remove')
  async remove(id: AutomationId): Promise<void> {
    await this.ready
    this.rules.delete(id)
    await deleteAutomationFile(this.config.root, id)
  }

  /**
   * Evaluate every enabled rule once. Tests call this instead of waiting
   * for `tickMs`.
   */
  async tick(): Promise<void> {
    await this.ready
    if (this.ticking) return
    this.ticking = true
    try {
      const now = Date.now()
      for (const rule of [...this.rules.values()]) {
        if (!isDue(rule, now)) continue
        await this.fire(rule, now)
      }
    } finally {
      this.ticking = false
    }
  }

  private async fire(rule: AutomationRule, now: number): Promise<void> {
    if (this.sessions === undefined) {
      await this.put({
        ...rule,
        lastError: 'sessionController is not composed — automation cannot start a session',
        updatedAt: now,
      })
      return
    }
    try {
      const created = await this.sessions.create({
        ...rule.workspace === undefined || rule.workspace === '' ? {} : { cwd: rule.workspace },
        ...rule.agentPreset === undefined || rule.agentPreset === '' ? {} : { agentPreset: rule.agentPreset },
      })
      await this.sessions.prompt({
        requestId: randomUUID() as SessionRequestId,
        sessionId: created.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: rule.prompt }],
      }, AbortSignal.timeout(this.config.tickMs))
      const { lastError: _cleared, ...rest } = rule
      await this.put({
        ...rest,
        lastFiredAt: now,
        updatedAt: now,
      })
    } catch (error) {
      await this.put({
        ...rule,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: now,
      })
    }
  }

  private normalize(id: AutomationId, draft: AutomationDraft): AutomationRule {
    if (draft.name.trim() === '') throw new Error('automation name is required')
    if (draft.prompt.trim() === '') throw new Error('automation prompt is required')
    return {
      id,
      name: draft.name.trim(),
      prompt: draft.prompt,
      enabled: draft.enabled ?? true,
      kind: draft.kind,
      ...draft.intervalMs === undefined ? {} : { intervalMs: draft.intervalMs },
      ...draft.hour === undefined ? {} : { hour: draft.hour },
      ...draft.minute === undefined ? {} : { minute: draft.minute },
      ...draft.weekday === undefined ? {} : { weekday: draft.weekday },
      ...draft.atMs === undefined ? {} : { atMs: draft.atMs },
      ...draft.workspace === undefined || draft.workspace === '' ? {} : { workspace: draft.workspace },
      ...draft.agentPreset === undefined || draft.agentPreset === '' ? {} : { agentPreset: draft.agentPreset },
      updatedAt: Date.now(),
    }
  }

  private async put(rule: AutomationRule): Promise<AutomationRule> {
    const stored: AutomationRule = {
      ...rule,
      ...rule.lastError === undefined ? {} : { lastError: rule.lastError },
    }
    await writeAutomationFile(this.config.root, stored)
    this.rules.set(rule.id, stored)
    return stored
  }

  private async hydrate(): Promise<void> {
    for (const rule of await listAutomationFiles(this.config.root)) {
      this.rules.set(rule.id, rule)
    }
  }
}

export default AutomationScheduler
