/**
 * Automation scheduler: due-rule math, persist, and tick without a session.
 * @module tests/service
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AutomationScheduler, isDue } from '../src/index.ts'
import type { AutomationRule } from '../src/index.ts'

const rule = (extra: Partial<AutomationRule> & Pick<AutomationRule, 'kind'>): AutomationRule => ({
  id: 'r1' as AutomationRule['id'],
  name: 'R',
  prompt: 'do it',
  enabled: true,
  updatedAt: 1,
  ...extra,
})

describe('isDue', () => {
  it('fires an interval rule when never fired or the interval elapsed', () => {
    expect(isDue(rule({ kind: 'interval', intervalMs: 60_000 }), 100_000)).toBe(true)
    expect(isDue(rule({ kind: 'interval', intervalMs: 60_000, lastFiredAt: 80_000 }), 100_000)).toBe(false)
    expect(isDue(rule({ kind: 'interval', intervalMs: 60_000, lastFiredAt: 20_000 }), 100_000)).toBe(true)
  })

  it('fires a once rule at or after atMs, only once', () => {
    expect(isDue(rule({ kind: 'once', atMs: 50 }), 49)).toBe(false)
    expect(isDue(rule({ kind: 'once', atMs: 50 }), 50)).toBe(true)
    expect(isDue(rule({ kind: 'once', atMs: 50, lastFiredAt: 50 }), 80)).toBe(false)
  })

  it('ignores a disabled rule', () => {
    expect(isDue(rule({ kind: 'interval', intervalMs: 1, enabled: false }), 10)).toBe(false)
  })

  it('rejects an interval without a positive period', () => {
    expect(isDue(rule({ kind: 'interval' }), 10)).toBe(false)
    expect(isDue(rule({ kind: 'interval', intervalMs: 0 }), 10)).toBe(false)
  })

  it('fires daily at the matching local clock once per day', () => {
    const noon = new Date(2026, 7, 30, 12, 0, 0).getTime()
    const laterSameDay = new Date(2026, 7, 30, 12, 1, 0).getTime()
    expect(isDue(rule({ kind: 'daily', hour: 12, minute: 0 }), noon)).toBe(true)
    expect(isDue(rule({ kind: 'daily', hour: 12, minute: 0, lastFiredAt: noon }), laterSameDay)).toBe(false)
    expect(isDue(rule({ kind: 'daily', hour: 9, minute: 0 }), noon)).toBe(false)
    expect(isDue(rule({ kind: 'daily' }), noon)).toBe(false)
    const nextYear = new Date(2027, 7, 30, 12, 0, 0).getTime()
    const nextMonth = new Date(2026, 8, 30, 12, 0, 0).getTime()
    expect(isDue(rule({ kind: 'daily', hour: 12, minute: 0, lastFiredAt: noon }), nextYear)).toBe(true)
    expect(isDue(rule({ kind: 'daily', hour: 12, minute: 0, lastFiredAt: noon }), nextMonth)).toBe(true)
    const nextDay = new Date(2026, 7, 31, 12, 0, 0).getTime()
    expect(isDue(rule({ kind: 'daily', hour: 12, minute: 0, lastFiredAt: noon }), nextDay)).toBe(true)
  })

  it('fires weekly on the matching weekday after a week has passed', () => {
    const sunday = new Date(2026, 7, 30, 9, 15, 0)
    expect(sunday.getDay()).toBe(0)
    const now = sunday.getTime()
    expect(isDue(rule({ kind: 'weekly', weekday: 0, hour: 9, minute: 15 }), now)).toBe(true)
    expect(isDue(rule({ kind: 'weekly', weekday: 0, hour: 8, minute: 0 }), now)).toBe(false)
    expect(isDue(rule({ kind: 'weekly', hour: 9, minute: 15 }), now)).toBe(false)
    expect(isDue(rule({ kind: 'weekly', weekday: 1, hour: 9, minute: 15 }), now)).toBe(false)
    expect(isDue(rule({
      kind: 'weekly', weekday: 0, hour: 9, minute: 15,
      lastFiredAt: now - 2 * 24 * 60 * 60 * 1000,
    }), now)).toBe(false)
    expect(isDue(rule({
      kind: 'weekly', weekday: 0, hour: 9, minute: 15,
      lastFiredAt: now - 7 * 24 * 60 * 60 * 1000,
    }), now)).toBe(true)
  })
})

describe('AutomationScheduler', () => {
  let root: string
  let scheduler: AutomationScheduler
  const fibers: Array<{ dispose: () => Promise<void> }> = []

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-automation-'))
    const ctx = new Context()
    const fiber = await ctx.plugin(AutomationScheduler, { root, tickMs: 60_000 })
    scheduler = ctx.automation
    fibers.push(fiber)
  })

  afterEach(async () => {
    for (const fiber of fibers.splice(0)) await fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('creates, lists, disables, and removes a rule', async () => {
    const created = await scheduler.create({
      name: 'Hourly digest',
      prompt: 'Summarize the inbox',
      kind: 'interval',
      intervalMs: 3_600_000,
    })
    expect(created).toMatchObject({ name: 'Hourly digest', kind: 'interval', enabled: true })
    expect(await scheduler.list()).toEqual([created])
    const disabled = await scheduler.setEnabled(created.id, false)
    expect(disabled.enabled).toBe(false)
    await scheduler.tick()
    const daily = await scheduler.create({
      name: 'Morning',
      prompt: 'Brief',
      kind: 'daily',
      hour: 9,
      minute: 0,
    })
    const weekly = await scheduler.create({
      name: 'Monday',
      prompt: 'Standup',
      kind: 'weekly',
      weekday: 1,
      hour: 10,
      minute: 30,
    })
    expect(daily.hour).toBe(9)
    expect(weekly.weekday).toBe(1)
    await scheduler.remove(created.id)
    await scheduler.remove(daily.id)
    await scheduler.remove(weekly.id)
    expect(await scheduler.list()).toEqual([])
  })

  it('records lastError on tick when sessionController is absent', async () => {
    const created = await scheduler.create({
      name: 'Now',
      prompt: 'Go',
      kind: 'interval',
      intervalMs: 1,
    })
    await scheduler.tick()
    const after = (await scheduler.list()).find(item => item.id === created.id)
    expect(after?.lastError).toContain('sessionController')
  })

  it('refuses an empty name or prompt', async () => {
    await expect(scheduler.create({ name: '  ', prompt: 'x', kind: 'once', atMs: 1 })).rejects.toThrow('name is required')
    await expect(scheduler.create({ name: 'X', prompt: '  ', kind: 'once', atMs: 1 })).rejects.toThrow('prompt is required')
  })

  it('updates a rule, refuses a missing id, and fires through sessionController', async () => {
    const created = await scheduler.create({
      name: 'Once',
      prompt: 'Go',
      kind: 'once',
      atMs: 1,
      workspace: '/tmp/ws',
      agentPreset: 'standard',
    })
    const updated = await scheduler.update(created.id, {
      name: 'Once',
      prompt: 'Go now',
      kind: 'once',
      atMs: 1,
    })
    expect(updated.prompt).toBe('Go now')
    expect(updated.lastFiredAt).toBeUndefined()
    await expect(scheduler.update('missing' as never, {
      name: 'X',
      prompt: 'Y',
      kind: 'once',
      atMs: 1,
    })).rejects.toThrow('is not saved')
    await expect(scheduler.setEnabled('missing' as never, false)).rejects.toThrow('is not saved')

    const calls: string[] = []
    const fireRoot = await mkdtemp(join(tmpdir(), 'dsh-automation-fire-'))
    const ctx = new Context()
    ctx.provide('sessionController', {
      create: async (opts: { cwd?: string; agentPreset?: string }) => {
        calls.push(`create:${opts.cwd ?? ''}:${opts.agentPreset ?? ''}`)
        return { sessionId: 's1' }
      },
      prompt: async () => {
        calls.push('prompt')
      },
    })
    fibers.push(await ctx.plugin(AutomationScheduler, { root: fireRoot, tickMs: 60_000 }))
    await ctx.automation.create({
      name: 'Fire',
      prompt: 'Do',
      kind: 'interval',
      intervalMs: 1,
      workspace: '/tmp/ws',
      agentPreset: 'standard',
    })
    await ctx.automation.tick()
    await ctx.automation.tick()
    expect(calls).toContain('create:/tmp/ws:standard')
    expect(calls).toContain('prompt')
    const fired = (await ctx.automation.list()).find(item => item.name === 'Fire')
    expect(fired?.lastFiredAt).toBeDefined()
    expect(fired?.lastError).toBeUndefined()
    const kept = await ctx.automation.update(fired!.id, {
      name: 'Fire',
      prompt: 'Do again',
      kind: 'interval',
      intervalMs: 1,
      workspace: '/tmp/ws',
      agentPreset: 'standard',
    })
    expect(kept.lastFiredAt).toBe(fired!.lastFiredAt)
    await rm(fireRoot, { recursive: true, force: true })
  })

  it('records lastError when prompt fails', async () => {
    const failRoot = await mkdtemp(join(tmpdir(), 'dsh-automation-fail-'))
    const ctx = new Context()
    ctx.provide('sessionController', {
      create: async () => ({ sessionId: 's1' }),
      prompt: async () => {
        throw new Error('queue full')
      },
    })
    fibers.push(await ctx.plugin(AutomationScheduler, { root: failRoot, tickMs: 60_000 }))
    await ctx.automation.create({ name: 'Fail', prompt: 'Do', kind: 'interval', intervalMs: 1 })
    await ctx.automation.tick()
    const after = (await ctx.automation.list()).find(item => item.name === 'Fail')
    expect(after?.lastError).toContain('queue full')
    await rm(failRoot, { recursive: true, force: true })
  })

  it('skips a second tick while one fire is in flight and records a non-Error failure', async () => {
    const hangRoot = await mkdtemp(join(tmpdir(), 'dsh-automation-hang-'))
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let inflight = 0
    const ctx = new Context()
    ctx.provide('sessionController', {
      create: async () => ({ sessionId: 's1' }),
      prompt: async () => {
        inflight += 1
        await blocked
      },
    })
    fibers.push(await ctx.plugin(AutomationScheduler, { root: hangRoot, tickMs: 60_000 }))
    await ctx.automation.create({
      name: 'Hang',
      prompt: 'Do',
      kind: 'interval',
      intervalMs: 1,
      workspace: '',
      agentPreset: '',
    })
    const first = ctx.automation.tick()
    await ctx.automation.tick()
    expect(inflight).toBe(1)
    release()
    await first
    const stringRoot = await mkdtemp(join(tmpdir(), 'dsh-automation-str-'))
    const failing = new Context()
    failing.provide('sessionController', {
      create: async () => ({ sessionId: 's1' }),
      prompt: async () => {
        throw 'string-fail'
      },
    })
    fibers.push(await failing.plugin(AutomationScheduler, { root: stringRoot, tickMs: 60_000 }))
    await failing.automation.create({ name: 'Str', prompt: 'Do', kind: 'interval', intervalMs: 1 })
    await failing.automation.tick()
    const after = (await failing.automation.list()).find(item => item.name === 'Str')
    expect(after?.lastError).toBe('string-fail')
    await rm(hangRoot, { recursive: true, force: true })
    await rm(stringRoot, { recursive: true, force: true })
  })

  it('reloads from disk after a restart', async () => {
    const created = await scheduler.create({
      name: 'Keep',
      prompt: 'Stay',
      kind: 'once',
      atMs: 1,
    })
    const second = new Context()
    fibers.push(await second.plugin(AutomationScheduler, { root, tickMs: 60_000 }))
    expect(await second.automation.list()).toMatchObject([{ id: created.id, name: 'Keep' }])
  })
})
