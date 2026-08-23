// @vitest-environment jsdom
// The pages source against the REAL mechanisms: a real SlotRegistry (the
// 'page' slot declared the way ui-layout's root registration does) and a real
// RouterService over a browser history. Registration and navigation each
// invalidate the projection; the subscription rides both sources; pathless
// entries never become routable pages.

import { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { RouterService } from '@deepseek-ai/dsh-client-ui-router/client'
import { createPagesSource } from '@deepseek-ai/dsh-client-ui-layout/src/client/pages.ts'

/**
 * Root seat for the page-slot declaration. Declaring children claims
 * renderSlot (ui-slots' compile-time rule), so the bench seat consumes it —
 * it is never rendered in this spec, only registered to declare the slot.
 */
function Root(props: PropsRenderSlots<'page'>): ReactNode {
  return props.renderSlot('page', {})
}

async function bench() {
  const ctx = new Context()
  const slotsFiber = ctx.plugin(SlotRegistry)
  const routerFiber = ctx.plugin(RouterService)
  await routerFiber.await()
  await slotsFiber.await()
  // Declare 'page' exactly as ui-layout's root registration declares it.
  const disposeRoot = ctx.slots.register({
    name: 'root',
    children: { 'page': { kind: 'list', scope: 'root' } },
  }, Root)
  return { ctx, disposeRoot }
}

describe('pages source over real slots + router', () => {
  it('projects page entries and the matched id from the URL', async () => {
    const { ctx } = await bench()
    ctx.slots.register({ name: 'page', id: 'settings', path: '/settings/:section?' }, () => null)
    const pages = createPagesSource(ctx)

    expect(pages.getSnapshot()).toEqual({
      pages: [{ id: 'settings', path: '/settings/:section?' }],
      activeId: undefined,
    })
    ctx.router.navigate('/settings/models')
    expect(pages.getSnapshot().activeId).toBe('settings')
    ctx.router.navigate('/')
    expect(pages.getSnapshot().activeId).toBeUndefined()
  })

  it('excludes pathless page entries from routability', async () => {
    const { ctx } = await bench()
    ctx.slots.register({ name: 'page', id: 'settings', path: '/settings/:section?' }, () => null)
    // A page entry without a path can never match a URL.
    ctx.slots.register({ name: 'page', id: 'pathless' }, () => null)
    const pages = createPagesSource(ctx)
    expect(pages.getSnapshot().pages).toEqual([{ id: 'settings', path: '/settings/:section?' }])
  })

  it('notifies on both page registration and navigation; unsubscribe stops', async () => {
    const { ctx } = await bench()
    const pages = createPagesSource(ctx)
    const listener = vi.fn()
    const off = pages.subscribe(listener)

    ctx.slots.register({ name: 'page', id: 'settings', path: '/settings/:section?' }, () => null)
    await Promise.resolve() // slot notifications batch per microtask
    expect(listener).toHaveBeenCalledTimes(1)
    ctx.router.navigate('/settings')
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    ctx.router.navigate('/settings/models')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
