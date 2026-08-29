/**
 * Scenario-run controller: ready → start → poll → settled/failed.
 */

import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ScenarioRunController } from '../src/client/scenario-run-store.ts'

describe('ScenarioRunController', () => {
  it('stays idle without an agent mode and becomes ready when synced', () => {
    const remote = {
      agentModes: {
        startEntry: vi.fn(),
        getTryRun: vi.fn(),
      },
    }
    const controller = new ScenarioRunController(remote as never)
    const id = SessionId('s1')
    controller.syncMode(id, null)
    expect(controller.storeFor(id).getSnapshot().phase).toBe('idle')
    controller.syncMode(id, 'hello-orchestration')
    expect(controller.storeFor(id).getSnapshot()).toMatchObject({
      phase: 'ready',
      agentMode: 'hello-orchestration',
    })
  })

  it('starts the entry flow and settles when the poll reports completed', async () => {
    const getTryRun = vi.fn().mockResolvedValue({
      ok: true,
      value: { run: { status: 'completed', error: undefined } },
    })
    const remote = {
      agentModes: {
        startEntry: vi.fn().mockResolvedValue({
          ok: true,
          value: { runId: 'run-1', agentMode: 'hello-orchestration' },
        }),
        getTryRun,
      },
    }
    const controller = new ScenarioRunController(remote as never)
    const id = SessionId('s1')
    controller.syncMode(id, 'hello-orchestration')
    await controller.start(id, ' make a clip ')
    expect(remote.agentModes.startEntry).toHaveBeenCalledWith(id, 'make a clip')
    await vi.waitFor(() => {
      expect(controller.storeFor(id).getSnapshot().phase).toBe('settled')
    })
  })

  it('records a failed start when the remote refuses', async () => {
    const remote = {
      agentModes: {
        startEntry: vi.fn().mockResolvedValue({
          ok: false,
          error: { message: 'session has no agent mode' },
        }),
        getTryRun: vi.fn(),
      },
    }
    const controller = new ScenarioRunController(remote as never)
    const id = SessionId('s1')
    controller.syncMode(id, 'hello-orchestration')
    await controller.start(id)
    expect(controller.storeFor(id).getSnapshot()).toMatchObject({
      phase: 'failed',
      error: 'session has no agent mode',
    })
  })
})
