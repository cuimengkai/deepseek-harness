/**
 * Registration: use-for-session stamps agentMode via agentModes.select.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type { AgentModeSectionInjected } from '../src/client/AgentModeSection.tsx'

describe('use-for-session', () => {
  it('selects the mode on the blank session (stamps agentMode + bound preset)', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const select = vi.fn(async () => ({ ok: true as const, value: 'hello-orchestration' }))
    const listeners = new Set<() => void>()
    const listState = {
      current: undefined as string | undefined,
      byId: {} as Record<string, { id: string; blank: boolean }>,
    }
    ctx.provide('remote', {
      agentModes: {
        list: vi.fn(async () => ({ ok: true, value: { modes: [], authorable: true } })),
        select,
        read: vi.fn(),
        readFlow: vi.fn(),
        saveFlow: vi.fn(),
        create: vi.fn(),
        saveBind: vi.fn(),
        copy: vi.fn(),
        deleteMode: vi.fn(),
        tryRun: vi.fn(),
        getTryRun: vi.fn(),
      },
      agentPresets: {
        list: async () => ({ ok: true, value: { presets: [], authorable: true } }),
        select: vi.fn(),
      },
    } as never)
    ctx.provide('remote.agentModes', (ctx.get('remote') as { agentModes: unknown }).agentModes)
    ctx.provide('remote.agentPresets', (ctx.get('remote') as { agentPresets: unknown }).agentPresets)
    ctx.provide('router', {
      navigate: vi.fn(),
      getSnapshot: () => ({ pathname: '/', search: '' }),
      subscribe: () => () => {},
    })
    ctx.provide('sessions', {
      list: {
        getSnapshot: () => listState,
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      },
    } as never)
    ctx.provide('uiWorkspace', {
      startSession: () => {
        listState.current = 's1'
        listState.byId.s1 = { id: 's1', blank: true }
        for (const fn of listeners) fn()
      },
    } as never)

    await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    slots.register({
      name: 'settings.section',
      id: 'agent',
      children: { 'settings.agent.tab': { kind: 'list', scope: 'root' } },
    } as never, () => null)

    await ctx.plugin({ inject: [...inject, 'sessions', 'uiWorkspace'], apply }).await()

    const tab = slots.entries('settings.agent.tab').find(e => e.options.id === 'modes')
    expect(tab).toBeDefined()
    const injected = (tab!.inject as unknown as () => AgentModeSectionInjected)()
    expect(injected.useForSession).toBeTypeOf('function')
    injected.useForSession!('hello-orchestration')
    expect(select).toHaveBeenCalledWith('s1', 'hello-orchestration')
  })
})
