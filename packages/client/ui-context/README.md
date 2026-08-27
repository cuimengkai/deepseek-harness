# @deepseek-ai/dsh-client-ui-context

English | [中文](README.zh.md)

The session context tab: one `conversation.view` registration that renders the session's current model-visible context composition through the privileged `contextComposition.read` RPC. The host-side fold lives in [`@deepseek-ai/dsh-context-composition`](../../session/context-composition/README.md).

The tab is a live-session view. It owns a per-session `ContextCompositionController` that reads the session's composition on mount and re-reads whenever the conversation's last event seq moves (a new message, tool call, or compaction — the revision marker the runtime snapshot already carries). A generation counter makes the latest `load` (or `dispose`) supersede every older in-flight read, so a session switch never flashes a previous session's composition. While the read is in flight the tab renders a centered frame with the shared spinner, matching the app's other loading presentations; a session with no requests yet renders the empty frame.

The body is a capacity bar over a left-tree/right-detail explorer. The capacity bar segments the heuristic occupancy — system prompt, tool catalog, conversation surface — against the newest recorded route capacity, with the free tail when the window is known and an explicit unknown marker when it is not; percentages clamp so an over-estimate cannot break the layout. The left tree groups the envelope rows (system prompt, tool catalog), one row per priced surface message, and one row per completed compaction; the right pane renders the selected row: the system prompt as markdown, the tool catalog as a name/tokens table, a surface message's preview, or a compaction's summary text with its writer route and shadow price. The footer names the log revision the snapshot describes.

The tab also fires manual compactions. A plain click selects a row; a shift-click on a surface row extends a range from the last plain-clicked anchor (a gone anchor re-anchors on the clicked row), highlighting every covered row and showing an action bar with the inclusive span (row count and summed tokens). Its trigger sends `/compact <startSeq>:<endSeq>` through the commands Remote: an admitted execution clears the range (the compaction events move the revision marker, the composition re-reads, and the shrunken surface plus the new history row appear), while a rejection keeps the range and shows the engine's failure line. Failure strings stay English (error-surface policy: not localized).

## Model Experience

Indirectly, through the compaction engine the range trigger routes: the tab's own reads render a projection of the session's log, the `/compact` slash input and direct result never enter a model request, and an accepted compaction replaces the selected surface span with the backend's checkpoint — a model-visible change fully reconstructable from the logged `compaction/*` and replacement events.

#### KV Cache effect

The tab's reads add no prompt content and no cache effect. An accepted range compaction invalidates cache reuse from the first shadowed history token, exactly like any other compaction.

## Known Limitations and Deferred Work

- **Figures are heuristic, not provider-reported** — the tab shows the token-meter's fixed-density estimates, which is the same vocabulary the meter and the `contextBreakdown` projection use, but not the provider's exact tokenization; the pressure projection's provider samples are the exact figures and live elsewhere.
- **Refresh is per surface revision** — the re-read fires on the conversation's last-event movement, so log-only events (a header change, a route-capacity advertisement) do not refresh the tab until the next surface movement or tab remount.
- **Read is host-plane only** — a deployment without `@deepseek-ai/dsh-context-composition` in its composition fails every read with an internal refusal and the tab renders the error frame; the fixture connection serves an offline parallel so the fixture-driven app still renders.
- **Range is engine-validated** — the tab sends raw seq endpoints and renders the engine's rejection verbatim; it does not pre-validate tool-call pairing or shadowed-row membership, because the surface fold on the host owns that truth.
