// @vitest-environment jsdom
// RouterService behavior: the browser-history + page-route matching seam.
// Mounted via ctx.plugin(RouterService) — the Service constructor registers
// ctx.router under the fiber and the history listener dies with it. Assert the
// uSES contract (stable getSnapshot, version bumps, subscribe), navigation
// (push/replace reflected in jsdom location), history traversal (back/forward
// round-trip through the queued popstate), route matching (matchRoutes +
// matchPath incl. optional segments and misses), and dispose (service
// unregister + listener detachment).

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { RouterService } from '@deepseek-ai/dsh-client-ui-router/client'
import type { PageRouteEntry } from '@deepseek-ai/dsh-client-ui-router/client'

async function bench() {
  const ctx = new Context()
  const fiber = ctx.plugin(RouterService)
  await fiber.await()
  const router = ctx.get('router') as RouterService
  return { ctx, fiber, router }
}

const SETTINGS_ROUTES: PageRouteEntry[] = [{ id: 'settings', path: '/settings/:section?' }]

describe('RouterService', () => {
  it('registers ctx.router under the mounting fiber', async () => {
    const { ctx, router } = await bench()
    expect(router).toBeInstanceOf(RouterService)
    // ctx.get re-reads the same instance (a fresh traceable proxy each call,
    // so assert the type, not proxy identity).
    expect(ctx.get('router')).toBeInstanceOf(RouterService)
  })

  it('navigate pushes the destination into jsdom history and the snapshot', async () => {
    const { router } = await bench()
    router.navigate('/settings')
    expect(window.location.pathname).toBe('/settings')
    expect(router.getSnapshot().pathname).toBe('/settings')
  })

  it('navigate replace swaps the current entry instead of pushing', async () => {
    const { router } = await bench()
    router.navigate('/settings')
    router.navigate('/settings/models', { replace: true })
    expect(router.getSnapshot().pathname).toBe('/settings/models')
    router.back()
    await vi.waitFor(() =>{  expect(router.getSnapshot().pathname).not.toBe('/settings/models') })
  })

  it('getSnapshot is a stable reference between navigations and changes after one', async () => {
    const { router } = await bench()
    const before = router.getSnapshot()
    expect(router.getSnapshot()).toBe(before)
    router.navigate('/settings')
    const after = router.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.pathname).toBe('/settings')
  })

  it('subscribe fires on navigation, getVersion bumps, and unsubscribe stops', async () => {
    const { router } = await bench()
    const listener = vi.fn()
    const off = router.subscribe(listener)
    const v0 = router.getVersion()
    router.navigate('/settings')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(router.getVersion()).toBe(v0 + 1)
    off()
    router.navigate('/settings/models')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(router.getVersion()).toBe(v0 + 2)
  })

  it('back/forward round-trips through the session history', async () => {
    const { router } = await bench()
    router.navigate('/settings')
    router.navigate('/settings/models')
    expect(router.getSnapshot().pathname).toBe('/settings/models')
    router.back()
    await vi.waitFor(() =>{  expect(router.getSnapshot().pathname).toBe('/settings') })
    router.forward()
    await vi.waitFor(() =>{  expect(router.getSnapshot().pathname).toBe('/settings/models') })
  })

  it('match resolves the active page route incl. optional-section params', async () => {
    const { router } = await bench()
    expect(router.match(SETTINGS_ROUTES, '/settings')).toEqual({ id: 'settings', params: {} })
    expect(router.match(SETTINGS_ROUTES, '/settings/models')).toEqual({
      id: 'settings',
      params: { section: 'models' },
    })
    expect(router.match(SETTINGS_ROUTES, '/other')).toBeUndefined()
  })

  it('matchParams captures optional-section params and misses', async () => {
    const { router } = await bench()
    expect(router.matchParams('/settings/:section?', '/settings')).toEqual({})
    expect(router.matchParams('/settings/:section?', '/settings/models')).toEqual({ section: 'models' })
    expect(router.matchParams('/settings/:section?', '/other')).toBeUndefined()
  })

  it('dispose unregisters the service and detaches the history listener', async () => {
    const { ctx, fiber, router } = await bench()
    const history = router.history
    const version = router.getVersion()
    const pathname = router.getSnapshot().pathname
    await fiber.dispose()
    expect(ctx.get('router')).toBeUndefined()
    history.push('/settings')
    expect(router.getVersion()).toBe(version)
    expect(router.getSnapshot().pathname).toBe(pathname)
  })
})
