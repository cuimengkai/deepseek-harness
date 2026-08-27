# Agent Note: A shared documents pool serves every insight tab's file views, and the graph node cards carry type colors

Status: implemented

English | [中文](2026-08-26-insight-shared-documents-pool.zh.md)

## Problem

The v4 documents collection ([[2026-08-26-insight-agent-tech-documents]]) gave content views only to the agent-tech inventory. The other tabs still rendered a selected row's metadata JSON, and the two dependency graphs offered no content view at all — the canvas and the floating list showed paths only. The user asked for the same file-content viewing across 组件, 技术栈, 组件依赖, and 模块拓扑, plus two canvas affordances: node styling that distinguishes file types, and a clear highlight for the selected file.

## Decision

- **One shared content pool, not four per-tab collections.** `ProjectInsightDoc.sections.documents` (`{ files, count }`) carries `FileContentRow` (`{ name, path, content }` — the former `AgentTechMarkdownRow`, renamed and reused by the agent-tech collections). `PROJECT_INSIGHT_FORMAT_VERSION` bumps 4 → 5; the existing stale-read self-heal path rebuilds committed documents, unchanged. Caps are schema constants: `MAX_FILE_CONTENT_BYTES` (64 KiB per file), `MAX_DOCUMENT_ROWS` (600), `MAX_DOCUMENT_TOTAL` (4 MiB), with `MAX_DOC_BYTES` raised to 16 MiB so the stored documents section file (total budget plus JSON-escaping overhead) always passes the per-file read guard. A path-sorted, budget-only selection proved too small in practice: 512 KiB exhausted after roughly a hundred files, so the tabs' listed files fell back to metadata JSON — the raised budget plus the priority order below restore the file views.
- **The pool embeds the tab-listed files in listing priority.** `buildDocuments` orders candidates by the tabs' listings — tech-stack files, manifests, components, agent-tech inventory files, then the remaining module-topology sources — minus the paths the three markdown collections already embed (so an MCP config's redacted render is never shadowed by its verbatim source). Selection follows that priority while the caps hold (a file some tab still lists wins over an unlisted source with a lexically earlier path); the emitted rows stay sorted by path. It reuses content the scan already read and otherwise reads each file bounded. A file over a cap is skipped and stays metadata-only; `count` reports every candidate, embedded or not.
- **Every tab resolves file content through one pair of helpers.** `renderRowDetail` renders a selected leaf's content when the pool carries its `path`, otherwise the row's metadata JSON; `fileContentNode` renders markdown through `MarkdownText` and other files through the grammar-hinted `CodeBlock`. The agent-tech inventory layers its three collections over the pool before resolving, preserving redaction precedence client-side too.
- **The graph tabs gained a content drawer.** The floating complete list moved to the canvas's left edge and the selected file's drawer floats over the right edge: selecting a list row or canvas node opens it (embedded content, row-JSON fallback); closing it or tapping the background clears the selection. A section with an empty rendered edge set falls back to the explorer tree over the full row list, replacing the plain list.
- **Node cards carry their file-type color, not a badge.** `TopologyNode` tints the whole card — border, text, and background — with its category color (ts, js, component, style, other — `fileType.ts`), and the selected node takes the strongest read: the brand border, fill, and a 3px ring. CSS source order (type, cycle, hover, selected) encodes the precedence, so no selector fights another.
- **Grammar coverage grew with the pool.** The shiki lazy grammar map in `dsh-client-ui-primitives` gained vue and svelte; the extension→language map covers the source extensions the pool now embeds.

## Alternatives considered

- **Keep the pool inside `agentTech` and duplicate it per tab** — rejected: four collections with divergent caps and four resolution paths; one pool serves every tab with one budget.
- **Read file content on demand over an RPC** — rejected: a new permission surface and a per-selection round trip for what the offline document can carry bounded (same verdict as the v4 note).
- **A badge (or a color) per exact extension** — rejected: an open color set is unlearnable; five closed categories keep the legend stable while the path label itself carries the exact extension.
- **The drawer as a persistent right pane** — rejected: a split layout shrinks the full-bleed canvas and fights pan/zoom; the floating overlay preserves the canvas and dismisses on background tap.
- **The edge-less fallback as the old plain list** — rejected: the explorer tree is the interaction every other tab already teaches; a second list presentation answered nothing the tree does not.

## Consequences

- `formatVersion` 5 invalidates every committed document once; the first develop-mode read rebuilds it in the background, and the read/stale self-heal tests pin the version.
- The document and wire payload grow with the embedded sources and manifests, bounded to 600 rows and 4 MiB total; rows beyond a cap fall back to metadata JSON (a Known Limitation in the client README). A fresh read moves a few megabytes of JSON over the local wire — the accepted cost of offline content views; the poll only runs while the document is stale.
- The v4 note's `AgentTechSection.documents` collection no longer exists; its rationale moved here and the old note cross-links to this one. The per-type layout ([[2026-08-24-insight-per-type-layout]]) gained a `documents` folder.
- The grammar map is deliberately wider than the agent-tech config set: any source extension the pool embeds that lacks a grammar degrades to the plain `CodeBlock` render, not an error.
- Coverage: `scanner.spec.ts` (pool contents, collection dedup, cap fallback, candidate count, and the listing-priority winner under a binding byte budget), `fingerprint.spec.ts`/`service.spec.ts`/`tool.spec.ts` (version 5), `graph-body.client.spec.tsx` (drawer open/close, pool and JSON fallback, tree fallback), `agent-tech-tabs.client.spec.tsx` (pool layering), `inventory-tabs.client.spec.tsx` (tech-stack and components content plus fallbacks), `topology-graph.client.spec.tsx` (type-colored cards), the apiproxy spec fixture, the connection fixture's sample rows, and the demo e2e's documents assertions.
