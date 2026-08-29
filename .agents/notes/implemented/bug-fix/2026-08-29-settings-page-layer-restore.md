# Agent Note: Settings page layer restored after the master merge

Status: implemented

English | [中文](2026-08-29-settings-page-layer-restore.zh.md)

## Problem

The master merge reconciliation replaced `AppFrame.tsx` with master's version, which predates the routed-page architecture (master has no `ui-router` package and no `page` slot). But `index.ts` kept the branch's pages infrastructure: the `page` child-slot declaration and the `hooks: { pages }` inject face. The settings page therefore registered into the `page` slot and navigated to `/settings`, yet nothing rendered the slot — the frame drew only the three columns and the overlay. The reconciliation also dropped `router` from ui-layout's `inject` array (master's value was `['slots', 'theme', 'locale']`), even though `ui-router`'s contract says ui-layout strict-resolves `router`, and it reconciled `apply.client.spec.ts` to master's no-pages expectations, which failed against the still-present pages inject face.

## Decision

AppFrame renders the `page` slot again, from the branch's proven shape: the `activeId` selection off the `usePages` inject-face hook, the whole app grid wrapped in one `appRegion` div (`display: contents`) that goes `inert` while a page is active, and a `pageLayer` div above every column and the overlay rendering `renderSlot('page', {}, { only: activeId })`. Master's newer frame features — `DocumentTitle`, `SessionProvider`, the locale share — stay; the restoration composes with them rather than replacing them. The inject array becomes `['slots', 'theme', 'locale', 'router']`, and the two spec files assert the pages projection again (the apply bench mounts the real `RouterService`; the frame spec stubs `usePages` and pins the layer/inert behavior).

## Verification

`packages/client/ui-layout` unit tests: 68 passed (including the two restored page-layer tests and the restored inject-projection assertion); `ui-settings-general` and `ui-router` suites: 58 passed alongside; `tsc -b`, `lint`, and the doc gates that pass on the pre-change tree still pass.

## Consequences

- The settings page renders over the whole window at `/settings`, and the app grid below stays mounted but inert, so open/close preserves session and draft state.
- ui-layout again strict-resolves `router`; a web composition that omits the router row fails the boot audit instead of silently degrading.
- Master-side future changes to AppFrame must re-merge against this page-layer shape: the frame now owns a fifth child slot and the `usePages` inject-face dependency.
