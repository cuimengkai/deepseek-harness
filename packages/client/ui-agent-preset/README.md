# dsh-client-ui-agent-preset

English | [中文](README.zh.md)

The agent-preset surfaces: a General-settings row choosing which [preset](../../preset/agent-presets/README.md) new sessions are composed from, a chip on the new-session screen choosing the next session's, a read-only label in the session header, and a settings section that manages the roster — assemble one by dragging the installed plugins, copy, delete, default, and the way into a preset's own files.

## Why it is a new-session preference

A session's preset is fixed when the session is created — the host refuses to adopt an existing session under a different one, because that session's history was produced under the first preset's tools. So this row cannot be a live switch, and it says so: changing it applies to sessions started afterwards while running sessions keep the composition they began with.

## The new-session chip

A second surface, beside the workspace picker on the new-session screen. It sits there rather than in the composer because that is where the choice is still open: a control that spends most of its life disabled belongs on the screen where it still works.

The chip opens on the deployment default and its pick is *staged* — the screen precedes the session it would apply to. The stage reaches a session when one becomes current and is still blank, which covers both the session the workspace connect created and the blank one it reused; riding along on `sessions.create` would miss the second. It is spent on first use, so the next new session opens on the default again, exactly like the workspace picker beside it.

A session that has started cannot take the stage — the host answers `agent-preset-locked` — but the pick still names the NEXT session, so the stage is kept, not dropped: a develop pick that precedes an import survives until the connect creates the session it belongs to. The stage is spent when a blank session takes it, or settles when the host refuses the switch.

## The session-header label

A third surface, beside the session title: the preset THIS session runs, as static chrome. A control there would promise a switch the host refuses outright. It reads the preset from the session's own summary and resolves the display name against the same roster the General row reads. Forwarded `agent-preset/selected` owner events fold committed blank-session switches into that shared summary in every tab; the initiating tab may already have applied the RPC echo, and the merge is idempotent.

## What it reads and writes

Options and the current default both come from one `agentPreset.list` call. The roster already reports which id a session with no explicit choice gets, so the row needs no settings-schema introspection; the write targets the `agent-presets` settings namespace's `default` field, which is what the host resolves at creation.

A locally authored preset is exactly as privileged as the plugins it names, so the list marks `user` rows rather than presenting every preset as shipped and vetted.

Preset files publish one unlocalized `name` and `description`, which Web uses for every `user` row and unknown `system` row. For the four shipped ids (`standard`, `code`, `minimal`, and `cordis`), Web resolves both fields from its active locale only when the roster marks the row `system`; an identically named `user` preset keeps its file metadata.

The row re-reads on `settings/changed` for its own namespace and on `connection/reset`: the roster is a live directory and the default is a settings field, so an external edit or a reconnect can both move it.

## The management section

A fourth surface, its own settings page (`settings.section` id `agent-presets`, ordered after Models — choosing a model is routine, composing an agent is the deployment-shaping act behind it): the roster as cards, a drag-and-drop composer that assembles an agent from the installed plugins, a copy dialog, and a read-only design page over the shipped compositions.

The browser writes no composition text and no path. Editing YAML in a web textarea was a weak surface (no completion, no highlighting, no diff), so a new preset is either a host-side copy of an existing one or a composition graph the host projects to rows and re-validates before it is written.

The copy dialog collects an id (it becomes the directory name, which is why it must be named up front and cannot change later) and an optional display name, and `{ from, id, name? }` is all that crosses the wire. Everything else — description, composition, skills — is edited in the preset's own files, and the page's other job is getting the user TO those files: the copy completes by opening the new directory, and every custom row keeps a location action. Where the host has no desktop opener (`hasDocument: false` on the roster; remote and container deployments), the same actions answer the directory as text on the row instead of offering a button that would spawn into nothing.

