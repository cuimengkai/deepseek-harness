import { Service } from '@deepseek-ai/cordis';
import { matchPath, matchRoutes, UNSAFE_createBrowserHistory } from 'react-router';
/**
 * Browser history and route-matching service. Constructed via
 * `ctx.plugin(RouterService)`; the Service constructor registers `ctx.router`
 * under the mounting fiber, and the history listener dies with that fiber.
 */
export class RouterService extends Service {
    /** The browser history backing this service (react-router's inline implementation). */
    history = UNSAFE_createBrowserHistory();
    offListen;
    location;
    version = 0;
    listeners = new Set();
    /**
     * @param ctx - owning context (the loader row's fiber that mounted the service).
     */
    constructor(ctx) {
        super(ctx, 'router');
        this.location = toLocation(this.history.location);
        // Only pop events (back/forward/browser navigation) reach this listener;
        // push/replace sync inside navigate instead.
        this.offListen = this.history.listen(() => {
            this.sync(this.history.location);
        });
        // The listener dies with the owning fiber: ctx.plugin(RouterService)
        // mounts under the loader row's fiber, and unload disposes the service
        // and this effect together.
        this.ctx.effect(() => () => { this.offListen(); }, 'ui-router: history listener');
    }
    /** uSES getSnapshot: the current location (stable reference between navigations). */
    getSnapshot() {
        return this.location;
    }
    /** Monotonic navigation counter (uSES pairing with {@link getSnapshot}). */
    getVersion() {
        return this.version;
    }
    /**
     * Subscribe to navigations.
     * @param listener - navigation callback.
     * @returns unsubscribe.
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    /**
     * Navigate to a path (history push by default; replace when options.replace).
     * @param to - destination path.
     * @param options - replace vs push.
     */
    navigate(to, options) {
        if (options?.replace === true)
            this.history.replace(to);
        else
            this.history.push(to);
        // push/replace do not fire history.listen (react-router v7 notifies only
        // on pop), so the cache + version + listeners sync here.
        this.sync(this.history.location);
    }
    /** History back (used by the settings page close). */
    back() {
        // react-router's history exposes go(n), not back()/forward() (those live
        // on the raw window.history); the pop event syncs the snapshot.
        this.history.go(-1);
    }
    /** History forward. */
    forward() {
        this.history.go(1);
    }
    /**
     * Cache a fresh history location, bump the version, and notify subscribers.
     * @param location - the history location to project into the snapshot.
     */
    sync(location) {
        this.location = toLocation(location);
        this.version += 1;
        for (const listener of [...this.listeners])
            listener();
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
    match(entries, pathname) {
        const routes = entries.map(entry => ({ path: entry.path, id: entry.id }));
        const matches = matchRoutes(routes, pathname);
        if (matches === null || matches.length === 0)
            return undefined;
        const route = matches[matches.length - 1]?.route;
        const id = route?.id;
        if (id === undefined)
            return undefined;
        return { id, params: matches[matches.length - 1]?.params ?? {} };
    }
    /**
     * Match one path pattern against a pathname (react-router matchPath), e.g.
     * section extraction from `/settings/:section?`.
     * @param pattern - path pattern.
     * @param pathname - current location pathname.
     * @returns the captured params, or undefined when the pattern does not match.
     */
    matchParams(pattern, pathname) {
        const result = matchPath(pattern, pathname);
        return result === null ? undefined : result.params;
    }
}
/** Project a history location onto the stable public snapshot shape. */
function toLocation(location) {
    return {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        key: location.key,
    };
}
//# sourceMappingURL=router.js.map