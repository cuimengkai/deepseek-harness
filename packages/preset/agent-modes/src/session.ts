/**
 * The session-log record of which product mode a session was created under.
 *
 * The creation header names the mode a session STARTED with. A blank session
 * may still change mode (and therefore its bound preset) while blank; the
 * change is logged so resume rebuilds the same composition.
 * @module @deepseek-ai/dsh-agent-modes/session
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's agent mode was chosen after creation, while the session
     * was still blank. Log-only: it records the mode later turns ran under.
     */
    'agent-mode/selected': { agentMode: string }
  }
}

const agentModeSchema = z.union([z.string(), z.null()])

/** Current Session mode, initialized from its header and advanced by selection events. */
export const agentModeProjectionDefinition = {
  key: 'agentMode',
  stateSchema: agentModeSchema,
  init: header => header.agentMode ?? null,
  apply: (state, event) => event.type === 'agent-mode/selected'
    ? event.data.agentMode
    : state,
  wire: { viewSchema: agentModeSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'agentMode', string | null>

/** The minimum a caller must supply to resolve a session's mode. */
export interface ModeBearingSession {
  /** The session's creation header. */
  readonly header: SessionHeader
  /** The session's event log, oldest first. */
  readonly events: readonly SessionEvent[]
}

/**
 * The mode a session actually runs, newest selection winning.
 * @param session - the session's header and event log.
 * @returns the mode id, or `undefined` when the session names none.
 */
export function resolveSessionMode(session: ModeBearingSession): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'agent-mode/selected') return event.data.agentMode
  }
  return session.header.agentMode
}
