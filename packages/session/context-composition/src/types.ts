/**
 * Pure client-safe context-composition vocabulary: the read result of one
 * session's current model-visible context — the request envelope parts, the
 * priced surface rows, the route capacity, and the compaction history. The
 * browser tab and the wire schema restate these shapes, so the module has no
 * runtime imports by design.
 *
 * @module @deepseek-ai/dsh-context-composition/types
 */

/** One tool-schema row of the envelope's tool catalog. */
export interface ContextToolRow {
  /** Tool name as the model sees it. */
  readonly name: string
  /** Advisory heuristic tokens of this tool's schema (the catalog total is the exact figure). */
  readonly tokens: number
}

/** The request envelope the NEXT request compares against. */
export interface ContextEnvelope {
  /** Provider route of the latest logged request header. */
  readonly provider: string
  /** Model id of the latest logged request header. */
  readonly model: string
  /** Rendered system prompt text, or `null` before any request ran. */
  readonly system: string | null
  /** Heuristic tokens of the system prompt; 0 when absent. */
  readonly systemTokens: number
  /** Tool schemas in request order; empty for a tool-less request. */
  readonly tools: readonly ContextToolRow[]
  /** Heuristic tokens of the whole tool catalog; 0 when absent. */
  readonly toolsTokens: number
}

/** One priced row of the model-visible conversation surface. */
export interface ContextSurfaceRow {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Message role (`user`/`assistant`), as the provider sees it. */
  readonly role: string
  /** Heuristic tokens of the exact message this node projects. */
  readonly tokens: number
  /** First text block's first line, or `null` when the message carries none. */
  readonly preview: string | null
}

/** One completed compaction read back from the durable log. */
export interface ContextCompactionEntry {
  /** Durable seq of the `compaction/summary` event. */
  readonly summarySeq: number
  /** The model that wrote the summary. */
  readonly model: string
  /** Provider route that wrote the summary. */
  readonly provider: string
  /** Summary text, or `null` when the summary carried no text block. */
  readonly summary: string | null
  /** Number of surface nodes shadowed by the replacement. */
  readonly shadowedCount: number
  /** Estimated tokens of the shadowed content. */
  readonly shadowedTokens: number
}

/** The read result: everything the context view renders, at one log revision. */
export interface ContextComposition {
  /** Durable events consumed for this snapshot (the next unread event seq). */
  readonly logRevision: number
  /** Request envelope figures, or `null` before any request ran. */
  readonly envelope: ContextEnvelope | null
  /** Priced surface rows in positional head-to-tail order. */
  readonly surface: readonly ContextSurfaceRow[]
  /** Total heuristic tokens across the surface rows. */
  readonly surfaceTokens: number
  /** Newest recorded route capacity, or `null` when no adapter advertised one. */
  readonly contextWindow: number | null
  /** Compaction history in log order. */
  readonly compactions: readonly ContextCompactionEntry[]
}
