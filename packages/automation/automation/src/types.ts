/**
 * Automation-rule vocabulary: one persisted schedule that fires while the
 * Host process is running.
 * @module @deepseek-ai/dsh-automation/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one saved automation rule. Also the persisted file name. */
export type AutomationId = Branded<'AutomationId'>

/** Brand a string as a {@link AutomationId}.
 * @param id - the raw id string.
 * @returns the same string, branded.
 */
export function AutomationId(id: string): AutomationId {
  return id as AutomationId
}

/** On-disk document version; readers refuse any other. */
export const AUTOMATION_FORMAT_VERSION = 1

/** How the rule chooses its next fire time. */
export type AutomationKind = 'interval' | 'daily' | 'weekly' | 'once'

/** One persisted schedule rule. */
export interface AutomationRule {
  readonly id: AutomationId
  readonly name: string
  readonly prompt: string
  readonly enabled: boolean
  readonly kind: AutomationKind
  /** Interval between fires, when `kind` is `interval`. */
  readonly intervalMs?: number
  /** Hour 0–23 for daily/weekly. */
  readonly hour?: number
  /** Minute 0–59 for daily/weekly. */
  readonly minute?: number
  /** JS weekday 0–6 for weekly (Sunday = 0). */
  readonly weekday?: number
  /** Unix ms for a one-shot. */
  readonly atMs?: number
  readonly workspace?: string
  readonly agentPreset?: string
  readonly lastFiredAt?: number
  readonly lastError?: string
  readonly updatedAt: number
}

/** Fields `create` / `update` accept. */
export interface AutomationDraft {
  readonly name: string
  readonly prompt: string
  readonly enabled?: boolean
  readonly kind: AutomationKind
  readonly intervalMs?: number
  readonly hour?: number
  readonly minute?: number
  readonly weekday?: number
  readonly atMs?: number
  readonly workspace?: string
  readonly agentPreset?: string
}