The composer — the `新建 Agent` entry and the compose action on a user preset — assembles an agent on a flow canvas that owns the whole settings content area, filling its full width and height under the settings top bar: the composition is the workspace, not a column in one. The composition's head label (`组合`) sits above the canvas as a fixed head, outside the layered region, so a floating panel never covers it. The canvas renders the composition as a chain graph from Start through one agent node per plugin row to End — chain order IS the row order written to the host, and there is no branching because `agent.cordis.yml` is an ordered row list with no runtime execution-flow semantics. The chain is saved as a flow graph — node positions and the per-node composition ride on the wire, never YAML text and never a path — and the host projects the graph back to rows, re-checks every named module against the plugin inventory, and enforces the row invariants before the file is touched. The palette and the inspector float over the canvas as layers instead of side columns: the palette offers the deployment's installed plugins annotated with display name, category, and description (grouped by type, searchable), expanded by default and collapsing to a tab on the canvas edge; the inspector appears only while a node is selected, floating over the right edge with remove and move-up/down actions. The inspector's Models section binds one model kind at a time — text, image, audio, embedding — pairing a provider select with a model select over the configured catalog (`llm.models`), the same models the Models settings surface configures, chosen rather than typed: a bound kind declares the route it would take, either side left unset to inherit the node's own default. A kind no configured provider serves gets no row; a catalog still loading, or an unavailable host (refusal or dead transport), renders a hint instead of the pickers. The read-only design page shows the same routes as text. A palette module drops onto the canvas to append it as the next chain node — the drop position is where the node is drawn, the chain order appends it last; the drag starts on the palette and releases over the canvas, so the floating panel never sits between the source and the drop target. Nodes drag to be repositioned on the canvas (a visual layout only; the chain order is untouched), and the order itself is edited two ways: the connect gesture — dragging a node's port onto another node relinks the chain so the target runs right after the source — and the inspector's move-up/down. A node's hover shows a floating "+" that opens a node picker for adding a successor right after that node, and each edge's midpoint shows one that inserts between its endpoints — both open the same modal: the palette's search over grouped, annotated module cards, with spent modules (already in the composition — one instance per plugin) disabled. Picking keeps chain order: the module appends at the chain tail, then moves to the anchor's slot, so a pick after Start lands first, after an agent follows it, and the End terminal keeps the tail; the new node is selected and its inspector opens. A save needs an id and at least one row; for an in-place edit the host requires a user-authored target before the file is written. Shipped presets get no compose action — their composition is the known-good copy source, and only a user copy is composed in place.

A preset publishes its own description, of any length, and the grid sizes every card row alike — so an unbounded description would set the height of the whole roster. Cards clamp it to four lines and offer the rest in a tooltip, attached only while the text is actually cut off. The clamp is CSS, so the whole description stays in the accessibility tree whatever the card shows.

A shipped preset opens in a read-only design page: the same canvas renders its chain, but nothing is editable — no palette, no id or name fields, no save, and the nodes neither drag nor offer a remove control. It is the known-good composition a copy starts from, so reading it is the point; it offers no compose, no location, and no delete — its install is overwritten by upgrades and is not the user's to manage. The intro carries the guidance a create button used to imply: duplicate an existing preset and make it yours, or let the agent draft one in Creator mode.

The composer's footer also offers the conversational entry: when the roster carries the self-referential `cordis` preset, a handoff button (`让 Agent 帮我搭建/完善`) saves the composition and starts a new session on it — Creator mode lives inside the composer rather than as a separate card, so a draft already being dragged is one step from being built on. The handoff is save-then-handoff: an untouched preset is already on disk and skips the save. The section closes the settings panel through the shell's owner-prop `close`, and the new-session chip's own applier composes the blank session the workspace flow produces — the seat keeps a late roster load from regressing the display (staged pick first, then the composition the current session already carries, then the deployment default).

The dialog mirrors the host's own containment rule (`[a-z0-9][a-z0-9-]*`) and refuses a name already in use — a copy never overwrites. Both checks are conveniences: the host re-applies them and its answer is what the dialog reports on failure.

