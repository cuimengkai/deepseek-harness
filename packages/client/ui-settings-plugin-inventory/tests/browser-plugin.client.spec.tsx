// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginInventoryClientStore } from '../src/client/store.ts'
import type {
  PluginManagerInstallResult,
  PluginManagerInstallValue,
  PluginManagerUninstallResult,
} from '@deepseek-ai/dsh-api-remotes/client'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { entries: [] }
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
type CatalogResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

const OK_INSTALL: PluginManagerInstallResult = {
  ok: true,
  value: {
    entryId: 'dsh-managed-x' as unknown as PluginManagerInstallValue['entryId'],
    moduleName: 'pkg',
    phase: 'loading',
  },
}
const OK_UNINSTALL: PluginManagerUninstallResult = { ok: true, value: { absent: true } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)

  /** Forwarded-event subscription table the mock Remote exposes to tests. */
  const listeners = new Map<string, Set<() => void>>()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
    $on(event: string, listener: () => void): () => void {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(event, set)
      return () => { set.delete(listener) }
    }
  }
  new RemoteService(ctx)

  const list = vi.fn<() => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  ctx.provide('remote.pluginInventory', { list })
  const listAvailable = vi.fn<() => Promise<CatalogResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  const refreshCatalog = vi.fn<() => Promise<CatalogResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  const installPlugin = vi.fn<() => Promise<{ readonly ok: true; readonly value: PluginManagerInstallResult }>>()
    .mockResolvedValue({ ok: true, value: OK_INSTALL })
  const uninstallPlugin = vi.fn<() => Promise<{ readonly ok: true; readonly value: PluginManagerUninstallResult }>>()
    .mockResolvedValue({ ok: true, value: OK_UNINSTALL })
  ctx.provide('remote.pluginManager', {
    listAvailable,
    refreshCatalog,
    installPlugin,
    uninstallPlugin,
  })

  /** Deliver one forwarded Host event to every subscribed listener. */
  const emit = (event: string): void => {
    for (const listener of listeners.get(event) ?? []) listener()
  }

  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale,
    list, listAvailable, refreshCatalog, installPlugin, uninstallPlugin, emit,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

/** The tab's injected controller, reading only through the mocked wire. */
async function mountTab(): Promise<{
  b: Awaited<ReturnType<typeof bench>>
  injected: PluginInventorySettingsTabInjected
}> {
  const b = await bench()
  declare(b.slots)
  await b.ctx.plugin({ inject: [...inject], apply }).await()
  const entry = b.slots.entries('settings.plugins.tab')[0]!
  return { b, injected: (entry.inject as unknown as () => PluginInventorySettingsTabInjected)() }
}

/** Wait until both faces hold ready snapshots (the store's async reads settled). */
async function ready(controller: PluginInventoryClientStore): Promise<void> {
  await vi.waitFor(() => {
    expect(controller.store.getSnapshot().inventory.status).toBe('ready')
    expect(controller.store.getSnapshot().catalog.status).toBe('ready')
  })
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.pluginManager'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const { b, injected } = await mountTab()
    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(PluginInventorySettingsTab)
    expect(entry.options).toMatchObject({ id: 'all', order: 10 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件')
    expect(b.list).not.toHaveBeenCalled()
    expect(b.listAvailable).not.toHaveBeenCalled()

    // The controller reads lazily on first mount.
    injected.controller.ensureLoaded()
    await ready(injected.controller)
    expect(b.list).toHaveBeenCalledOnce()
    expect(b.listAvailable).toHaveBeenCalledOnce()
    expect(injected.controller.store.getSnapshot().inventory).toEqual({
      status: 'ready', stale: false, snapshot: EMPTY,
    })
    expect(injected.controller.store.getSnapshot().catalog).toEqual({
      status: 'ready', stale: false, snapshot: EMPTY,
    })

    // A fresh remount hits the cache: no second read.
    injected.controller.ensureLoaded()
    expect(b.list).toHaveBeenCalledTimes(1)
    expect(b.listAvailable).toHaveBeenCalledTimes(1)
    await b.ctx.fiber.dispose()
  })

  it('refetches only on a pushed invalidation while the tab is mounted', async () => {
    const { b, injected } = await mountTab()
    injected.controller.ensureLoaded()
    await ready(injected.controller)
    const dispose = injected.controller.store.subscribe(() => {})

    // A live subscriber: the inventory event refetches only the inventory face.
    b.emit('plugin-inventory/changed')
    await vi.waitFor(() => { expect(b.list).toHaveBeenCalledTimes(2) })
    expect(b.listAvailable).toHaveBeenCalledTimes(1)

    // The catalog event refetches only the catalog face.
    b.emit('plugin-manager/catalog-changed')
    await vi.waitFor(() => { expect(b.listAvailable).toHaveBeenCalledTimes(2) })
    expect(b.list).toHaveBeenCalledTimes(2)

    // A new connection generation forces both faces regardless of subscribers.
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.list).toHaveBeenCalledTimes(3) })
    expect(b.listAvailable).toHaveBeenCalledTimes(3)

    dispose()
    await b.ctx.fiber.dispose()
  })

  it('marks unobserved invalidations stale so the next mount refetches', async () => {
    const { b, injected } = await mountTab()
    injected.controller.ensureLoaded()
    await ready(injected.controller)

    // No live subscriber: the event leaves the cached snapshot in place.
    b.emit('plugin-inventory/changed')
    await Promise.resolve()
    expect(b.list).toHaveBeenCalledTimes(1)
    expect(injected.controller.store.getSnapshot().inventory).toEqual({
      status: 'ready', stale: true, snapshot: EMPTY,
    })

    // The next mount sees the stale face and refetches.
    injected.controller.ensureLoaded()
    await ready(injected.controller)
    expect(b.list).toHaveBeenCalledTimes(2)
    expect(injected.controller.store.getSnapshot().inventory.status).toBe('ready')
    await b.ctx.fiber.dispose()
  })

  it('maps transport failures to error faces and business refusals to results', async () => {
    const { b, injected } = await mountTab()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    injected.controller.load()
    await vi.waitFor(() => {
      expect(injected.controller.store.getSnapshot().inventory.status).toBe('error')
    })

    b.installPlugin.mockResolvedValueOnce({ ok: true, value: { ok: false, error: { code: 'confirmation-required', name: 'pkg' } } })
    const refused = await injected.controller.install('pkg', { confirmed: true })
    expect(refused.ok).toBe(false)
    expect(b.installPlugin).toHaveBeenLastCalledWith({ name: 'pkg', confirmed: true })
    await b.ctx.fiber.dispose()
  })

  it('installs and uninstalls through the wire and reloads both faces on commit', async () => {
    const { b, injected } = await mountTab()
    injected.controller.ensureLoaded()
    await ready(injected.controller)

    const installed = await injected.controller.install('@fixture/ping', { confirmed: true, allowScripts: true })
    expect(installed.ok).toBe(true)
    expect(b.installPlugin).toHaveBeenCalledWith({
      name: '@fixture/ping', confirmed: true, allowScripts: true,
    })
    // A committed install reloads both faces at the commit point.
    await vi.waitFor(() => { expect(b.list).toHaveBeenCalledTimes(2) })
    expect(b.listAvailable).toHaveBeenCalledTimes(2)

    const removed = await injected.controller.uninstall('@fixture/ping')
    expect(removed.ok).toBe(true)
    expect(b.uninstallPlugin).toHaveBeenCalledWith({ name: '@fixture/ping' })
    await vi.waitFor(() => { expect(b.list).toHaveBeenCalledTimes(3) })
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Plugins')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(PluginInventorySettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
