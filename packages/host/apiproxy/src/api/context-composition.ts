/**
 * context-composition domain contract: the read-only projection of one
 * session's current model-visible context that the browser context view
 * renders.
 *
 * `read` is privileged (see PRIVILEGED_METHODS in dsh-client-connection):
 * the envelope row carries the session's system prompt text verbatim, which
 * is conversation reconnaissance the same way `session.history` is. The
 * request addresses a session id the Host owns; the wire never carries a Host
 * path.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// The pure-types subpath (no runtime imports): the browser-safe channel for
// the wire vocabulary, the same pattern the session-projection types use.
import type { ContextComposition } from '@deepseek-ai/dsh-context-composition/types'

/** context-composition-domain unary methods (the map key contextComposition.* of RpcMethodMap). */
export interface ContextCompositionApi {
  /**
   * Read one session's current context composition at its durable tail.
   *
   * Resolves the live session by id (a detached session is not addressable
   * here — the view is a live tab reading the session it renders). Returns
   * the envelope figures (system prompt, tool catalog), the priced surface
   * rows, the newest recorded route capacity, and the compaction history, all
   * at one log revision. A session with no requests yet returns an envelope
   * of `null` and an empty surface.
   */
  read(request: RpcRequest<{ sessionId: SessionId }>, signal: AbortSignal):
  Promise<RpcResponse<ContextComposition>>
}
