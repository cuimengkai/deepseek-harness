/**
 * engine-isolation-demo host plugin: registers the platform-shell model-facing
 * tools with a session→platform-user binding, exactly like the sibling
 * platform-shell-demo. The platform-shell service itself is mounted by the
 * composition row `id: platform-shell`; this plugin adds only the consumer (the
 * tools every agent sees) and the actor binding the demo driver and the process
 * worker populate before each agent runs. The same module loads in the parent
 * and in the child worker (both boot the same cordis.yml), so each process
 * binds its own session ids to its own store's users.
 * @module engine-isolation-demo
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  PlatformShellError,
  registerPlatformShellTools,
  type ResolveActor,
  type UserId,
} from '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts'

export const name = 'engine-isolation-demo'
export const inject = ['tools', 'platformShell']

/** The demo's session→platform-user binding, populated by the drive side. */
const actors = new Map<string, UserId>()

/**
 * Bind one agent session id to the platform user acting through it.
 * @param sessionId - the agent-loop session id, e.g. `engine-shared`.
 * @param userId - the platform user the session acts as.
 */
export function bindActor(sessionId: string, userId: UserId): void {
  actors.set(sessionId, userId)
}

/** Resolve the acting platform user for one session; unknown sessions fail loud. */
const resolveActor: ResolveActor = (session: Session) => {
  const user = actors.get(String(session.id))
  if (user === undefined) {
    throw new PlatformShellError('UNKNOWN_ACTOR', `no platform user bound to session ${session.id}`)
  }
  return user
}

export const apply = (ctx: Context): void => {
  registerPlatformShellTools(ctx, { resolveActor })
}
