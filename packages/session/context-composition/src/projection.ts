/**
 * The `contextRevision` projection unit: the count of committed events in the
 * session's durable log. The browser context view re-reads the composition
 * snapshot when it moves, so one number — not any content fold — is the whole
 * state; the unit exists to put a durable-log revision on the client-visible
 * change feed.
 *
 * @module @deepseek-ai/dsh-context-composition/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** The committed-event count; seq is the event's 0-based log index. */
export const contextRevisionProjection = {
  key: 'contextRevision',
  stateSchema: z.number().int().nonnegative(),
  stateVersion: 0,
  init: () => 0,
  apply: (_state: number, event: { readonly seq: number }) => event.seq + 1,
  wire: {
    viewSchema: z.number().int().nonnegative(),
    view: (state: number) => state,
  },
} satisfies ProjectionDefinition<'contextRevision'>
