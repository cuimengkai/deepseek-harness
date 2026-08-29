/** Session-addressed context-composition Remote. */

import type {} from '@deepseek-ai/dsh-session/context'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.contextComposition` Context member the read uses.
import type {} from '@deepseek-ai/dsh-context-composition'
import type { ContextComposition } from '@deepseek-ai/dsh-context-composition/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ContextCompositionReadRequest } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `contextComposition` Remote namespace. */
    sessionContextComposition: SessionContextComposition
  }
}

/** Host Remote adapter over the composed context-composition service. */
export class SessionContextComposition extends TypertRemoteService {
  static inject = ['sessions', 'typert']

  /** @param ctx - Host context carrying the live Session store. */
  constructor(ctx: Context) {
    super(ctx, 'sessionContextComposition', { namespace: 'contextComposition' })
  }

  /**
   * Read one live session's current context composition at its durable tail.
   * The envelope row carries the session's system prompt text verbatim, so the
   * read is conversation reconnaissance (the same posture as history reads).
   * @param request - Session identity to project.
   * @returns the detached snapshot (envelope, surface, capacity, compactions).
   * @throws TypertRemoteFailure when the service is unmounted or the Session is not live.
   */
  @Remote
  read(request: ContextCompositionReadRequest): Promise<ContextComposition> {
    const composition = this.ctx.get('contextComposition')
    if (composition === undefined) {
      return Promise.reject(failure(
        'internal',
        'context-composition service is absent: this deployment does not mount @deepseek-ai/dsh-context-composition in its composition',
      ))
    }
    // The view is a live tab reading the session it renders; a detached
    // session is not addressable here. An attached session snapshots its
    // events array inside the service, so the result describes one log
    // revision even while the session keeps appending.
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) {
      return Promise.reject(failure(
        'session-not-found',
        `session "${request.sessionId}" is not live`,
        { sessionId: request.sessionId },
      ))
    }
    return Promise.resolve(composition.read(session))
  }
}

/** Build one stable Remote failure with optional typed details. */
function failure(
  code: 'session-not-found' | 'internal',
  message: string,
  details: { readonly sessionId: SessionId } | Record<never, never> = {},
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

export default SessionContextComposition
