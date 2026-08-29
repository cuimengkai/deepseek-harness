import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name, inject } from '../src/invariant.ts'

describe('agent-modes invariant companion', () => {
  it('registers under the package name', async () => {
    expect(name).toBe('agent-modes-invariant')
    expect(inject).toEqual(['invariants'])
    const registrations: string[] = []
    const ctx = {
      invariants: {
        register: (pkg: string) => {
          registrations.push(pkg)
          return () => {}
        },
      },
    } as unknown as Context
    await apply(ctx)
    expect(registrations).toEqual(['@deepseek-ai/dsh-agent-modes'])
  })
})
