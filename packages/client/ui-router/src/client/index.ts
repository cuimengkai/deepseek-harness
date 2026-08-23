/**
 * Router plugin, browser half: mounts the RouterService into the loader row's
 * fiber, exposing `ctx.router` (history-mode navigation + page-route matching)
 * to every consumer. Provides, never consumes: no injected services.
 * @module @deepseek-ai/dsh-client-ui-router/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { RouterService } from './router.ts'

export { RouterService } from './router.ts'
export type { PageRouteEntry, PageRouteMatch, RouterLocation } from './router.ts'

/** No injected services: the router provides `ctx.router`, it does not consume. */
export const inject: string[] = []

/**
 * Mount the RouterService.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  // The loader considers a row loaded once its entry fiber settles, so the
  // entry must stay LOADING until the service fiber is ACTIVE: a consumer row
  // (ui-layout, ui-settings-general) strict-resolves `router`, and an entry
  // that activated without it leaves them PENDING and the whole boot fails.
  await ctx.plugin(RouterService)
}
