/** Host plugin inventory and live install/uninstall registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the api-remotes client's forwarded-event key face so the
// `ctx.remote.$on` calls below typecheck against the allowlist.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  PluginInventorySnapshot,
  PluginManagerCatalogSnapshot,
  PluginManagerInstallResult,
  PluginManagerUninstallResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'
import { PluginInventoryClientStore, type PluginInventoryWire } from './store.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'
export type {
  PluginInventoryClientState,
  PluginInventoryFaceState,
  PluginInventoryWire,
} from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.pluginManager']

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const wire: PluginInventoryWire = {
    list: async (): Promise<PluginInventorySnapshot> => {
      const result = await ctx.remote.pluginInventory.list()
      if (!result.ok) throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    listAvailable: async (): Promise<PluginManagerCatalogSnapshot> => {
      const result = await ctx.remote.pluginManager.listAvailable()
      if (!result.ok) throw new Error(`pluginManager.listAvailable failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    refreshCatalog: async (): Promise<PluginManagerCatalogSnapshot> => {
      const result = await ctx.remote.pluginManager.refreshCatalog()
      if (!result.ok) throw new Error(`pluginManager.refreshCatalog failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    // The generated binding wraps the business result in a transport Result:
    // transport failures surface as `{ ok: false, error: RemoteFailure }` and
    // the business union (success OR rejection with a business code) arrives
    // inside `value`. Unwrap the transport layer and pass the business union
    // through so the tab can show the localized code instead of treating a
    // business refusal as a transport failure.
    installPlugin: async ({ name, confirmed, allowScripts }): Promise<PluginManagerInstallResult> => {
      const request = allowScripts === undefined
        ? { name, confirmed }
        : { name, confirmed, allowScripts }
      const result = await ctx.remote.pluginManager.installPlugin(request)
      if (!result.ok) throw new Error(`pluginManager.installPlugin failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    uninstallPlugin: async ({ name }): Promise<PluginManagerUninstallResult> => {
      const result = await ctx.remote.pluginManager.uninstallPlugin({ name })
      if (!result.ok) throw new Error(`pluginManager.uninstallPlugin failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
  }
  const controller = new PluginInventoryClientStore(wire)
  // Registration-time text (the nav label thunk) uses one bound translate;
  // the component's copy arrives through PropsLocale.
  const t = ctx.locale.bind(NS)

  // Pushed Host invalidations converge the tab without polling. Each event
  // refetches its own face only while the tab is mounted; unobserved events
  // just mark the cached snapshot stale. A new connection generation forces a
  // full reload — the cached snapshots belong to the previous Host process.
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('plugin-inventory/changed', () => { controller.invalidateInventory() }),
      ctx.remote.$on('plugin-manager/catalog-changed', () => { controller.invalidateCatalog() }),
      ctx.on('connection/reset', () => { controller.load() }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-plugin-inventory: pushed invalidations')

  const injected = (): PluginInventorySettingsTabInjected => ({ controller })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))
}
