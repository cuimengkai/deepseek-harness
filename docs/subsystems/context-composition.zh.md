# 上下文组合

[English](context-composition.md) | 中文

`@deepseek-ai/dsh-context-composition` 从持久日志投影一个会话当前模型可见的上下文：请求信封（提供方路由、渲染后的系统提示词、工具目录）、计价的表面行、路由容量与压缩历史——全部脱离于一个 `logRevision` 快照。Web 上下文视图渲染该快照；其中任何内容都不会改动会话。

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

会话是调用方的稳定前缀：附加的活跃会话在读取时快照其事件数组，因此一次 `read` 精确描述一个日志修订。替换节点（压缩摘要）可能携带比其后表面行更高的持久 seq——表面顺序是位置序而非 seq 序。`contextWindow` 是适配方广播的最新容量；容量条的填充比例由它推导，绝不来自硬编码的模型表。

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

信封折叠最新的 `request/header` 事件；`toolsTokens` 是目录的精确总量，而每个 `ContextToolRow.tokens` 仅为参考值。计价启发式与表面行共享，见 [token-meter.zh.md](token-meter.zh.md)。

## `ContextSurfaceRow` 与 `ContextCompactionEntry`

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

压缩条目是溯源信息而非表面行：`shadowedCount`/`shadowedTokens` 描述替换所覆盖的节点，产生它们的事务归 [压缩 seam](compaction.zh.md) 所有。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Session](session.zh.md)

Source: [`packages/session/context-composition/src/index.ts`](../../packages/session/context-composition/src/index.ts)
<!-- END GENERATED cordis-surface -->
