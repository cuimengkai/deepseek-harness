// @vitest-environment jsdom
// Client apply wiring under the function-plugin form: ctx.router provided,
// no injected services (the router provides, never consumes); teardown
// cascades (service unprovided). Node half and the invariant companion ride
// along — the aggregate coverage gate still requires exercised.

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, RouterService } from '@deepseek-ai/dsh-client-ui-router/client'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-router'
import * as invariant from '@deepseek-ai/dsh-client-ui-router/invariant'

async function bench() {
  const ctx = new Context()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-router client apply', () => {
  it('declares no service dependencies (provides, never consumes)', () => {
    expect(inject).toEqual([])
  })

  it('provides ctx.router via apply', async () => {
    const { ctx } = await bench()
    expect(ctx.get('router')).toBeInstanceOf(RouterService)
  })

  it('teardown unwinds the service', async () => {
    const { ctx, fiber } = await bench()
    await fiber.dispose()
    expect(ctx.get('router')).toBeUndefined()
  })
})

describe('node half + invariant companion', () => {
  it('node apply is an intentional no-op (browser-history service only)', () => {
    nodeApply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })

  it('invariant companion registers under the package name', async () => {
    const register = vi.fn().mockReturnValue(() => {})
    const ctx = { invariants: { register } } as never
    // The /invariant subpath types live in lib/types (build product); assert
    // the API so the call stays typed where lint runs without a build.
    const dispose = await (invariant as { apply: (ctx: never) => Promise<() => void> }).apply(ctx)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-client-ui-router', expect.any(Function))
    // The installer is the declared no-op — calling it must not throw.
    expect(() => { (register.mock.calls[0]![1] as (c: never) => void)(undefined as never) }).not.toThrow()
    expect(dispose).toBeTypeOf('function')
  })
})
