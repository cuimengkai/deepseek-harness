/**
 * Settings shell and ownerless-copy plugin, browser half: renders the
 * `sidebar.settings` trigger — chrome row + onboarding stage — and the routed
 * settings page (a `page` slot entry at `/settings/:section?`, covering the
 * app while its path is active), and registers everything on the Settings
 * surface that belongs to no single feature: the trigger/header chrome
 * content, local-document action, General section, and `settings`
 * dictionaries. Feature-owned rows and sections stay with their features.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context
// merge. Cross-plugin collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'page' entry the settings
// page registers into) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ctx.router (the RouterService Context merge) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-router/client'
import type {
  SettingsOnboardingStep, SettingsPageInjected, SettingsSectionRow, SettingsTriggerInjected,
} from './shell-contract.ts'
import { SettingsTrigger } from './SettingsTrigger.tsx'
import { SettingsPage } from './SettingsPage.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from './chrome.tsx'
import { GeneralSection } from './GeneralSection.tsx'
import { SettingsDocumentAction } from './SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from './SettingsDocumentAction.tsx'
import { SettingsDocumentStore } from './settings-document-store.ts'
import { en, zh, type SettingsKey } from './locales.ts'

export type {
  CloseLabelProps, HeaderContentProps, TriggerContentProps,
} from './chrome.tsx'
export type {
  GeneralSectionComponentProps,
} from './GeneralSection.tsx'
export type { SettingsDocumentActionInjected, SettingsDocumentActionProps } from './SettingsDocumentAction.tsx'
export type { SettingsDocumentState } from './settings-document-store.ts'
export { SettingsDocumentStore } from './settings-document-store.ts'
export type { SettingsKey } from './locales.ts'
export type {
  SettingsPageComponentProps, SettingsPageInjected, SettingsSectionRow,
  SettingsTriggerComponentProps, SettingsTriggerInjected,
} from './shell-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell chrome + shell-owned General section copy. */
    settings: SettingsKey
  }
}

/** Dictionary namespace owned by this plugin (shell chrome + General copy). */
const NS = 'settings'

/** The settings page route pattern — the `page` entry's `path` option and the
 * section/route projections all share this single pattern. */
const SETTINGS_PATH = '/settings/:section?'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registrations depend on their slots through `slots.inject()`.
 * The router is the page-route engine: the trigger navigates to `/settings`,
 * and the page reads its section id from the URL parameter.
 */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'router']

