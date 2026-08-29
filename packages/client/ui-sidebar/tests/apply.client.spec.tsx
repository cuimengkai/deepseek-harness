/** Sidebar shell slot registration and its Session/layout callbacks. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  AutomationPageInjected, ConnectorsPageInjected, SidebarRootInjected,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn() }
  const uiWorkspace = { startSession: vi.fn() }
  const router = {
    navigate: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getSnapshot: () => ({ pathname: '/', search: '', hash: '' }),
  }
  ctx.provide('layout', layout)
  ctx.provide('uiWorkspace', uiWorkspace as never)
  ctx.provide('router', router as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', {} as never)
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      {
        name: 'root',
        children: {
          'sidebar': { kind: 'single', scope: 'root' },
          'page': { kind: 'list', scope: 'root' },
        },
      } as never,
      () => null,
    )
  }
  return { ctx, slots, layout, uiWorkspace, router }
}

describe('ui-sidebar apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'uiWorkspace', 'locale', 'router', 'remote'])
  })

  it('registers the shell, primary-nav inject, and destination pages', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.spec('sidebar.brand.mark')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.brand.name')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.workspaces')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.settings')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.footer.action')).toEqual({ kind: 'list', scope: 'root' })
    // Copy rides the standard locale seat, not the inject face.
    expect(b.slots.entries('sidebar')[0]!.locale).toBe('sidebar')
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    expect(Object.keys(injected).sort()).toEqual([
      'getPathname', 'navigate', 'startSession', 'subscribePathname', 'toggleSidebar',
    ].sort())
    // Both arms delegate to the Workspace UI's shared New Task action.
    injected.startSession('workspace' as never)
    expect(b.uiWorkspace.startSession).toHaveBeenCalledWith('workspace')
    injected.startSession()
    expect(b.uiWorkspace.startSession).toHaveBeenLastCalledWith(undefined)
    injected.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
    injected.navigate('/projects')
    expect(b.router.navigate).toHaveBeenCalledWith('/projects')
    expect(injected.getPathname()).toBe('/')

    // Projects registers from ui-workspace (it needs `useWorkspaces`); only
    // Automation is this package's own page.
    const pages = b.slots.entries('page')
    expect(pages.map(p => p.options.id).sort()).toEqual(['automation', 'connectors'])
    expect(pages.find(p => p.options.id === 'automation')!.options.path).toBe('/automation')
    expect(pages.find(p => p.options.id === 'connectors')!.options.path).toBe('/connectors')

    const automation = (pages.find(p => p.options.id === 'automation')!.inject as unknown as () => AutomationPageInjected)()
    automation.goAssistant()
    automation.goAgentSettings()
    automation.goOrchestration()
    expect(b.router.navigate).toHaveBeenCalledWith('/')
    expect(b.router.navigate).toHaveBeenCalledWith('/settings/agent')
    expect(b.router.navigate).toHaveBeenCalledWith('/settings/agent?tab=modes')
    expect(() => automation.listRules()).toThrow(/automation remote is not mounted/)
    expect(() => automation.createRule({
      name: 'n', prompt: 'p', kind: 'interval', intervalMs: 1,
    })).toThrow(/automation remote is not mounted/)
    expect(() => automation.setRuleEnabled('r', true)).toThrow(/automation remote is not mounted/)
    expect(() => automation.removeRule('r')).toThrow(/automation remote is not mounted/)

    const connectors = (pages.find(p => p.options.id === 'connectors')!.inject as unknown as () => ConnectorsPageInjected)()
    connectors.goAssistant()
    expect(b.router.navigate).toHaveBeenCalledWith('/')
    expect(() => connectors.list()).toThrow(/connectors remote is not mounted/)
    expect(() => connectors.addHttp({ name: 'n', url: 'https://x' })).toThrow(/connectors remote is not mounted/)
    expect(() => connectors.setEnabled('c', true)).toThrow(/connectors remote is not mounted/)
    expect(() => connectors.remove('c')).toThrow(/connectors remote is not mounted/)
  })

  it('forwards Host remotes when the connector and automation namespaces are mounted', async () => {
    const b = await bench()
    const remotes = {
      connectors: {
        list: vi.fn(async () => []),
        addHttp: vi.fn(),
        setEnabled: vi.fn(),
        remove: vi.fn(),
        goAssistant: vi.fn(),
      },
      automation: {
        list: vi.fn(async () => []),
        create: vi.fn(),
        setEnabled: vi.fn(),
        remove: vi.fn(),
      },
    }
    Object.assign(b.ctx.remote, remotes)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const pages = b.slots.entries('page')
    const automation = (pages.find(p => p.options.id === 'automation')!.inject as unknown as () => AutomationPageInjected)()
    const connectors = (pages.find(p => p.options.id === 'connectors')!.inject as unknown as () => ConnectorsPageInjected)()
    await automation.listRules()
    await connectors.list()
    expect(remotes.automation.list).toHaveBeenCalledOnce()
    expect(remotes.connectors.list).toHaveBeenCalledOnce()
  })

  it('fails when no live owner declared the sidebar slot', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes the entry and child declaration on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.entries('page')).toHaveLength(0)
    expect(b.slots.spec('sidebar.brand.mark')).toBeUndefined()
    expect(b.slots.spec('sidebar.brand.name')).toBeUndefined()
    expect(b.slots.spec('sidebar.workspaces')).toBeUndefined()
    expect(b.slots.spec('sidebar.footer.action')).toBeUndefined()
  })
})
