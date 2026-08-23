# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: three-column AppFrame (drag handles and concession chain) plus the `ctx.layout` panel-geometry service; it registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `details`, `shell.overlay`, and `page`. The sidebar resize boundary is an invisible hit strip, while the details boundary retains its floating pill; only details shrinks during concession and then auto-closes. A closed sidebar retains a 56px control rail while details closes to zero width. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame always mounts the conversation and details columns; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width and details closed, and it never reads or writes `localStorage`. Hero and other unselected states also derive a zero rendered details width without changing that stored preference. AppFrame retains the last non-blank Session id across those states: the first Session remains closed, an explicit details action opens the contract default width, returning to the same Session restores its unchanged width, and selecting a different Session closes details before paint. The conversation owner share is empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

The frame's fifth child slot, `page`, is the routed full-viewport surface: a list of entries whose `path` option (e.g. `/settings/:section?`) makes the entry a page route. While a page's path is the current URL the frame renders that entry over the whole window above every column and the overlay, and the app grid below it goes `inert` — the DOM-level focus/pointer guard (the wrapper uses `display: contents`, so the columns stay direct frame grid items and `inert` is what freezes the app, not a box). The app stays mounted under the covering page by design, so open/close never loses session or draft state; a page owns its scroll container. Only the matched entry renders, by id, and entries without a path can never match — a fresh id with a path registers a new full-page surface beside the shipped settings page. The pages projection rides the frame's inject face and reconciles the `page` ledger with the router location into one snapshot (routable entries in registration order plus the matched page id), so the frame and any page consumer read the same URL↔route truth.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, the `ILayout` panel-action face, and the `PagesSnapshot` projection type. AppFrame, the panel store, the concession solver, and the pages source remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
- **One active page at a time** — the frame matches the first `page` route whose path matches and renders only that entry by id; stacked or nested page surfaces are out of scope.
