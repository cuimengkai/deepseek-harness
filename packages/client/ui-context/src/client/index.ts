/**
 * Browser context view plugin: one conversation view tab that renders the
 * session's current model-visible context composition through the
 * contextComposition.read RPC. A shift-click range over surface rows feeds
 * /compact <start>:<end> through the commands Remote.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ContextCompositionController } from './context-store.ts'
import { en, NS, zh } from './locales.ts'
import { ContextView, type ContextViewInjected } from './ContextView.tsx'

/** Required services: the conversation slot, the commands Remote, and the locale service. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the context view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-context: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'context',
    order: 15,
    locale: NS,
    label: () => t('view.context'),
    inject: (sessionId: SessionId): ContextViewInjected => {
      // One controller per (tab x session) occurrence — the renderer caches
      // this face per (entry x session), so the closure stays identity-stable
      // and the component's unmount dispose stops the read cycle cleanly.
      const controller = new ContextCompositionController(api, sessionId)
      return {
        hooks: { contextComposition: controller.store },
        load: () => { controller.load() },
        dispose: () => { controller.dispose() },
        // Failure strings stay English (error-surface policy: not localized).
        compactRange: async (start, end) => {
          const result = await ctx.remote.commands.execute(sessionId, `/compact ${start}:${end}`, [])
          if (!result.ok) return `${result.error.message} (${result.error.code})`
          const execution = result.value
          if (execution === undefined) return 'unknown command: /compact'
          return execution.result.kind === 'error' ? execution.result.text : null
        },
      }
    },
  }, ContextView))
}
