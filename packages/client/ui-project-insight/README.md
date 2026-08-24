# @deepseek-ai/dsh-client-ui-project-insight

English | [中文](README.zh.md)

The develop mode's insight tabs: six `conversation.view` registrations that render the session project's committed project-insight document. Each tab shows one of the six scanned sections — module dependency topology, component dependencies, tech stack, components, prompts, and agent-related technology — in ring order after the trajectory tab. The document and its six sections are produced by the host service [`@deepseek-ai/dsh-project-insight`](../../insight/project-insight/README.md).

The tabs are gated to the `develop` agent preset through the per-session `modes` filter on the conversation-view ring: the filter shows a tab only while the session's resolved preset is a member of its `modes`, so switching a session into develop mode shows the six tabs by default and switching out hides them. Entries that declare no `modes` (chat, trajectory) always show.

Each tab owns a per-session `ProjectInsightController` that reads the session's document through the privileged `projectInsight.read` RPC (reading project files is reconnaissance), keyed off the session's current `cwd`. A fresh document renders immediately; `none` and `stale` mean the host may still be scanning, so the controller re-reads on a two-second interval until the wire reports `fresh`. A generation counter makes the latest `load` (or `dispose`) supersede every older in-flight read and scheduled poll, so a session switch never flashes a previous session's document.

The two dependency sections render a full-bleed React Flow dependency graph — pan, zoom, and wheel come from the library, and mutual-import cycle members highlight in red — with the complete module or component list floating over the canvas as a translucent panel. The list and canvas stay in sync in both directions: hovering a list row rings its node and selecting one highlights it, and hovering or tapping a canvas node highlights and scrolls the row into view. Rows outside the bounded node set stay listed but dimmed as "not in graph"; the panel closes to give the canvas the full width. The module graph drops external leaves and un-emitted targets, labels through path aliases, and caps nodes by degree and edges by count; a toolbar caption names what each cap omitted. The tech-stack and components sections render as cards, badges, and two-column tables. The prompts tab and the agent-tech section's skills, MCP, and prompts sub-tabs render a document tab bar over a single scrollable markdown pane through `MarkdownText`. The prompts tab draws its markdown from the agent-tech section's embedded prompt collection — the scanner fills both through the same `isPromptFile` judgement, so the two tabs are the same logical set projected onto different presentations — and shows a total-vs-rendered count line; a project whose embed is empty falls back to the metadata-only file table.

## Model Experience

None, as the tabs render the committed document and never reach the model; the `projectInsight.read` RPC reads project files but produces no model input.

#### KV Cache effect

None — the tabs add no prompt content and the read result is not part of any model request.

## Known Limitations and Deferred Work

- **Dependency graphs are capped** — the module graph keeps only the highest-degree nodes and a bounded edge count, so a very large project's visual is partial; the floating complete list is the completeness fallback and the toolbar caption names what each cap omitted.
- **List selection rings and highlights, never pans** — the view fits the whole graph and re-fits on resize, but a list-row hover or selection does not move the viewport to its node, so a node outside the view stays outside until the user pans; a canvas tap does scroll that node's row into view in the floating list.
- **Prompts markdown comes from the agent-tech embed** — the metadata-only `prompts` section carries no content, so the prompts tab renders the agent-tech section's embedded prompt collection, bounded to its first rows and byte caps; only when that embed is empty does the tab fall back to the metadata-only file table.
- **Freshness lags file changes** — a `stale` document re-reads every two seconds until the host reports `fresh`, so a scan must complete and the poll interval elapse before the tab updates.
- **No project, no tabs** — a session without a `cwd` has nothing to scan and the tabs render nothing.
- **Develop-only** — the tabs stay hidden unless the session's resolved preset is `develop`; other presets show no insight tabs from this package.
- **Embedded documents are bounded** — the agent-tech markdown collections cap rows per collection and bytes per document and in total (schema constants), so a project with many or large skill/prompt files shows only the first rows; MCP `env` values arrive redacted.
