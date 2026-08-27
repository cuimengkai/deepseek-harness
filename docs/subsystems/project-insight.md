# Project Insight

English | [中文](project-insight.zh.md)

`@deepseek-ai/dsh-project-insight` scans a session's workspace into a deterministic fingerprint document under `.dsh/insight/`, so the insight view can present project structure without re-reading the tree. The service runs on the host plane with a session-lifecycle auto-scan hook and explicit read/scan calls; the document, stat signature, and summary shapes live in the package ([fingerprint](../../packages/insight/project-insight/src/fingerprint.ts), [scanner](../../packages/insight/project-insight/src/scanner.ts)).

Auto-scan is inert outside the configured presets (default `['develop']`) and requires a session working directory. A scan is debounced per root and single-flight per root; sessions arriving while their root is being scanned join the waiting set and are notified at the commit point. A fresh document — same stat signature — is never rewritten and emits no event.

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

`read` never touches the filesystem beyond the stored document: `none` means no document exists, `fresh` and `stale` compare the stored stat signature against the live tree, and `error` carries the failure text. `root` is a basename for display identity — host paths never cross this seam.

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

A successful scan writes the document atomically and then emits `project-insight/updated` — listeners treat the event as proof the document is readable. `unchanged` means the stat signature matched, so nothing was written and no event fired.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.md)

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

Types: [SessionId](core.md)

Source: [`packages/insight/project-insight/src/types.ts`](../../packages/insight/project-insight/src/types.ts)
<!-- END GENERATED cordis-surface -->
