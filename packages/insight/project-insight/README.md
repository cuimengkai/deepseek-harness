# @deepseek-ai/dsh-project-insight

English | [中文](README.zh.md)

Develop-mode project insight: a host-plane service that deterministically scans a session's workspace into a versioned `.dsh/project-insight.json` document and exposes the document through a read/scan service surface and the model-facing `scan_project` tool. The scanner is offline and keyless — no LLM, no network, no credentials — so opening a develop-mode session over a project scans it strictly and carefully, and a second open reads the committed document without re-scanning.

The document has six sections, one per workbench insight tab: module dependency topology, component dependencies, tech stack, components, prompts, and agent-related technology. Every emitted collection is sorted by a stable key and every path is root-relative, so scanning the same bounded tree twice yields a byte-identical document; `scannedAt` is recorded but excluded from the content fingerprint.

## Auto-scan

The service listens for `session/created` and for `agent-preset/selected` on `session/event`, resolves each session's agent preset through `resolveSessionPreset` (the newest selection wins), and triggers only when the resolved preset is in `config.autoScanPresets` (default `['develop']`) and the session carries a working directory. Scans are debounced per project root (`config.scanDebounceMs`, default 1500) and single-flight; a session arriving while its root is scanning joins the waiting set instead of scheduling a second scan. The document is written atomically to `<root>/.dsh/project-insight.json`, and `project-insight/updated` is emitted only after the write commits — the event is proof the document is readable. A fresh document (same content fingerprint) is never rewritten and produces no event.

## Service surface

`read(cwd)` reports `none` / `fresh` / `stale` / `error` without scanning, recomputing the content fingerprint to answer freshness. `scan(cwd, sessionId?, signal?)` scans now, commits the document, and reports `scanned` / `unchanged` / `error`, returning the same compact summary the tool surfaces. A project never scanned reports `none`; an over-cap, unparsable, or wrong-version document reports `error`.

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
- **The document is written into the project** — `.dsh/project-insight.json` lives in the scanned project's own tree, and the harness does not add it to the project's `.gitignore`, so a project that commits everything tracks the cache.
- **Scans are capped by hard limits** — the fingerprint walk stops at `MAX_FINGERPRINT_FILES` and only the first `MAX_SOURCE_FILES` sources are analyzed; the caps and per-section truncations are constants on the document schema.
