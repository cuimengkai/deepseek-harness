/**
 * Flow-editor surface plugin, browser half: one `conversation.view` entry
 * ("Flow") after trajectory, showing the session's flow graph canvas. The
 * canvas is general-purpose — it is not gated to any agent preset — so a
 * session with the flow engine composed in can author and run branching
 * multi-agent workflows; without the engine the host answers
 * `flow-unavailable` and the tab renders a read-only notice.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the connection's Context merge (ctx.connection) into this program.
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the sessions service's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { FlowEditorController } from './flow-store.ts'
import { en, NS, zh } from './locales.ts'
import { FlowEditorView, type FlowEditorViewInjected } from './FlowEditorView.tsx'
import { FlowCanvas, type FlowCanvasSurface } from './FlowCanvas.tsx'

// The shared canvas is exported for sibling editors (the agent-preset composer
// drives the same gestures over its graph-backed composition rows).
export { FlowCanvas, type FlowCanvasSurface }

/** Required services: the conversation slot, the locale service, the wire face, and the sessions feed. */
export const inject = ['slots', 'locale', 'connection', 'sessions']

/**
 * Mount the flow-editor view tab. Controllers live per session so an active
 * run keeps polling while its tab stays mounted; plugin unload disposes every
 * controller (each run's poll already stops when the snapshot settles).
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-flow-editor: dictionaries')
  const t = ctx.locale.bind(NS)
  const controllers = new Map<SessionId, FlowEditorController>()
  const controllerFor = (sessionId: SessionId): FlowEditorController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      const { api } = ctx.get('connection') as ConnectionHandle
      controller = new FlowEditorController(api, sessionId, () => {
        // The workspace root is read reactively at call time from the sessions
        // feed, so a workspace switch on the session reloads the canvas.
        return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      })
      controllers.set(sessionId, controller)
    }
    return controller
  }
  ctx.effect(() => () => {
    for (const controller of controllers.values()) controller.dispose()
  }, 'ui-flow-editor: dispose per-session controllers')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'flow-editor',
    // After trajectory (10) and before the develop-mode insight tabs (20+).
    order: 15,
    locale: NS,
    label: () => t('view.flowEditor'),
    inject: (sessionId: SessionId): FlowEditorViewInjected => ({
      controller: controllerFor(sessionId),
    }),
  }, FlowEditorView))
}
