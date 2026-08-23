# @deepseek-ai/dsh-client-ui-project-insight

English | [中文](README.zh.md)

The develop mode's insight tabs: six `conversation.view` registrations that render the session project's committed `project-insight.json` document. Each tab shows one of the six scanned sections — module dependency topology, component dependencies, tech stack, components, prompts, and agent-related technology — in ring order after the trajectory tab. The document and its six sections are produced by the host service [`@deepseek-ai/dsh-project-insight`](../../insight/project-insight/README.md).

The tabs are gated to the `develop` agent preset through the per-session `modes` filter on the conversation-view ring: the filter shows a tab only while the session's resolved preset is a member of its `modes`, so switching a session into develop mode shows the six tabs by default and switching out hides them. Entries that declare no `modes` (chat, trajectory) always show.

Each tab owns a per-session `ProjectInsightController` that reads the session's document through the privileged `projectInsight.read` RPC (reading project files is reconnaissance), keyed off the session's current `cwd`. A fresh document renders immediately; `none` and `stale` mean the host may still be scanning, so the controller re-reads on a two-second interval until the wire reports `fresh`. A generation counter makes the latest `load` (or `dispose`) supersede every older in-flight read and scheduled poll, so a session switch never flashes a previous session's document.

## Model Experience

None directly: the tabs render the committed document and never reach the model. The `projectInsight.read` RPC reads project files but produces no model input, and no prompt section, persona, or tool is owned here.

#### KV Cache effect

None — the tabs add no prompt content and the read result is not part of any model request.

## Known Limitations and Deferred Work

- **Flat lists, not graphs** — each section renders as sorted rows; graph visualization and diff views are deferred to the workbench surfaces that own richer rendering.
- **Freshness lags file changes** — a `stale` document re-reads every two seconds until the host reports `fresh`, so a scan must complete and the poll interval elapse before the tab updates.
- **No project, no tabs** — a session without a `cwd` has nothing to scan and the tabs render nothing.
- **Develop-only** — the tabs stay hidden unless the session's resolved preset is `develop`; other presets show no insight tabs from this package.
