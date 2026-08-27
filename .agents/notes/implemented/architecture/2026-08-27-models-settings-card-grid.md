# Agent Note: The Models settings page is a cc-switch-style provider list — one-click default switch, hover-revealed management, modal editing

Status: implemented

English | [中文](2026-08-27-models-settings-card-grid.zh.md)

## Problem

The Models page rendered providers as one stacked list of expanding rows: editing opened in place (pushing the rows below down), adding was a row-shaped card at the bottom, and the default model for future Agents was reachable only through the composer's per-session picker — the settings page that names providers could not name the default. The user's request — "参照cc-switch的供应商设置和模型设置，重构目前设置页面中的模型设置页面" — asks for the cc-switch posture. An intermediate attempt guessed at it (a card *grid* with a radio-list default dialog); reading the cc-switch source (`src/components/providers/ProviderCard.tsx`, `ProviderActions.tsx`, `ProviderList.tsx`, `AddProviderDialog.tsx`) corrected the picture: a **vertical list of full-width horizontal cards**, a **prominent one-click enable/switch main button** on every card (disabled "in use" state on the current one; a model dropdown when the provider+model selection offers several models — its OpenClaw variant), and **hover-revealed icon actions** for edit/delete/test.

## Decision

The page keeps its join (the store still folds `llm.providers`, the settings mirror, and `credentials.describe`) and adds two facts: the `agent-default-model` namespace view (read through the shared mirror) and the `llm.models` catalog (fetched in the same load, degrading without failing it). Presentation follows the cc-switch source, mapped onto this harness's seams:

- **A vertical list of full-width cards, not a grid.** `space-y`-style stacking; each row is avatar, identity block (name line + one-line summary), then the actions pinned to the right edge at the same position on every card — a compared list reads as choices first.
- **The default switch is the row's primary command — one click.** The current default carries a disabled **In use** command (check icon, the model as title) plus the brand border. Every other usable provider carries **Set as default** as its card button: one catalog model commits on the click; several open the primitives' `Menu` anchored to the button (cc-switch's OpenClaw pattern — its multi-model `DropdownMenu` behind the Zap button); none keep the command disabled with `defaultNoModels` as its title, since a free-typed id is a write the host would refuse to resolve. The write records provider and model and unsets `reasoningEffort` (per-model capability), carrying the namespace `revision`; the outcome lands in the page's status region — the saved-model notice or a `role="alert"` with the wire's message, because a one-click command has no dialog to inline a failure into.
- **Management rides the card as always-visible icon actions.** cc-switch renders its action row (edit/duplicate/test/delete) on every card — the `group-hover` in its source only scales the avatar — so the card carries Details, Edit, Duplicate, Delete beside the command with no hover gating. **Details** expands the card in place: endpoint, wire protocol, the credential reference or its absence, and the serving models as chips — read-only facts the join already holds. **Duplicate** copies a `providers`-dict route's profile to a fresh sibling key (`<id>-copy`, `-copy-2`, …) through one `settings.mutate`; the copy shares the source's credential reference because a stored key is write-only — a whole-section route and any non-`providers` dict layout offer no copy, having no sibling key. A dormant directory provider renders as a dashed card whose primary **Enable** command opens the prefilled editor — cc-switch's additive Add mapped onto the adopt flow.
- **One dialog at a time.** Editing, adding, and declaring share one `dialog` state slot; opening one replaces another. The first-run setup card stays inline in the list (its dismissal must not depend on a dialog being open) and closing it never touches the dialog's draft — the regression the old shared close handler once had stays covered by a test.
- **Adding is two steps: pick, then edit.** The list's add tile opens a pick dialog over the dormant directory plus the declare-custom entry; a dormant provider's own dashed row skips the pick. The picked editor keeps the provider `<select>` for switching targets, unchanged from the old add card.
- **The avatar stands in for cc-switch's logos.** cc-switch ships an icon per preset provider; this route set is open (catalog entries and hand-declared routes alike), so no logo assets ship — the letter avatar (display name's first character on a rounded square, palette-colored by a route-id hash) is the same fallback cc-switch gives preset-less providers, deterministic across loads, identical on the dormant row, the pick-dialog row, and the card.

