/**
 * Browser project-insight plugin: five develop-mode conversation view tabs that
 * render the session project's committed project-insight document. Each
 * tab is a plain 'conversation.view' list entry gated to the `develop` agent
 * preset through the per-session `modes` filter, so the ring shows them only
 * while a session runs the develop preset — and hides them the moment it does
 * not. The committed document's prompts section renders inside the agent-tech
 * tab's embedded prompts collection, so it owns no dedicated tab.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { InsightTab, type InsightSectionKey, type InsightTabInjected } from './InsightTab.tsx'
import { ProjectInsightController } from './insight-store.ts'
import { en, NS, zh, type ProjectInsightKey } from './locales.ts'

/** The five tabs, in ring order (after trajectory at 10). */
const TABS: readonly {
  id: string
  order: number
  labelKey: ProjectInsightKey
  variant: InsightSectionKey
}[] = [
  { id: 'develop-modules', order: 20, labelKey: 'view.modules', variant: 'moduleTopology' },
  { id: 'develop-components-dep', order: 30, labelKey: 'view.componentDeps', variant: 'componentDependencies' },
  { id: 'develop-tech', order: 40, labelKey: 'view.techStack', variant: 'techStack' },
  { id: 'develop-components', order: 50, labelKey: 'view.components', variant: 'components' },
  { id: 'develop-agent-tech', order: 60, labelKey: 'view.agentTech', variant: 'agentTech' },
]

/** Required services: the conversation slot, session rows, the Remote face, and the locale service. */
export const inject = ['slots', 'locale', 'remote', 'remote.projectInsight', 'sessions']

/**
 * Client plugin body: register the five insight tabs. Each registration rides
 * the slot service's effect wrapper, so plugin unload removes every tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.sessions
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-project-insight: dictionaries')
  // Registration-time text (the tab labels) reads through the bound translate
  // as a thunk, so it follows the active locale without re-registration.
  const t = ctx.locale.bind(NS)
  for (const tab of TABS) {
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: tab.id,
      order: tab.order,
      locale: NS,
      // Develop-mode-only: the ring's per-session modes filter shows these
      // tabs only while the session's resolved agent preset is `develop`.
      modes: ['develop'],
      label: () => t(tab.labelKey),
      inject: (sessionId: SessionId): InsightTabInjected => {
        // One controller per (tab x session) occurrence — the renderer caches
        // this face per (entry x session), so the closures stay identity-stable
        // and the component's unmount dispose stops the read/poll cycle cleanly.
        const controller = new ProjectInsightController(
          ctx.remote,
          () => sessions.list.getSnapshot().byId[sessionId]?.cwd,
        )
        return {
          hooks: { projectInsight: controller.store },
          load: () => { controller.load() },
          dispose: () => { controller.dispose() },
          variant: tab.variant,
        }
      },
    }, InsightTab))
  }
}
