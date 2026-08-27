# Agent Note: The context tab adopts a fixed summary header over a tree-detail explorer

Status: implemented

English | [中文](2026-08-27-context-tab-layout-redesign.zh.md)

## Problem

The context tab rendered as one page-long scroller inside the conversation view: the summary block (model, provider, used/window, log revision) scrolled away with the rows, the flat row list mixed seq labels, previews, and token figures with no visual hierarchy, and the range action bar sat in flow after the content. The user's request — "上下文tab中 优化一下布局 固定顶部，不要跟随页面滚动而滚动，并且上下文页面信息的展示乱七八糟，交互也不友好" — asks for a header that stays fixed, an information layout with readable hierarchy, and friendlier interaction.

## Decision

The root opts into the conversation view's composer-overlay bounding mode (`data-conversation-composer-overlay` with `flex: 1 1 0%; min-height: 0; overflow: hidden`), the same fill contract ChatView and the trajectory tab use. The tab itself stops scrolling as a page; the tree and the detail body become the view's only scrollers, each reserving the live `--dsh-composer-height` clearance in its bottom padding so the floating composer never covers the last rows.

- **The summary header is `flex: none` above both panes.** Three stacked lines: the identity row (model, provider, used/window with percentage, log revision as a bordered chip), the segmented capacity meter (system/tools/surface), and the legend row whose right edge carries the range-selection hint. The hint yields its place whenever a range is active or a compaction is in flight, so the affordance is visible exactly when the interaction is available.
- **The tree is a left column with sticky group headers.** Each group title stays visible while its rows scroll under it; every row is a full-width button reading role chip, seq label, elided preview, and a right-aligned tabular token figure. The active row carries an inset business-color edge; rows inside the selected compaction range take the business tint. Group titles carry row count and summed tokens.
- **The detail pane owns the right column.** A header block (title plus one bordered fact chip per label/value pair — seq, role, tokens, provider, model) sits above the pane's own scroll region; a selection switch resets the region's scroll to its top so a new row always opens at its beginning. Surface prose and the compaction summary render through `MarkdownText`; the tool catalog stays a table.
- **The range bar floats.** While a range is active, one absolutely-positioned card centers above the composer carrying the span summary, the `/compact` trigger, the clear action, and the rejection line; it overlays the panes instead of pushing their content. `Escape` clears the range and any rejection line.

Locale keys follow the layout: `label.usedWindow`, `label.noRequest`, and `label.toolsCount` render the new header and row figures; the log-revision label moved from the removed footer into the identity row; keys the old single-scroller layout used (the footer line, the meter's standalone capacity strings) were dropped with their markup.

## Alternatives considered

- **`position: sticky` on the header inside the page-level scroller** — rejected: it keeps the page scroller the composer overlay exists to replace, and the clearance the overlay reserves would still have to be re-derived per scroll container. The bounded fill mode gives the header the same guarantee as every other conversation tab.
- **Keep the flat single-column list and restyle it** — rejected: the row figures (seq, preview, tokens) need distinct visual weights, and the detail of one row needs a stable reading position. A tree-detail split gives both; restyling the flat list gives neither.
- **Render the range actions in the header** — rejected: the identity row is selection-invariant state; putting the range's transient actions there makes the header's content depend on interaction state and moves the actions away from the rows they cover.

## Consequences

- The tab no longer scrolls with the conversation page: the identity, meter, and legend stay visible for the whole visit, and long surfaces scroll inside the tree.
- The tree and detail body paint no elevated surface tokens, so the base scrollbar pair applies and the elevated-surface scrollbar contract needs no rebind in this sheet.
- Fact chips render each label and value as a separate accessible text line, so the assembled golden pins the detail pane as per-chip `detail=` lines (label and value apart) rather than the old joined meta lines.
- The `#seq` label and the inline preview are separate elements now, so DOM queries that matched a row by concatenated text must match the row's label element instead — the assembled lane's `#9` row finder matches the `rowLabel` span.
- The hint line lives inside the legend row, so the golden's `legend=` block carries it while no range is active.

## Verification

- `context-view.client.spec.tsx`: the eight prior cases hold against the new structure, plus a new Escape case — keydown dismisses the range and the rejection line, and a plain-click re-anchor still works after the dismissal.
- `apps/web/tests/context-tab.snapshot.ts` re-recorded: the golden pins the identity row (`head=` lines), the legend, the two-column tree (role chip, label, preview, and token figure as separate `tree=` lines), the per-chip detail lines, the floating range bar, the post-compaction tree, and the checkpoint detail.
- `scrollbar-styles.client.spec.ts` 21/21, repo `typecheck` green, oxlint clean over the touched packages; `ui-context` and `ui-settings-models` suites 243/243.

## Related

- [Context composition view (phase one)](../feature/2026-08-26-context-composition-view.md) — the tab's data contract; this note changes only its presentation.
- [Manual range compaction](../feature/2026-08-27-manual-range-compaction.md) — the anchor/extend semantics and trigger wiring the floating card presents.
- [Insight tab layout redesign](2026-08-24-insight-tab-layout-redesign.md) — the fill-layout precedent this tab follows.
