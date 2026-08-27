# Agent Note: The agent-tech inventory embeds every listed file's content as the documents collection

Status: implemented

English | [中文](2026-08-26-insight-agent-tech-documents.zh.md)

## Problem

After the tree-explorer redesign ([[2026-08-26-insight-tabs-pinned-tree-focus]]) the agent-tech 清单 subtab still rendered the selected file's `{ path, kind }` metadata JSON in the right pane while the 技能/MCP/提示词 subtabs rendered their documents' content. The user's answer to that split was that the inventory should show the file's content. The three markdown collections carried content only for their own rows; the inventory's remaining files (workflows, editor and tool configs, notes the caps dropped) were metadata-only, and a tool leaf showed the tool row rather than the referenced file.

## Decision

- **The document gained a fourth embedded collection** — later lifted out of `agentTech` into the shared top-level `documents` section serving every tab ([[2026-08-26-insight-shared-documents-pool]]). As shipped in v4, `AgentTechSection.documents` reused `AgentTechMarkdownRow` (`{ name, path, markdown }`); `PROJECT_INSIGHT_FORMAT_VERSION` bumped 3 → 4, so an existing project's committed document read `stale` and self-healed through the existing debounced background rebuild. The row and total-byte caps were schema constants; per-file reads reused `MAX_AGENT_TECH_MARKDOWN_BYTES`.
- **The scanner embeds every inventory file the three collections do not already carry.** `buildAgentTechDocuments` skips paths present in skills/mcp/prompts (an MCP config therefore never bypasses its collection's env redaction), reads each remaining emitted file bounded, and drops a file whose content exceeds the per-file cap or the dedicated byte budget — it stays metadata-only, never blocks later smaller files, and the budget is not shared with the markdown collections so configs cannot starve the skill/prompt embeds. Rows sort by path.
- **The wire mirrors the schema.** `agentTechSectionSchema` gains `documents`; the doc literal moves to `z.literal(4)`.
- **The inventory leaf renders content, not metadata.** `AgentTechInventory` indexes all four collections by path and passes a `renderLeafDetail` that resolves the selected row — file or tool — through that index: markdown extensions render through `MarkdownText`; yml/yaml/json/jsonc/toml/ini render through the `CodeBlock` with the matching grammar hint; any other extension renders plain through the `CodeBlock`; a row with no embedded content falls back to its metadata JSON. Group rows keep the JSON payload.

## Alternatives considered

- **Share the markdown collections' byte budget** — rejected: workflow and config files would compete with skills/prompts for the same cap; a dedicated documents budget keeps the v3 embeds intact.
- **Re-embed every file including the three collections' rows** — rejected: duplicate storage, and re-embedding an MCP config verbatim would bypass the `env` redaction its own collection applies.
- **Read file content on demand over an RPC** — rejected: a new permission surface and a per-selection round trip for what the offline document can carry bounded; the embedded-collection precedent already answers viewing.
- **A full extension→grammar map** — rejected: the inventory's non-markdown files are a small closed set of config formats; unknown extensions degrade to the plain `CodeBlock` render.

## Consequences

- `formatVersion` 4 invalidates every committed document once; the first develop-mode read rebuilds it in the background, and the e2e's persisted-doc assertions pin the new collection.
- The document grows by the embedded inventory content, bounded to 100 rows and 256 KiB total; files beyond the caps render metadata JSON in the inventory (a Known Limitation in the client README).
- Files outside the three collections embed verbatim — only MCP configs keep `env` redaction, unchanged from v3, since redaction lives in the mcp collection and `documents` excludes those paths.
- Coverage: `scanner.spec.ts` (embed, exclusion of the three collections, cap fallback), `fingerprint.spec.ts`/`service.spec.ts`/`tool.spec.ts` (version 4 and self-heal), `agent-tech-tabs.client.spec.tsx` (markdown render, grammar-hinted source, tool-leaf resolution, metadata fallback), the apiproxy spec fixture, and the project-insight-demo e2e's documents assertion; the connection fixture serves a sample row.
