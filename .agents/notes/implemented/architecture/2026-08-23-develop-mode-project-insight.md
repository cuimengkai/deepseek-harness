# Agent Note: develop-mode project insight

Status: implemented

English | [中文](2026-08-23-develop-mode-project-insight.zh.md)

## Problem

A develop-mode session opens a real project (an OA/ERP, an Element Plus app) and must plan quickly: locate the files a bug fix or feature touches, know the component graph and dependency stack, and give the workbench something to render per mode. Without a scan, the agent shells out on every session and the workbench shows nothing. A live-model scan is slow, expensive, and non-deterministic, and it makes a second open as costly as the first. Composing the develop preset was also blocked by a one-line bug: creating any preset through the web composer failed with `ENOENT` when the writable `~/.dsh/.agent-presets/` root had never been created, because `writeComposition` used a non-recursive `mkdir`.

## Decision

`@deepseek-ai/dsh-project-insight` is a RELEASE host-plane package in the new `insight/` group: a deterministic offline scanner, a service with a session-lifecycle auto-scan hook, and the model-facing `scan_project` tool. The scanner is a pure function of the tree's bytes — no LLM, no network, no credentials — so scanning the same bounded tree twice yields a byte-identical document, and `scannedAt` is excluded from the content fingerprint. The document at `<root>/.dsh/project-insight.json` carries six sections (module topology, component dependencies, tech stack, components, prompts, agent-related technology), every collection sorted by a stable key, every path root-relative, with hard caps (`MAX_SOURCE_FILES`, `MAX_EDGES`, `MAX_DOC_BYTES`) that bound both the wire and the browser render.

The auto-scan hook listens on the host plane for `session/created` and `agent-preset/selected`, resolves the session's preset through `resolveSessionPreset` (the newest selection wins), and triggers only when the preset is in `autoScanPresets` (default `['develop']`) and the session carries a `cwd`. Scans are debounced per root and single-flight; a session arriving during a scan joins the waiting set. The document is written atomically, and `project-insight/updated` emits only after the write commits — the event is proof the document is readable. A fresh document is never rewritten and emits nothing, so re-opening a scanned project is a no-op. The model sees only the compact summary through `scan_project` (never the full document), with `presentationMeta { code, modules, components }` making the outcome model-visible ⟺ logged.

The document reaches the browser through the privileged `projectInsight.read` RPC (reading project files is reconnaissance) and renders in six `conversation.view` tabs owned by `@deepseek-ai/dsh-client-ui-project-insight` (order 20–70, after trajectory). The conversation-view ring gains a per-session `modes` filter: an entry declaring `modes` shows only while the session's resolved preset is a member, so each mode owns its insight tabs and switching preset shows that mode's tabs by default. The shipped `develop` preset (`apps/cli/config/agent-presets/develop`) mounts `scan_project`, and its persona directs the model to scan on first workspace entry and after significant changes. The authoring bug is fixed by making the `mkdir` recursive, matching `replaceComposition`.

## Alternatives considered

**Scan with the live model on session open.** Rejected: slow, expensive, and non-deterministic, and it makes the scan unavailable offline; develop mode requires a strict, careful keyless scan, so the analysis is static and offline, with LLM enrichment deferred.

**Auto-scan for every mode.** Rejected: the user required develop-only triggering; other modes have no need for the module map, and scanning writes into every project opened.

**Client-triggered scan through the RPC.** Rejected: the trigger must fire automatically when a develop-mode session opens a workspace, which only the host session lifecycle observes; the RPC stays read-only and the service owns the scan.

**Keep the document in memory or in host state.** Rejected: the user required the result stored under the scanned project's own `.dsh/` so a second open loads instantly without re-scanning; the per-project file is also the agent's model-visible artifact.

**A full, uncapped source map.** Rejected: the document is a browser-wire bound; hard caps keep the wire, the render, and the fingerprint walk bounded while preserving determinism.

**Hard-code the six tabs into the trajectory plugin.** Rejected: the user required each mode to own its insight tabs and show them by default on switch, which is a generic per-session `modes` filter on the conversation-view ring, not a trajectory special case.

## Consequences

A develop-mode session over a project auto-scans once; other presets stay inert because the service gates on the resolved preset and a `cwd`. A preset switch into develop re-triggers a scan of a blank session's workspace. A second open of a scanned project reads the committed document instantly; an edit turns it `stale` and the next scan refreshes it. The document lives in the project's own tree, which the harness does not `.gitignore` — a project that commits everything will track the cache (recorded in the package README's Known Limitations). First scans of large trees are capped and best-effort (source scanning and heuristics, not a build or type-check). The `modes` filter makes the tab ring mode-aware generically: future modes declare their own tabs, and switching preset re-renders the ring without touching the trajectory plugin.
