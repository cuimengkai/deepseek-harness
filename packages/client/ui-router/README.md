# @deepseek-ai/dsh-client-ui-router

English | [中文](README.zh.md)

Browser-history router service, the single URL seam of the client shell. It wraps react-router v7's `UNSAFE_createBrowserHistory` (history mode) as a uSES-compatible observable and matches page-route patterns through react-router's `matchRoutes`/`matchPath`, exposing `ctx.router`: the `getSnapshot`/`getVersion`/`subscribe` uSES trio, `navigate`/`back`/`forward`, `match` over `page`-slot entries, and `matchParams` for one pattern. Constructed via `ctx.plugin(RouterService)` in the entry's apply — the Service constructor registers `ctx.router` under the mounting fiber and the history listener dies with that fiber, so dispose or reload tears the subscription down with the row.

react-router is deliberately an INTERNAL history + matching engine only: it never enters the React tree, because business components see zero contexts (packages/client/AGENTS.md), so pages consume URL state through this service's snapshot/subscribe pair and the navigation methods, never through a router context or `<Link>`/`useParams`. History mode means real URLs: a route is a deep link, browser back/forward and a refresh at a route all work, and a reload re-boots the app on the route it was opened at.

react-router is a shared platform module: the web shell seeds it once into the frozen module table (`PLATFORM_MODULES` plus the paired static import in `seed.ts`, pinned together at compile time by the `satisfies Record<PlatformModule, unknown>` projection), so every dynamic bundle resolves one react-router identity and one history. The shell's routed surface — the settings page — rides this router through ui-layout's `page` slot: a `page` entry whose `path` matches the current URL renders over the whole window while the app grid below goes inert.

Provides, never consumes: the entry injects no services, so it must activate before the rows that strict-resolve `router` (ui-layout, ui-settings-general). The web boot creates entries in topological order and a provider row's apply awaits its own service fiber, so `ctx.router` resolves by the time a consumer row runs ([web boot sequential creates](../../../.agents/notes/implemented/architecture/2026-08-23-web-boot-sequential-creates.md)); a composition that omits the router row fails the boot audit loud rather than silently degrading.

## Model Experience

None, as the router manages browser URL state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **react-router must stay a platform singleton** — a plugin that bundles its own react-router copy would split the shared history/context identity and silently break every routed page; the compile-time seed projection pins the pairing but cannot stop a second import, so `react-router` should reach bundles only through the platform module.
- **`UNSAFE_createBrowserHistory` is a non-stable react-router API** — it is isolated at the single construction point in `router.ts`, so a react-router major that removes it changes exactly one file.
- **react-router is pinned at v7** — v8 raises the React peer requirement to ≥ 19.2.7 and the shell is on React 18.3.1, so the bump travels with a React upgrade, not alone.