Locale keys in both languages: `addProvider`, `inUse`/`inUseTitle`, `setDefault`/`setDefaultProvider`, `defaultSetting` (busy), `defaultNoModels` (disabled title), `defaultFailed` (alert prefix), `savedDefault`, `modelsCount`, `notConfigured`, `addTitle`/`addPickHint`. The intermediate radio-dialog keys (`defaultTitle`/`defaultDescription`/`defaultCurrent`/`defaultConfirm`) were removed with the dialog.

## Alternatives considered

- **Card grid (the intermediate attempt)** — rejected against the source: cc-switch's `ProviderList` stacks full-width cards; a grid breaks the right-edge command alignment that makes one-glance comparison work.
- **Dialog for the default switch (radio list)** — rejected: cc-switch's signature is the one-click enable button; the provider+model case it validates (OpenClaw) uses a dropdown, not a dialog.
- **Drag-reorder and search (cc-switch features)** — out of scope: providers here are settings-namespace keyed with no order field to write, and the page serves a handful of providers; neither has a durable home.
- **Connectivity test, usage stats, open-terminal (cc-switch card actions)** — no seam: a stored key is write-only, so no client command can authenticate a probe against a stored endpoint (`llm.discoverModels` answers a described route from the adapter registry, no network); no wire domain reports provider usage; the harness host owns any terminal. Documented in the README's Known Limitations rather than shipped as actions that can only fail.
- **Read the default from `llm.providers` (a wire field)** — rejected: the default is already durable settings state in `agent-default-model`; a parallel wire field would be a second fact source the page would have to reconcile.

## Consequences

- Editing a provider no longer reflows the list; long editors scroll in their dialog instead of stretching the page.
- The page load fetches one more domain (`llm.models`); a catalog failure degrades the summary and the switch command but never the rows — the same fold the credential enrichment uses.
- DOM queries that addressed the old row list by text must address cards; the tests query by accessible names (`aria-label` per provider on Edit/Delete/Add/Set-default) rather than concatenated row text.
- `CustomProviderCard` no longer renders its own title (the modal provides it); the card is title-less as a bare component and titled wherever mounted.

## Verification

- `components.client.spec.tsx`: the prior cases moved to the dialog flow (add = tile → pick → editor; edit = dialog open/close; the setup-card regression keeps its own case), plus the default-switch pair — the in-use command with a catalog-less refusal (disabled, titled), and the one-click menu flow writing the `agent-default-model` ops with `expectedRevision` and moving the in-use command after reload — and the action set: details expansion over both route shapes, the duplicate write (`providers.<id>-copy`, shared credential reference, no action for undict-addressable routes), the dormant Enable command, and pure `profileFactsOf`/`duplicablePathOf` cases.
- `provider-form.client.spec.tsx`: the declare-card and fetch-picker cases reach their dialogs through the pick step; the fetch picker is matched by its dialog title now that the editor itself is a dialog; the row-opener matches icon buttons by `aria-label`.
- `styles.client.spec.ts`: the card/editor separation case re-pinned to `.card`, a `.cardDefault` outline-recolor case, and an `.iconActions` always-visible case pinning the no-hover-gating decision; `readiness.client.spec.ts` state fixture carries the four new fields.
- `ui-settings-models` suite 233/233; repo `typecheck` green; README.md/README.zh.md rewritten for the list, the one-click switch, the always-visible action set, and the no-seam rejections under Known Limitations.

## Related

- [Web config plane](2026-07-30-web-config-plane.md) — the page's data contract and the write-only credential seam this restructure keeps.
- [Context tab layout redesign](2026-08-27-context-tab-layout-redesign.md) — the bounded-view presentation precedent; this page stays a normal scrolling settings section.
