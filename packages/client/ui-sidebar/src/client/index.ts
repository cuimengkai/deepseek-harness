/** Registers the sidebar shell into the layout-owned slot. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ctx.router.
import type {} from '@deepseek-ai/dsh-client-ui-router/client'
// Type-only: pulls the layout-owned `page` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the Session Controller service merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import { SidebarRoot } from './SidebarRoot.tsx'
import { AutomationPage } from './AutomationPage.tsx'
import type { AutomationPageInjected } from './AutomationPage.tsx'
import { ConnectorsPage } from './ConnectorsPage.tsx'
import type { ConnectorsPageInjected } from './ConnectorsPage.tsx'
import { en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'
export type { SidebarNavActions, SidebarNavId } from './SidebarNav.tsx'
export { activeNav } from './SidebarNav.tsx'
export type { AutomationPageInjected, AutomationPageProps } from './AutomationPage.tsx'
export type { ConnectorsPageInjected, ConnectorsPageProps } from './ConnectorsPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar shell controls copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin (shell controls copy). */
const NS = 'sidebar'

interface WorkspaceNavigation {
  startSession(workspaceId?: WorkspaceId): void
}

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'uiWorkspace', 'locale', 'router', 'remote']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar: dictionaries')

  const injectProps = (): SidebarRootInjected => ({
    // The shell's New Task button rides the Workspace UI's shared action
    // (current Session Workspace, then recent Workspace).
    startSession: (workspaceId) => { workspaceNavigation.startSession(workspaceId) },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
    getPathname: () => ctx.router.getSnapshot().pathname,
    subscribePathname: listener => ctx.router.subscribe(listener),
    navigate: (path) => { ctx.router.navigate(path) },
  })
  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      // The shell owns geometry; ui-workspace registers the whole browsing
      // region (header, search, session list, workspace dialogs), ui-settings
      // registers the foot trigger + settings panel.
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      inject: injectProps,
    }, SidebarRoot),
    'ui-sidebar: slot registration',
  )

  const remotes = ctx.remote as unknown as {
    connectors?: ConnectorsPageInjected
    automation?: {
      list: AutomationPageInjected['listRules']
      create: AutomationPageInjected['createRule']
      setEnabled: AutomationPageInjected['setRuleEnabled']
      remove: AutomationPageInjected['removeRule']
    }
  }

  const missing = (name: string) => (): never => {
    throw new Error(`${name} remote is not mounted`)
  }

  const automationInjected = (): AutomationPageInjected => ({
    goAssistant: () => { ctx.router.navigate('/') },
    goAgentSettings: () => { ctx.router.navigate('/settings/agent') },
    goOrchestration: () => { ctx.router.navigate('/settings/agent?tab=modes') },
    listRules: remotes.automation?.list ?? missing('automation'),
    createRule: remotes.automation?.create ?? missing('automation'),
    setRuleEnabled: remotes.automation?.setEnabled ?? missing('automation'),
    removeRule: remotes.automation?.remove ?? missing('automation'),
  })

  const connectorsInjected = (): ConnectorsPageInjected => ({
    goAssistant: () => { ctx.router.navigate('/') },
    list: remotes.connectors?.list ?? missing('connectors'),
    addHttp: remotes.connectors?.addHttp ?? missing('connectors'),
    setEnabled: remotes.connectors?.setEnabled ?? missing('connectors'),
    remove: remotes.connectors?.remove ?? missing('connectors'),
  })

  // Operable WorkBuddy destination on the layout `page` slot. Projects
  // registers from ui-workspace (it needs `useWorkspaces`); declaration
  // order is not guaranteed relative to layout's `page` child; inject waits
  // for the ledger entry the same way settings does.
  ctx.slots.inject('page', () => ctx.slots.register({
    name: 'page',
    id: 'automation',
    order: 11,
    path: '/automation',
    locale: NS,
    inject: automationInjected,
  }, AutomationPage))

  ctx.slots.inject('page', () => ctx.slots.register({
    name: 'page',
    id: 'connectors',
    order: 12,
    path: '/connectors',
    locale: NS,
    inject: connectorsInjected,
  }, ConnectorsPage))
}
