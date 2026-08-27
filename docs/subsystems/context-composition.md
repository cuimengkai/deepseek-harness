# Context Composition

English | [中文](context-composition.zh.md)

`@deepseek-ai/dsh-context-composition` projects one session's current model-visible context from the durable log: the request envelope (provider route, rendered system prompt, tool catalog), the priced surface rows, the route capacity, and the compaction history — all detached at one `logRevision`. The web context view renders this snapshot; nothing in it mutates the session.

Source: [`packages/session/context-composition/src/types.ts`](../../packages/session/context-composition/src/types.ts)

## `ContextComposition`

```ts type-equiv
/** The read result: everything the context view renders, at one log revision. */
interface ContextComposition {
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
```

The session is the caller's stable prefix: an attached live session snapshots its events array, so one `read` describes exactly one log revision. Replacement nodes (a compaction summary) can carry a higher durable seq than the rows after them — surface order is positional, not seq order. `contextWindow` is the newest capacity the adapter advertised; the capacity bar derives its fill from it, never from a hard-coded model table.

## `ContextEnvelope`

```ts type-equiv
/** The request envelope the NEXT request compares against. */
interface ContextEnvelope {
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
```

The envelope folds the latest `request/header` event; `toolsTokens` is the exact catalog total while each `ContextToolRow.tokens` is advisory. See [token-meter.md](token-meter.md) for the pricing heuristic the surface rows share.

## `ContextSurfaceRow` and `ContextCompactionEntry`

```ts type-equiv
/** One priced row of the model-visible conversation surface. */
interface ContextSurfaceRow {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Message role (`user`/`assistant`), as the provider sees it. */
  readonly role: string
  /** Heuristic tokens of the exact message this node projects. */
  readonly tokens: number
  /** First text block's first line, or `null` when the message carries none. */
  readonly preview: string | null
}
```

```ts type-equiv
/** One completed compaction read back from the durable log. */
interface ContextCompactionEntry {
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
```

A compaction entry is provenance, not a surface row: `shadowedCount`/`shadowedTokens` describe the nodes the replacement covered, and the [compaction seam](compaction.md) owns the transactions that produce them.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcontextcomposition--contextcompositionservice"></a>

### `ctx.contextComposition` — `ContextCompositionService`

Read-only projection of the durable context composition for one session.

```ts cordis-catalog
/**
 * Read one session's current context composition at its durable tail.
 * The session is the caller's stable prefix — an attached live session
 * snapshots its events array, so the result describes one log revision.
 * @param session - the session whose log is projected.
 * @returns the detached snapshot (envelope, surface, capacity, compactions).
 */
read(session: Session): ContextComposition
```

Types: [Session](session.md)

Source: [`packages/session/context-composition/src/index.ts`](../../packages/session/context-composition/src/index.ts)
<!-- END GENERATED cordis-surface -->
