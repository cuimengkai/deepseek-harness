/**
 * Whether an enabled rule is due at `now`. Pure: no I/O.
 * @module @deepseek-ai/dsh-automation/schedule
 */

import type { AutomationRule } from './types.ts'

/**
 * Whether `rule` should fire at `now`.
 * @param rule - the persisted rule.
 * @param now - unix ms.
 * @returns true when the rule is enabled and due.
 */
export function isDue(rule: AutomationRule, now: number): boolean {
  if (!rule.enabled) return false
  switch (rule.kind) {
    case 'interval': {
      const interval = rule.intervalMs
      if (interval === undefined || interval < 1) return false
      if (rule.lastFiredAt === undefined) return true
      return now - rule.lastFiredAt >= interval
    }
    case 'daily': {
      if (!clockMatches(rule, now)) return false
      return !sameLocalDay(rule.lastFiredAt, now)
    }
    case 'weekly': {
      if (rule.weekday === undefined) return false
      if (new Date(now).getDay() !== rule.weekday) return false
      if (!clockMatches(rule, now)) return false
      return rule.lastFiredAt === undefined || now - rule.lastFiredAt >= 6 * 24 * 60 * 60 * 1000
    }
    case 'once': {
      if (rule.atMs === undefined || now < rule.atMs) return false
      return rule.lastFiredAt === undefined
    }
  }
}

function clockMatches(rule: AutomationRule, now: number): boolean {
  if (rule.hour === undefined || rule.minute === undefined) return false
  const date = new Date(now)
  return date.getHours() === rule.hour && date.getMinutes() === rule.minute
}

function sameLocalDay(left: number | undefined, right: number): boolean {
  if (left === undefined) return false
  const a = new Date(left)
  const b = new Date(right)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
