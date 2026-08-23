/**
 * Browser-history router service, the single URL seam of the client shell.
 * Wraps react-router's `UNSAFE_createBrowserHistory` (history mode) as a
 * uSES-compatible observable and matches page-route patterns against the
 * current pathname through react-router's `matchRoutes`/`matchPath`.
 *
 * react-router's browser history exposes `location` as a getter that re-reads
 * `window.location`, and only fires `listen` on pop events — push/replace
 * return without notifying. This service therefore caches a stable location
 * snapshot, syncs it inside {@link navigate} (push/replace) and inside the
 * history listener (back/forward/browser navigation), and bumps a version each
 * time — the uSES pairing consumers rely on.
 *
 * react-router is deliberately an INTERNAL history + matching engine only: it
 * never enters the React tree (business components see zero contexts,
 * packages/client/AGENTS.md), so pages consume URL state through this
 * service's getSnapshot/subscribe pair and the navigation methods, never
 * through a router context or `<Link>`/`useParams`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { matchPath, matchRoutes, UNSAFE_createBrowserHistory } from 'react-router'

/** Current URL location snapshot (a stable reference between navigations). */
export interface RouterLocation {
  /** URL pathname, e.g. `/settings/models`. */
  pathname: string
  /** URL search, including the leading `?` when present. */
  search: string
  /** URL hash, including the leading `#` when present. */
  hash: string
  /** History entry key (stable per entry; differs per push). */
  key: string
}

/** A routable page entry: the `path` option of a 'page'-slot registration, as the router matches it. */
export interface PageRouteEntry {
  id: string
  path: string
}

/** One matched page route. */
export interface PageRouteMatch {
  id: string
  params: Record<string, string | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser history + page-route matching (ui-router's RouterService). */
    router: RouterService
  }
}

/** The subset of the history location this service exposes. */
interface HistoryLocationLike {
  pathname: string
  search: string
  hash: string
  key: string
}

/**
 * Browser history and route-matching service. Constructed via
 * `ctx.plugin(RouterService)`; the Service constructor registers `ctx.router`
 * under the mounting fiber, and the history listener dies with that fiber.
 */
export class RouterService extends Service {
  /**
   * The browser history backing this service (react-router's inline
   * implementation). Typed through the factory's return so declaration emit
   * stays nameable: react-router's `BrowserHistory` interface lives in an
   * internal chunk the compiler cannot reference from a .d.ts.
   */
  readonly history: ReturnType<typeof UNSAFE_createBrowserHistory> = UNSAFE_createBrowserHistory()

  private readonly offListen: () => void
  private location: RouterLocation
  private version = 0
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - owning context (the loader row's fiber that mounted the service).
   */
  constructor(ctx: Context) {
    super(ctx, 'router')
    this.location = toLocation(this.history.location as HistoryLocationLike)
    // Only pop events (back/forward/browser navigation) reach this listener;
    // push/replace sync inside navigate instead.
    this.offListen = this.history.listen(() => {
      this.sync(this.history.location as HistoryLocationLike)
    })
    // The listener dies with the owning fiber: ctx.plugin(RouterService)
    // mounts under the loader row's fiber, and unload disposes the service
    // and this effect together.
    this.ctx.effect(() => () => { this.offListen() }, 'ui-router: history listener')
  }

  /**
   * uSES getSnapshot: the current location (stable reference between navigations).
   * @returns the current location.
   */
  getSnapshot(): RouterLocation {
    return this.location
  }

  /**
   * Monotonic navigation counter (uSES pairing with {@link getSnapshot}).
   * @returns the current navigation version.
   */
  getVersion(): number {
    return this.version
  }

  /**
   * Subscribe to navigations.
   * @param listener - navigation callback.
   * @returns unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Navigate to a path (history push by default; replace when options.replace).
   * @param to - destination path.
   * @param options - replace vs push.
   */
  navigate(to: string, options?: { replace?: boolean }): void {
    if (options?.replace === true) this.history.replace(to)
    else this.history.push(to)
    // push/replace do not fire history.listen (react-router v7 notifies only
    // on pop), so the cache + version + listeners sync here.
    this.sync(this.history.location as HistoryLocationLike)
  }

  /** History back (used by the settings page close). */
  back(): void {
    // react-router's history exposes go(n), not back()/forward() (those live
    // on the raw window.history); the pop event syncs the snapshot.
    this.history.go(-1)
  }

  /** History forward. */
  forward(): void {
    this.history.go(1)
  }

  /**
   * Cache a fresh history location, bump the version, and notify subscribers.
   * @param location - the history location to project into the snapshot.
   */
  private sync(location: HistoryLocationLike): void {
    this.location = toLocation(location)
    this.version += 1
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Match page routes against a pathname: the first entry whose path matches
   * wins (registration/order sequence, matching the shell's one-active-page
   * model). Params flow through react-router's matching, so optional segments
   * (`/settings/:section?`) and splats work.
   * @param entries - 'page'-slot entries projected to id + path.
   * @param pathname - current location pathname.
   * @returns the matched page and its params, or undefined when nothing matches.
   */
  match(entries: readonly PageRouteEntry[], pathname: string): PageRouteMatch | undefined {
    const routes = entries.map(entry => ({ path: entry.path, id: entry.id }))
    const matches = matchRoutes(routes, pathname)
    if (matches === null || matches.length === 0) return undefined
    const route = matches[matches.length - 1]?.route as { id?: string } | undefined
    const id = route?.id
    if (id === undefined) return undefined
    return { id, params: matches[matches.length - 1]?.params ?? {} }
  }

  /**
   * Match one path pattern against a pathname (react-router matchPath), e.g.
   * section extraction from `/settings/:section?`.
   * @param pattern - path pattern.
   * @param pathname - current location pathname.
   * @returns the captured params, or undefined when the pattern does not match.
   */
  matchParams(pattern: string, pathname: string): Record<string, string | undefined> | undefined {
    const result = matchPath(pattern, pathname)
    return result === null ? undefined : result.params
  }
}

/** Project a history location onto the stable public snapshot shape. */
function toLocation(location: HistoryLocationLike): RouterLocation {
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    key: location.key,
  }
}