/**
 * Register the `settings` dictionaries, the chrome content, the General
 * section, the settings trigger, and the routed settings page, each once its
 * slot declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-general: dictionaries')

  // Copy freshness is framework-owned: components read the standard `t`
  // seat, and the nav label is a thunk the owner resolves per render — no
  // locale/change re-registration wiring.
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  // The action follows the shared describe mirror, whose owning plugin
  // already refreshes it on document commits and reconnects.
  const documentController = connection.isLoopback
    ? new SettingsDocumentStore(connection.api, ctx.settingsScope.describe())
    : undefined
  const documentInjected = documentController === undefined
    ? undefined
    : (): SettingsDocumentActionInjected => ({
      controller: documentController,
      hooks: { snapshot: documentController.store },
    })
  ctx.effect(() => () => { documentController?.dispose() }, 'ui-settings-general: document action directory')

  // Ledger → nav-row projection, shared by the page's sections observable and
  // its sectionId fallback (uSES contract: getSnapshot returns the cached rows
  // until the ledger version or locale revision moves). Labels may be
  // locale-following thunks, so the cache key includes the locale revision and
  // subscribers ride both sources.
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: readonly SettingsSectionRow[] = []
  const projectRows = (): readonly SettingsSectionRow[] => {
    const version = ctx.slots.getVersion('settings.section')
    const revision = ctx.locale.getSnapshot().revision
    if (version !== rowsVersion || revision !== rowsRevision) {
      rowsVersion = version
      rowsRevision = revision
      rows = ctx.slots.entries('settings.section')
        .map(e => ({
          /* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
          id: e.options.id ?? '',
          order: e.options.order ?? 0,
          label: resolveSlotLabel(e.options.label) ?? '',
        }))
        .sort((a, b) => a.order - b.order)
    }
    return rows
  }

  // Whether the current URL is on the settings route. The trigger suppresses
  // onboarding overlays while the covering page is active, and openSettings
  // skips the navigation when it already is.
  let routeVersion = -1
  let routeOnSettings = false
  const isOnSettingsRoute = (): boolean => {
    const version = ctx.router.getVersion()
    if (version !== routeVersion) {
      routeVersion = version
      routeOnSettings = ctx.router.matchParams(SETTINGS_PATH, ctx.router.getSnapshot().pathname) !== undefined
    }
    return routeOnSettings
  }

  let onboardingVersion = -1
  let onboardingSteps: readonly SettingsOnboardingStep[] = []

  const triggerInjected = (): SettingsTriggerInjected => ({
    hooks: {
      onboardingSteps: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.onboarding')
          if (version !== onboardingVersion) {
            onboardingVersion = version
            onboardingSteps = ctx.slots.entries('settings.onboarding')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
              }))
              .sort((a, b) => a.order - b.order)
          }
          return onboardingSteps
        },
        subscribe: listener => ctx.slots.subscribe('settings.onboarding', listener),
      },
      settingsRoute: {
        getSnapshot: isOnSettingsRoute,
        subscribe: listener => ctx.router.subscribe(listener),
      },
    },
    openSettings: () => {
      if (!isOnSettingsRoute()) ctx.router.navigate('/settings')
    },
    openSection: (id) => { ctx.router.navigate(`/settings/${id}`) },
  })

  // The page's active section: the URL's section parameter validated against
  // the ledger, falling back to the first row — a section can unmount under an
  // active deep link, and a bare `/settings` lands on the first section.
  let sectionVersion = -1
  let sectionLedgerVersion = -1
  let activeSection: string | undefined
  const sectionId: HostObservable<string | undefined> = {
    getSnapshot: () => {
      const version = ctx.router.getVersion()
      const ledger = ctx.slots.getVersion('settings.section')
      if (version !== sectionVersion || ledger !== sectionLedgerVersion) {
        sectionVersion = version
        sectionLedgerVersion = ledger
        const requested = ctx.router.matchParams(SETTINGS_PATH, ctx.router.getSnapshot().pathname)?.section
        const projected = projectRows()
        activeSection = projected.some(row => row.id === requested) ? requested : projected[0]?.id
      }
      return activeSection
    },
    subscribe: (listener) => {
      const offRouter = ctx.router.subscribe(listener)
      const offLedger = ctx.slots.subscribe('settings.section', listener)
      return () => { offRouter(); offLedger() }
    },
  }

  const pageInjected = (): SettingsPageInjected => ({
    hooks: {
      sections: {
        getSnapshot: projectRows,
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.section', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => { offLedger(); offLocale() }
        },
      },
      sectionId,
    },
    // Close is the "leave settings for good" affordance: the X control, Escape,
    // and every section's `close` owner prop (session-starting flows like
    // agent-preset 创造模式) all need the page fully gone, so it lands on the
    // root no matter how deep the section stack is. The back button is the
    // step-wise affordance: it history-backs through sections, with the root
    // fallback covering a fresh tab that opened straight on the settings route.
    close: () => { ctx.router.navigate('/') },
    back: () => {
      if (window.history.length > 1) ctx.router.back()
      else ctx.router.navigate('/')
    },
    openSection: (id) => { ctx.router.navigate(`/settings/${id}`) },
  })

  // Two occupants, mutually exclusive declared slot sets: the sidebar trigger
  // (navigation + onboarding) and the routed page (chrome + sections). The
  // page registration carries `path`, making it a routable page entry the
  // shell matches against the URL.
  ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
    name: 'sidebar.settings',
    children: {
      'settings.trigger': { kind: 'single', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
    inject: triggerInjected,
  }, SettingsTrigger))

  ctx.slots.inject('page', () => ctx.slots.register({
    name: 'page',
    id: 'settings',
    order: 0,
    path: SETTINGS_PATH,
    locale: NS,
    children: {
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
    inject: pageInjected,
  }, SettingsPage))

  ctx.slots.inject('settings.trigger', () =>
    ctx.slots.register({ name: 'settings.trigger', locale: NS }, TriggerContent))
  ctx.slots.inject('settings.header', () =>
    ctx.slots.register({ name: 'settings.header', locale: NS }, HeaderContent))
  if (documentInjected !== undefined) {
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action',
      id: 'open-document',
      order: 0,
      locale: NS,
      inject: documentInjected,
    }, SettingsDocumentAction))
  }
  ctx.slots.inject('settings.close', () =>
    ctx.slots.register({ name: 'settings.close', locale: NS }, CloseLabel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 0,
    label: () => t('general.nav'),
    locale: NS,
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  }, GeneralSection))
}
