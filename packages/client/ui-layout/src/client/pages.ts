/**
 * The 'page' slot's live projection — the routable page entries and the id of
 * the page whose path matches the current URL. One source reconciles the two
 * inputs (slot ledger + router location) so the frame and any page consumer
 * read the same URL↔route truth.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PageRouteEntry } from '@deepseek-ai/dsh-client-ui-router/client'
// Type-only: pulls ctx.router into the type program (the client Context merge
// lives in the router package's declare module).
import type {} from '@deepseek-ai/dsh-client-ui-router/client'

/** One page projection snapshot. */
export interface PagesSnapshot {
  /** Routable 'page'-slot entries (those declaring a path), in registration order. */
  pages: readonly PageRouteEntry[]
  /** The id of the page whose path matches the current URL, or undefined. */
  activeId: string | undefined
}

/**
 * Build the pages source over the slot ledger + router location.
 *
 * The cache key joins the page-ledger and router versions: either a page
 * registration or a navigation must invalidate the projection (a plain XOR of
 * the two counters could collide, so they stay a joined pair). Subscribers
 * ride both sources.
 * @param ctx - client root context (slots + router provided).
 * @returns a uSES-compatible snapshot/subscribe source.
 */
export function createPagesSource(ctx: ClientContext): HostObservable<PagesSnapshot> {
  let cacheKey = ''
  let cached: PagesSnapshot = { pages: [], activeId: undefined }
  return {
    getSnapshot: () => {
      const key = `${ctx.slots.getVersion('page')}:${ctx.router.getVersion()}`
      if (key !== cacheKey) {
        cacheKey = key
        // A path is what makes a 'page' entry routable; pathless entries can
        // never match and stay out of the projection.
        const pages: PageRouteEntry[] = []
        for (const entry of ctx.slots.entries('page')) {
          const path = entry.options.path
          if (path !== undefined) pages.push({ id: entry.options.id ?? '', path })
        }
        cached = {
          pages,
          activeId: ctx.router.match(pages, ctx.router.getSnapshot().pathname)?.id,
        }
      }
      return cached
    },
    subscribe: (listener) => {
      const offLedger = ctx.slots.subscribe('page', listener)
      const offRouter = ctx.router.subscribe(listener)
      return () => { offLedger(); offRouter() }
    },
  }
}
