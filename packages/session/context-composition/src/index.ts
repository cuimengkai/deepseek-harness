/**
 * Host-side context-composition service (`ctx.contextComposition`): a read-only
 * projection of one session's current model-visible context — the request
 * envelope (system prompt, tool catalog), the priced conversation surface, the
 * route capacity, and the compaction history — derived from the durable log
 * through the token-meter's shared estimator. The browser context view renders
 * this snapshot; it is the same vocabulary the meter and the
 * `contextBreakdown` projection use, so the figures cannot disagree.
 *
 * @module @deepseek-ai/dsh-context-composition
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
// The shared estimator: pricing here must equal the meter's vocabulary, so
// the projection imports its functions rather than restating the heuristic.
import {
  estimateMessage, estimateSystemTokens, estimateToolsTokens,
} from '@deepseek-ai/dsh-token-meter/estimate'
// Type-only: the `compaction/*` session-event vocabulary this fold reads.
import type {} from '@deepseek-ai/dsh-compaction/types'
// Type-only: pulls the session-projection Context merge (ctx.sessionProjections).
import type {} from '@deepseek-ai/dsh-session-projection'
import { canonicalHeader, deriveEventMessage, isSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { contextRevisionProjection } from './projection.ts'
import type {
  ContextCompactionEntry, ContextComposition, ContextEnvelope,
  ContextSurfaceRow, ContextToolRow,
} from './types.ts'

export type {
  ContextCompactionEntry, ContextComposition, ContextEnvelope,
  ContextSurfaceRow, ContextToolRow,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    contextComposition: ContextCompositionService
  }
}

/** One tool-schema row's priced identity, shared by the per-tool and totals folds. */
function priceTool(name: string, schema: unknown): number {
  // Advisory per-tool split: same fixed density on the tool's own JSON. The
  // catalog total stays `estimateToolsTokens` — the meter's exact vocabulary —
  // so this row figure is a breakdown hint, not a component of the total.
  return Math.ceil(JSON.stringify({ name, schema }).length / 4) + 4
}

/** First text line of a message, or null when no text block exists. */
function previewOf(message: Message): string | null {
  for (const block of message.content) {
    if (block.type === 'text') {
      const text = block.text.trim()
      return text.length === 0 ? null : text.split('\n', 1)[0] as string
    }
  }
  return null
}

/** Text of a summary's first text block, or null. */
function summaryTextOf(blocks: readonly ContentBlock[]): string | null {
  for (const block of blocks) {
    if (block.type === 'text') return block.text
  }
  return null
}

/** Fold one log into the detached read result. Pure: no state crosses calls. */
function compositionOf(events: readonly SessionEvent[]): ContextComposition {
  const envelope = envelopeOf(events)
  const surface: ContextSurfaceRow[] = []
  let surfaceTokens = 0
  let contextWindow: number | null = null
  const compactions: ContextCompactionEntry[] = []
  // Replaying the surface fold over the prefix would need the SurfaceManager;
  // a full ordered walk of surface events rebuilds it identically for a read.
  const nodes: number[] = []
  for (const event of events) {
    switch (event.type) {
      case 'request/context':
        if (event.data.contextWindow !== undefined) contextWindow = event.data.contextWindow
        break
      case 'compaction/summary':
        compactions.push({
          summarySeq: event.seq,
          model: event.data.model,
          provider: event.data.provider,
          summary: summaryTextOf(event.data.summary),
          shadowedCount: event.data.shadowedSeqs.length,
          shadowedTokens: event.data.shadowedTokenCount,
        })
        break
      default:
        break
    }
    if (!isSurfaceEvent(event)) continue
    if (event.surfaceOp === 'append') {
      nodes.push(event.seq)
    } else {
      const start = nodes.indexOf(event.surfaceOp.start)
      const end = nodes.indexOf(event.surfaceOp.end)
      nodes.splice(start, end - start + 1, event.seq)
    }
  }
  for (const seq of nodes) {
    const event = events[seq]
    if (event === undefined) continue
    const message = deriveEventMessage(event)
    if (message === null) continue
    const tokens = estimateMessage(message)
    surface.push({ seq, role: message.role, tokens, preview: previewOf(message) })
    surfaceTokens += tokens
  }
  return {
    logRevision: events.length,
    envelope,
    surface,
    surfaceTokens,
    contextWindow,
    compactions,
  }
}

/** Fold the latest request header into the envelope row, or null before any request. */
function envelopeOf(events: readonly SessionEvent[]): ContextEnvelope | null {
  let last: SessionEvent<'request/header'> | undefined
  for (const event of events) {
    if (event.type === 'request/header') last = event
  }
  if (last === undefined) return null
  const header = canonicalHeader(last.data.header)
  const tools: ContextToolRow[] = (header.tools ?? []).map(tool => ({
    name: tool.name,
    tokens: priceTool(tool.name, tool.parameters),
  }))
  return {
    provider: header.config.provider,
    model: header.config.model,
    system: header.system ?? null,
    systemTokens: estimateSystemTokens(header),
    tools,
    toolsTokens: estimateToolsTokens(header),
  }
}

/** Read-only projection of the durable context composition for one session. */
export class ContextCompositionService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'contextComposition')
    // The revision marker rides the projection registry when it is mounted;
    // a composition without session-projection (bare service tests) simply
    // serves reads without the change feed.
    ctx.inject(['sessionProjections'], (scope) => {
      scope.effect(() => scope.sessionProjections.register(contextRevisionProjection),
        'context-composition: contextRevision projection')
    })
  }

  /**
   * Read one session's current context composition at its durable tail.
   * The session is the caller's stable prefix — an attached live session
   * snapshots its events array, so the result describes one log revision.
   * @param session - the session whose log is projected.
   * @returns the detached snapshot (envelope, surface, capacity, compactions).
   */
  read(session: Session): ContextComposition {
    return compositionOf([...session.events])
  }
}

export default ContextCompositionService
