/**
 * Hero scenario seat: load roster, stage, apply select on a blank session.
 */

import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AgentModeSeatController } from '../src/client/mode-seat-store.ts'

describe('AgentModeSeatController', () => {
  it('loads modes and applies select on a blank session', async () => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: 'hello-orchestration' })
    const remote = {
      agentModes: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            modes: [{
              id: 'hello-orchestration',
              trust: 'system',
              name: 'Sample',
              preset: 'orchestration-sample',
              isDefault: true,
            }],
          },
        }),
        select,
      },
    }
    const session = {
      id: SessionId('s1'),
      blank: true,
      projectionValues: {} as Record<string, unknown>,
    }
    const controller = new AgentModeSeatController(remote as never, () => session)
    await controller.load()
    expect(controller.store.getSnapshot().current).toBe('hello-orchestration')
    const refusal = await controller.select('hello-orchestration')
    expect(refusal).toBeUndefined()
    expect(select).toHaveBeenCalledWith(session.id, 'hello-orchestration')
    expect(controller.store.getSnapshot().current).toBe('hello-orchestration')
  })

  it('applies the displayed default onto a blank session that has no mode yet', async () => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: 'hello-orchestration' })
    const remote = {
      agentModes: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            modes: [{
              id: 'hello-orchestration',
              trust: 'system',
              isDefault: true,
            }],
          },
        }),
        select,
      },
    }
    const session = {
      id: SessionId('s1'),
      blank: true,
      projectionValues: {} as Record<string, unknown>,
    }
    const controller = new AgentModeSeatController(remote as never, () => session)
    await controller.load()
    await controller.apply()
    expect(select).toHaveBeenCalledWith(session.id, 'hello-orchestration')
  })

  it('surfaces a select refusal without clearing the staged id until apply finishes', async () => {
    const remote = {
      agentModes: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            modes: [
              { id: 'demo', trust: 'user', isDefault: true },
              { id: 'other', trust: 'user', isDefault: false },
            ],
          },
        }),
        select: vi.fn().mockResolvedValue({
          ok: false,
          error: { message: 'locked', details: { reason: 'session already started' } },
        }),
      },
    }
    const session = {
      id: SessionId('s1'),
      blank: true,
      projectionValues: { agentMode: 'demo' },
    }
    const controller = new AgentModeSeatController(remote as never, () => session)
    await controller.load()
    const refusal = await controller.select('other')
    expect(refusal).toBe('session already started')
    expect(controller.store.getSnapshot().current).toBe('demo')
  })
})
