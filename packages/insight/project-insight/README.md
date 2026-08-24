# @deepseek-ai/dsh-project-insight

English | [中文](README.zh.md)

Develop-mode project insight: a host-plane service that deterministically scans a session's workspace into a versioned `.dsh/insight/` document and exposes the document through a read/scan service surface and the model-facing `scan_project` tool. The scanner is offline and keyless — no LLM, no network, no credentials — so opening a develop-mode session over a project scans it strictly and carefully, and a second open reads the committed document without re-scanning.

The document has six sections, one per workbench insight tab: module dependency topology, component dependencies, tech stack, components, prompts, and agent-related technology. Every emitted collection is sorted by a stable key and every path is root-relative, so scanning the same bounded tree twice yields a byte-identical document. Two identities ride the document — the content fingerprint over the sorted `(relativePath, size, content)` projection, computed only at scan time, and the stat signature over the sorted `(relativePath, size, mtimeMs)` projection, which reads compare against a fresh stat to judge freshness without reading content — while `scannedAt` is runtime metadata excluded from both. On disk the document is stored per type under `<root>/.dsh/insight/`: a `meta.json` carries the versioned identity fields, and each section lives in its own typed folder as `<section>/data.json`. The agent-tech section embeds the project's built-in agent tooling as bounded markdown collections — skill `SKILL.md` files, MCP server configs (with every `env` value redacted to `<redacted>`, since they can carry secrets), and prompt files under `.agents/prompts/`, `.claude/prompts/`, or the root — each rendered as markdown on the workbench's second-level tabs.

## Auto-scan

The service listens for `session/created` and for `agent-preset/selected` on `session/event`, resolves each session's agent preset through `resolveSessionPreset` (the newest selection wins), and triggers only when the resolved preset is in `config.autoScanPresets` (default `['develop']`) and the session carries a working directory. Scans are debounced per project root (`config.scanDebounceMs`, default 1500) and single-flight; a session arriving while its root is scanning joins the waiting set instead of scheduling a second scan. The document is written atomically under `<root>/.dsh/insight/`, and `project-insight/updated` is emitted only after the write commits — the event is proof the document is readable. A fresh document (same stat signature) is never rewritten and produces no event.

## Service surface

`read(cwd)` reports `none` / `fresh` / `stale` / `error` without scanning, recomputing the stat-only structural signature (never reading file content) to answer freshness. `scan(cwd, sessionId?, signal?)` scans now, commits the document, and reports `scanned` / `unchanged` / `error`, returning the same compact summary the tool surfaces. A project never scanned reports `none`; an over-cap or unparsable document reports `error`. A document under an older `formatVersion` is the one recoverable case: it reads `stale` and schedules a debounced background rebuild, so a format bump self-heals an existing project's committed doc instead of stranding it in an error state; `scan` likewise treats an unreadable stored document as absent and rebuilds it.

## Tool

The `./tool` entry registers `scan_project` into an agent preset's tools layer. It requires the host service and fails loud at mount when the service is absent; it reads the session's working directory and fails with the structured `NO_CWD` / `NO_SESSION` codes when there is none; and it returns the compact model-visible summary — never the full document. `presentationMeta` projects `{ code, modules, components }`, making the outcome model-visible ⟺ logged.

## Model Experience

Indirectly, through the `scan_project` tool it registers: the develop persona directs calls on first entry and after significant changes, and the returned module/component summary guides file location while the full document stays off the wire.

#### KV Cache effect

The `scan_project` tool schema (empty parameters) is a stable request-prefix constant; the summary adds a short workspace-varying tail. The auto-scan hook writes no model-visible content.

## Known Limitations and Deferred Work

- **Best-effort static analysis** — imports and components are recognized by source scanning and heuristics, not by a build or type-check; a missed import does not fail the scan, and framework detection may misclassify an unusual component.
- **Root discovery walks upward** — `findProjectRoot` resolves to the nearest ancestor carrying a marker, so a sub-app inside a monorepo scans at the outer root unless it has a marker of its own.
- **Alias resolution is tsconfig `paths` only** — Vite and webpack `resolve.alias` configs are deferred; imports through those aliases resolve as external leaves.
- **The document is written into the project** — `.dsh/insight/` lives in the scanned project's own tree, and the harness does not add it to the project's `.gitignore`, so a project that commits everything tracks the cache.
- **A same-size, same-mtime content edit reads fresh until a scan** — the read path judges freshness by the stat-only signature, so a content edit that preserves both byte size and mtime (a coarse filesystem tick or a rewrite) reads fresh; the next scan recomputes the content fingerprint and records the change.
- **Scans are capped by hard limits** — the fingerprint walk stops at `MAX_FINGERPRINT_FILES` and only the first `MAX_SOURCE_FILES` sources are analyzed; the caps and per-section truncations are constants on the document schema.
