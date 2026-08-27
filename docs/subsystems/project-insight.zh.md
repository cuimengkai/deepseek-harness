# 项目洞察

[English](project-insight.md) | 中文

`@deepseek-ai/dsh-project-insight` 将会话的工作区扫描为 `.dsh/insight/` 下的一份确定性指纹文档，使洞察视图无需重新读取目录树即可展示项目结构。该服务运行在宿主平面上，带有会话生命周期的自动扫描挂接与显式的 read/scan 调用；文档、stat 签名与摘要的形状属于所在包（[fingerprint](../../packages/insight/project-insight/src/fingerprint.ts)、[scanner](../../packages/insight/project-insight/src/scanner.ts)）。

自动扫描仅在配置的预设（默认 `['develop']`）内生效，且要求会话带有工作目录。扫描按根目录防抖、按根目录单飞；根目录正在扫描时到达的会话加入等待集合，并在提交点被通知。新鲜文档——stat 签名相同——不会被重写，也不产生事件。

## `ProjectInsightReadResult`

```ts type-equiv
/** The result of {@link ProjectInsight.read}. */
interface ProjectInsightReadResult {
  readonly status: ProjectInsightReadStatus
  /** Project root basename — identity only, never a host path. */
  readonly root: string
  /** The stored document, when one exists and parses. */
  readonly doc?: ProjectInsightDoc
  /** Human-readable failure text when `status` is `'error'`. */
  readonly error?: string
}
```

`read` 除已存文档外不触碰文件系统：`none` 表示文档不存在，`fresh` 与 `stale` 以已存 stat 签名对比实时目录树，`error` 携带失败文本。`root` 是用于展示身份的 basename——宿主路径绝不跨越该 seam。

## `ProjectInsightScanResult`

```ts type-equiv
/** The result of {@link ProjectInsight.scan}. */
interface ProjectInsightScanResult {
  readonly status: ProjectInsightScanStatus
  /** Project root basename — identity only, never a host path. */
  readonly root: string
  /** Document path relative to the project root, as the model sees it. */
  readonly path: string
  /** The compact summary when a scan ran; absent for `unchanged`/`error`. */
  readonly summary?: ScanSummary
  /** Human-readable failure text when `status` is `'error'`. */
  readonly error?: string
}
```

成功的扫描原子地写入文档并随后发出 `project-insight/updated`——监听方将该事件视为文档可读的证明。`unchanged` 表示 stat 签名匹配，因此未写入任何内容、未触发事件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprojectinsight--projectinsight"></a>

### `ctx.projectInsight` — `ProjectInsight`

Per-session workspace scanner. Auto-scan is debounced per root and single-flight per root; a session arriving while its root is being scanned joins the waiting set and is notified at the commit point.

```ts cordis-catalog
/**
 * Read the stored document for a working directory, without scanning.
 *
 * Resolves the project root upward from `cwd`, reads the committed `.dsh/insight/`
 * document, and reports fresh/stale by recomputing the stat-only structural
 * signature. An over-cap, unparsable, or missing-section document is a `'error'`
 * result, not an absent one. A document under an older `formatVersion` is the
 * one recoverable case: it reads `'stale'` and schedules a debounced background
 * rebuild, so a format bump self-heals an existing project's committed doc
 * instead of stranding it in an error state.
 * @param cwd - absolute working directory to resolve the project root from.
 * @param signal - aborts the stat walk.
 * @returns the document state and, when present, the parsed document.
 */
async read(cwd: string, signal?: AbortSignal): Promise<ProjectInsightReadResult>

/**
 * Scan a working directory's project now and commit the document.
 *
 * A fresh stored document is left untouched (`'unchanged'`); otherwise the
 * deterministic scanner rebuilds it, the document is written atomically, and
 * — only after the write commits — `project-insight/updated` is emitted for
 * the caller's session. A stored document that cannot be read (wrong version,
 * over-cap, missing section, unparsable) is treated as absent, so a scan is
 * the operation that repairs it.
 * @param cwd - absolute working directory to resolve the project root from.
 * @param sessionId - session to notify at the commit point; absent skips the event.
 * @param signal - aborts the scan.
 * @returns the scan outcome.
 */
async scan(cwd: string, sessionId?: SessionId, signal?: AbortSignal): Promise<ProjectInsightScanResult>
```

Types: [SessionId](core.zh.md)

Source: [`packages/insight/project-insight/src/service.ts`](../../packages/insight/project-insight/src/service.ts)

<a id="project-insight-events"></a>

### `project-insight/*` events

<a id="project-insightupdated--emit"></a>

#### `project-insight/updated` — emit

A project-insight scan for one session's workspace committed to disk. Emitted only after the atomic write succeeds, so listeners treat the event as proof the `.dsh/insight/` document is readable.

```ts cordis-catalog
/**
 * A project-insight scan for one session's workspace committed to disk.
 * Emitted only after the atomic write succeeds, so listeners treat the
 * event as proof the `.dsh/insight/` document is readable.
 * @param sessionId - the session whose workspace was scanned.
 * @mode emit
 */
'project-insight/updated'(sessionId: SessionId): void
```

Types: [SessionId](core.zh.md)

Source: [`packages/insight/project-insight/src/types.ts`](../../packages/insight/project-insight/src/types.ts)
<!-- END GENERATED cordis-surface -->
