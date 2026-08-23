/**
 * Router plugin, browser half: mounts the RouterService into the loader row's
 * fiber, exposing `ctx.router` (history-mode navigation + page-route matching)
 * to every consumer. Provides, never consumes: no injected services.
 * @module @deepseek-ai/dsh-client-ui-router/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
export { RouterService } from './router.ts'
export type { PageRouteEntry, PageRouteMatch, RouterLocation } from './router.ts'
/** No injected services: the router provides `ctx.router`, it does not consume. */
export declare const inject: string[]
/**
 * Mount the RouterService.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void
//# sourceMappingURL=index.d.ts.map