Deleting removes the preset directory. Sessions already composed from it keep running — a composition is mounted once at session creation and nothing re-reads the file.

A roster row carrying `broken` (the host's shape check found the composition missing or unloadable) renders as a marked card: red border, a "Failed to load" badge (what discovery observed, not a claim that the files are damaged — the usual cause is a composition the user just edited or deleted), the reason verbatim, the body disabled — it cannot become the default, it cannot be composed in place, and duplication is disabled, since a copy of a broken preset is another broken preset. A broken custom row keeps its location and delete actions, because the files are where it gets fixed and deleting is how a ghost directory (composition deleted by hand, directory still blocking the id) is cleared; a broken shipped row withholds the viewer too — there is no readable composition to show. The two pickers (the General row and the new-session chip) drop broken presets entirely: they choose the NEXT session's composition, and offering one that cannot compose would only defer the failure to the session start.

Setting the default writes the `agent-presets` settings namespace, which the host exposes to configuration clients ([`dsh-apiproxy`](../../host/apiproxy/README.md) keeps an explicit allowlist — a namespace outside it makes a picker move and then silently forget).

`agentPreset.compose`, `read`, `copy`, `openDocument`, and `remove` are loopback-pinned ([`dsh-client-connection`](../connection/README.md)): a composition names the plugins a session runs, so reading one is reconnaissance, composing writes one, and the rest manage the roster and drive the host desktop. `agentPreset.list` is not — it carries ids, trust, and the two path-free capability flags, and a LAN client's picker needs it.

## When the surfaces are absent

A deployment that composes no presets answers with an empty roster, and the row, the chip, the label, and the section all render nothing — every session then shares the host composition, and there is nothing to choose between or manage. A deployment that configures no writable root answers `authorable: false`, and the section stays a read-only browser: the shipped compositions still open in the read-only design page, but every copy and compose action is disabled with the reason as its tooltip rather than offering a dialog or composer whose save always fails.

## Model Experience

Indirectly, through the preset a later session is composed from; [`dsh-agent-presets`](../../preset/agent-presets/README.md) owns what that composition puts in front of the model.

#### KV Cache effect

No direct invalidation. Changing the default never touches a running session's prefix; a session created afterwards establishes its own prefix from its own composition.

## Known Limitations and Deferred Work

- **A preset without metadata is listed by id** — display text is optional, and a copy given no name deliberately falls back to its directory name rather than presenting itself identically to its source.
- **A revealed path is display text, not a link** — where the host has no desktop opener the row shows the directory to copy by hand; the browser cannot open a host filesystem location itself.
- **Composition edits are invisible to the page** — the files are edited outside the browser and nothing on the wire announces a file change, so the roster re-reads on its own actions, `settings/changed`, and `connection/reset`, not on every disk edit.
- **Handing a draft to Creator mode starts a blank session** — the composition is saved and the session is staged on the self-referential preset, but nothing prefills the conversation; the agent starts from the composed rows and an empty chat.
- **The composer arranges the chain, it does not edit per-plugin config** — an edited preset's existing `config` and `disabled` ride along in the composition each agent node carries, and a node added from the palette carries neither, but the surface offers no editor for them; those stay in the preset's own files.
- **A per-kind model route is declared, not yet routed** — a bound kind rides in the graph node's `agentOptions.modelKinds`, carried so a flow-authored binding survives into the child's durable options, but no runtime routes requests by kind yet; the node's own `provider`/`model` still decide.
- **A layout regeneration drops the bound routes** — the routes live on the graph nodes, so a normal save keeps them (the graph is written beside the rows); but the host regenerates the layout from rows when a hand edit to `agent.cordis.yml` leaves the stored layout stale, and `rowsToGraph` builds the nodes without `agentOptions`, so the per-kind routes are lost.
