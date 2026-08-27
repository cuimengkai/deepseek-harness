# Agent Note: Context composition view (host fold + browser tab)

Status: implemented

English | [中文](2026-08-26-context-composition-view.zh.md)

## Problem

The web app had three partial answers to "what is in the model's context right now": the ContextMeter popover (token-meter's `contextBreakdown` projection — three numbers), the trajectory ledger (the full event log — not the request surface), and the pressure projection (provider-reported samples — lagged and coarse). None showed the shape a person needs to reason about compaction: which messages ride the surface, what the envelope (system prompt + tool catalog) costs, how full the window is, and what past compactions actually removed.

The missing surface is a *projection of the request the loop would build next*, not another meter. It must read the same folds the runtime uses (surface, request header, route capacity) and price with the same estimator, or its figures would disagree with every existing number and undermine trust in all of them.

## Decision

### A read-only host service, not a projection unit

`@deepseek-ai/dsh-context-composition` exposes `ctx.contextComposition` with one method: `read(session)` folds an immutable snapshot of the durable log into a detached `ContextComposition` (envelope, priced surface rows, newest route capacity, compaction history, `logRevision`).

It is deliberately **not** another `SessionProjectionStateMap` unit. The projection registry owns O(1)-persisted per-key state advanced by push frames — ideal for three counters, wrong for a 194-row array with previews that only one tab reads on demand. A per-read fold costs O(n) and owns nothing; the README records the deferred checkpoint fold for the day a real session's read cost shows up. The service registers no events, no config, and no mutable state, so its invariant companion registers nothing — pricing correctness is a pure-function property pinned by unit tests (`packages/session/context-composition/tests/context-composition.spec.ts`), which assert rows equal the estimator's own outputs rather than magic numbers.

### One vocabulary, one home

The wire types live in a pure `./types` subpath with zero runtime imports. The apiproxy zod schema, the browser store, the fixture parallel, and the tests all restate that module, so `ContextSurfaceRow`/`ContextEnvelope`/`ContextCompactionEntry` have exactly one definition. The per-tool token row is documented as **advisory**: the catalog total is `estimateToolsTokens`' exact figure, while a row uses the same density on the tool's own JSON — the rows rank tools but do not sum to the total (the projection's own test initially asserted they did; the estimator's `JSON.stringify(header.tools)` framing makes them differ by construction).

### Pricing discipline: the meter's vocabulary, verbatim

Every figure the tab shows comes from `@deepseek-ai/dsh-token-meter/estimate` — `estimateMessage` per surface row, `estimateSystemTokens`/`estimateToolsTokens` for the envelope. The surface rows replay `foldSurface` (append pushes, `replace` shadows the inclusive range), so the tab's rows are the rows the next request derives from. The host test pins the equality: `composition.surface[0].tokens === estimateMessage(first)`. The fixture connection (`packages/client/connection/src/client/fixture.ts`) mirrors the same constants client-side for the offline lane, the same way it already mirrors `contextBreakdown`.

### RPC surface and the fixture lane

`contextComposition.read` is a privileged unary on the apiproxy (route: `contextComposition.*` in `RpcMethodMap`), resolving `ctx.get('contextComposition')` over the optional-service boundary — a composition without the plugin fails loud with an internal refusal rather than silently emptying the tab. The `FixtureApiClient` gained a parallel fold (`fixtureContextCompositionOf`) over its own committed logs so the fixture-driven app and the assembled-jsdom snapshot lane render the tab keylessly; its `dispatch` switch routes the method by key, so the lane exercises the real bundle path end to end.

### The tab: read on surface revision, latest-write-wins

`@deepseek-ai/dsh-client-ui-context` registers one `conversation.view` entry (id `context`, order 15 — after trajectory, ungated to presets: context is a property of every session, not a mode). The registration follows the ui-trajectory shape: `slots.inject('conversation.view', …)` with a per-(tab × session) `ContextCompositionController` returned from the inject callback, so the renderer's face cache keeps closures identity-stable and unmount disposal stops the read cycle.

The controller is the insight-store pattern verbatim: a generation counter, a re-entrant `loading` guard, `dispose` resetting to initial (so remount's read is never blocked by the guard), error surfacing for both `ok:false` and transport rejection. Refresh keys on the conversation snapshot's last event seq (`+1` while a partial streams) — a primitive selector, so re-renders fire only on real movement. The known limitation is stated in the README: log-only events (a header change) do not refresh until the next surface movement.

### Bundle composition

`dsh-base` gained the `context-composition` row beside `token-meter` (dependency already declared in `packages/bundle/base/package.json`); `dsh-web-app` gained the `ui-context` browser row beside `ui-trajectory`. Both rows are host-plane additions — the fold reads `ctx.sessions`, so it must sit where the apiproxy can resolve it, and the browser roster must carry the tab. `tsconfig.host.json`/`tsconfig.client.json` reference the two new projects; `vitest.config.ts` carries the coverage exclusion the other UI packages use.

## Alternatives considered

- **A third projection unit for the tab** — the registry's push-frame advance suits three counters, not a 194-row array with previews that one tab reads on demand; a per-read fold owns no state and needs no invariant companion.
- **A client-side fold over the wire log** — pricing would drift from the host estimator unless both sides restate it; reading the host's fold with the estimator's own vocabulary keeps every figure equal to figures the meter already shows.
- **Gating the tab to a preset** — context occupancy is a property of every session, not a mode; the registration stays ungated.

## Consequences

- `dsh-base` and `dsh-web-app` each carry one new host-plane row (`context-composition`, `ui-context`); compositions without the plugin fail loud over the RPC boundary instead of rendering a silent empty tab.
- Per-tool token rows are advisory by construction: the catalog total is `estimateToolsTokens`' exact figure, and the rows rank tools without summing to it.
- A log-only event (a header change) does not refresh the tab until the next surface movement; the README records this as the refresh key's limit.
- The `./types` subpath must point its `default` at the tsc artifact under `lib/types/` — the host tsdown pass bundles exactly three files there, and a subpath aimed at a nonexistent tsdown output fails only at runtime.

## Verification

- Host unit: 11 cases over the pure fold — empty session, latest-header envelope (figures equal the estimator's own), row pricing, `replace` shadowing, capacity advertisement, compaction entries, and the store integration.
- Client spec: 11 cases over the controller state machine (idle/loading/ready/empty/error, generation supersede, dispose-restart).
- Keyless snapshot: `apps/web/tests/context-tab.snapshot.ts` (assembled-jsdom lane over built bundles + fixture wire) pins the capacity legend, tree, detail pane, footer, and the surface-selection re-render. The golden is selection-invariant outside the detail pane by design — only `detail=`/`footer=` lines repeat in the second arm.
- Web e2e goldens: every aria golden that renders the conversation tab ring gained its one `- tab "Context"` line (44 files, `+56` lines total; two files with unrelated pre-existing drift — the flow canvas upgrade and the dev-mode menu item — were restored to HEAD rather than swept into this change).
- typecheck green across both aggregates.

### Build-face fact worth keeping

The host tsdown pass bundles exactly `lib/types/{index,invariant,startup}.js`; a new subpath export must therefore point its `default` at the tsc artifact under `lib/types/` (as `./client` already does), never at a nonexistent tsdown-emitted `lib/<name>.js`. The first cut of the `./estimate` export pointed at `lib/estimate.js` and every dsh-web-spawning e2e failed at plugin import with `ERR_MODULE_NOT_FOUND` — the loader resolves subpaths through `exports`, so the missing file only surfaces at runtime, not at typecheck.

## Known gaps deferred

- The fixture's resident log has no `request/header` events, so the assembled golden pins the `envelope: null` arm (0-token legend figures). The envelope-populated arm is covered by the host unit tests; a fixture turn with a header would pin it end to end later.
- Phase two (range-select compaction trigger in the tab, `/compact` range argument) was deferred here and shipped as the [manual range compaction note](2026-08-27-manual-range-compaction.md).
