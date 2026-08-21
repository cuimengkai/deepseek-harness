/**
 * platform-shell-demo host plugin: registers the platform-shell model-facing
 * tools with a session→platform-user binding. The service itself is mounted by
 * the composition row `id: platform-shell` (a file-backed SQLite control-plane
 * store); this plugin adds only the consumer (the tools every role agent sees)
 * and the actor binding the demo driver populates before each agent runs.
 * @module platform-shell-demo
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  PlatformShellError,
  registerPlatformShellTools,
  type ResolveActor,
  type UserId,
} from '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts'

export const name = 'platform-shell-demo'
export const inject = ['tools', 'platformShell']

/** The demo's session→platform-user binding, populated by the demo driver. */
const actors = new Map<string, UserId>()

/**
 * Bind one agent session id to the platform user acting through it.
 * @param sessionId - the agent-loop session id, e.g. `platform-alice`.
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
