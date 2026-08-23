# Agent Note: Settings as a routed full-viewport page

Status: implemented

English | [中文](2026-08-23-routed-settings-page.zh.md)

## Problem

The settings surface was a centered modal: 800px wide, `min(800px, calc(100vh - 48px))` tall, a 188px nav column and 54px header, and four sections each capped at 720–760px max-width, all scrolling inside one `.options` container. The modal's open state and the active section id were component-local `useState` — no URL, no entry semantics, no browser back, no way to share a section. The user asked to replace the modal with a routed page ("the modal view is too cramped to be friendly; redo the whole settings layout") and to design the routing mechanism generally, because many more pages are coming.

## Decision

**A routable `page` slot.** ui-layout declares a fifth child slot, `page` (list/root), whose entries carry a `path` option. AppFrame matches the entries against the current URL and, while a page's path is active, renders that entry over the whole window above every column and the overlay; the app grid below goes `inert` — the DOM-level focus/pointer guard, applied through a `display: contents` wrapper so the columns stay direct frame grid items. The app stays mounted under the page by design: open/close loses no session or draft state, and the page owns its scroll container. The pages projection reconciles the `page` ledger with the router location into one snapshot (routable entries plus the matched page id) that the frame and any page consumer share.

**A dedicated router package.** New `@deepseek-ai/dsh-client-ui-router` provides `ctx.router`: a browser-history + page-route-matching service wrapping react-router v7's `UNSAFE_createBrowserHistory` and `matchRoutes`/`matchPath`, exposed as a uSES-compatible observable plus `navigate`/`back`/`forward`. History mode means real URLs — deep links, browser back/forward, and refresh-at-route all work. react-router never enters the React tree (business components see zero contexts, packages/client/AGENTS.md), so pages consume URL state through the service's snapshot/subscribe pair, never through a router context or `<Link>`/`useParams`. react-router is a shared platform module (web `PLATFORM_MODULES` plus the seed pairing, compile-time pinned), so one history identity serves every bundle.

**Settings splits into two slot entries.** ui-settings-general's `SettingsRoot` modal becomes a `SettingsTrigger` — the `sidebar.settings` row that navigates to `/settings`, carries `aria-current` while the route is active, and runs the onboarding coordinator with every step suppressed while the route is active — and a `SettingsPage`, a `page` entry at `/settings/:section?` with a top bar (back, title, actions, close) over a left nav rail and a full-height content column. The active section id is the URL parameter validated against the section ledger, first row as fallback. Closing (the X control, Escape, or a section's `close` owner prop) navigates to the root so the covering page is fully gone; the header back control history-steps with a root fallback for a tab that opened straight on the route. Entering the page focuses the close control.

**Friendly layout.** Top bar + 232px left nav + content padded 36/48/64px; the section max-widths move from 720–760px to 960px, so cards reflow to an extra column.

**Deep links survive a refresh.** frontend-static's fallback serves the shell for missing HTML-accepting route-like paths, so a refresh at `/settings/models` answers 200 while real asset misses stay 404.

**Boot ordering.** ui-router activates before the rows that inject it; the web boot creates entries in topological order and provider rows await their own service fibers, so `ctx.router` resolves by the time a consumer row runs ([web boot sequential creates](2026-08-23-web-boot-sequential-creates.md)).

## Alternatives considered

- **Keep the modal, just widen it** — misses both real requests: URL/entry semantics (deep links, browser back, shareable sections) and a general page mechanism for the pages the user says are coming. The "too cramped" complaint is a symptom; the modal shell is the cause.
- **react-router in the React tree** (`RouterProvider`/`<Link>`/`useParams`) — violates packages/client/AGENTS.md (business components see zero contexts). Rejected; react-router stays an internal history + matching engine and pages get URL state through the service's inject-face pattern, the same shape the slot system already uses.
- **Hand-rolled history + matching** — react-router v7 already bundles the history and matching implementations this needs; hand-rolling deletes nothing and adds maintenance. react-router was adopted but pinned at v7 (v8 raises the React peer requirement to ≥ 19.2.7; the shell is on React 18.3.1), with `UNSAFE_createBrowserHistory` isolated at one construction point.
- **Render the page inside the conversation column** — the user explicitly asked for full-window coverage (整页覆盖) that hides the app skeleton; a modal over the app is exactly the complaint. The covering page with `inert` freezes the app while keeping it mounted.
- **A `<dialog>` element as the page** — the settings surface is a navigable, deep-linkable URL subject, not a transient dialog; the URL becomes the single source of truth and the modal's component-local state disappears.

## Consequences

- Deep links, browser back/forward, and refresh-at-route all work; a reload at `/settings` re-boots the app with the settings page open.
- Section state is the URL parameter — the page cannot hold a section open independently of the route. Onboarding steps are suppressed while the settings route is active; the coordinator keeps its completion state and resumes on return.
- The app grid stays mounted (inert) under the covering page — preserves scroll and drafts but keeps the DOM alive behind the page.
- Entering the page focuses the close control; close does not return focus to the trigger (same as the old modal). The page is not a dialog (no `role=dialog`/`aria-modal`); sections carry `aria-current`.
- react-router must remain a platform singleton — a plugin bundling its own copy splits the history identity and silently breaks every routed page; the compile-time seed projection pins the pairing but cannot stop a second import, so `react-router` should reach bundles only through the platform module.
- A composition that forgets the ui-router row fails the web boot audit loud, with the waiting rows named — never a silent degrade.
