/**
 * The live Checklist: `refreshChecklist` on open, debounced re-check after
 * every graph edit, and the generation guard that discards a stale response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import { AgentModeSectionController, type AgentModeRemoteFace } from '../src/client/section-store.ts'

const GRAPH: FlowGraph = {
  id: 'pipeline',
  name: 'Pipe',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
    { id: 'a', type: 'agent', position: { x: 100, y: 0 }, prompt: 'hi' },
    { id: 'end', type: 'end', position: { x: 200, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'a' },
    { id: 'e2', from: 'a', to: 'end' },
  ],
}

function bench(validate: AgentModeRemoteFace['agentModes']['validate']) {
  const remote: AgentModeRemoteFace = {
    agentModes: {
      list: vi.fn(),
      read: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          agentMode: 'demo', trust: 'user', entryGraph: GRAPH,
          bind: { preset: 'standard', entryFlow: 'pipeline' },
        },
      }),
      saveFlow: vi.fn(),
      create: vi.fn(),
      saveBind: vi.fn(),
      copy: vi.fn(),
      deleteMode: vi.fn(),
      validate,
      tryRun: vi.fn(),
      getTryRun: vi.fn(),
    },
    agentPresets: { list: vi.fn() },
  }
  const controller = new AgentModeSectionController(remote, () => {})
  return { controller, remote }
}

describe('AgentModeSectionController checklist', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('checks the graph immediately on beginCompose', async () => {
    const validate = vi.fn().mockResolvedValue({ ok: true, value: { errors: [] } })
    const { controller } = bench(validate)
    await controller.beginCompose('demo')
    expect(validate).toHaveBeenCalledWith(GRAPH)
    expect(controller.store.getSnapshot().compose?.checklist).toEqual([])
  })

  it('debounces a re-check after a burst of edits into a single call', async () => {
    const validate = vi.fn().mockResolvedValue({ ok: true, value: { errors: [] } })
    const { controller } = bench(validate)
    await controller.beginCompose('demo')
    validate.mockClear()

    controller.moveNode('a', { x: 10, y: 10 })
    controller.moveNode('a', { x: 20, y: 20 })
    controller.moveNode('a', { x: 30, y: 30 })
    expect(validate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(validate).toHaveBeenCalledTimes(1)
  })

  it('surfaces structural findings from a broken graph', async () => {
    const validate = vi.fn().mockResolvedValue({
      ok: true,
      value: { errors: ['edge "stray" ends at unknown node "nowhere"'] },
    })
    const { controller } = bench(validate)
    await controller.beginCompose('demo')
    expect(controller.store.getSnapshot().compose?.checklist).toEqual([
      'edge "stray" ends at unknown node "nowhere"',
    ])
  })

  it('reports a Remote failure as one checklist entry', async () => {
    const validate = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'internal', message: 'validate unavailable' },
    })
    const { controller } = bench(validate)
    await controller.beginCompose('demo')
    expect(controller.store.getSnapshot().compose?.checklist).toEqual([
      'checklist unavailable: validate unavailable',
    ])
  })

  it('discards a stale response superseded by a later edit', async () => {
    let resolveFirst!: (value: { ok: true; value: { errors: readonly string[] } }) => void
    const validate = vi.fn().mockResolvedValueOnce({ ok: true, value: { errors: [] } })
    const { controller } = bench(validate)
    await controller.beginCompose('demo') // generation 1, resolved above

    validate.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    controller.moveNode('a', { x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(400) // fires generation 2, left pending

    validate.mockResolvedValueOnce({ ok: true, value: { errors: ['second'] } })
    controller.moveNode('a', { x: 2, y: 2 })
    await vi.advanceTimersByTimeAsync(400) // fires generation 3, resolves immediately
    expect(controller.store.getSnapshot().compose?.checklist).toEqual(['second'])

    // Generation 2 resolving afterward must not overwrite generation 3's result.
    resolveFirst({ ok: true, value: { errors: ['first (stale)'] } })
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.store.getSnapshot().compose?.checklist).toEqual(['second'])
  })

  it('stops the pending debounce timer on closeCompose', async () => {
    const validate = vi.fn().mockResolvedValue({ ok: true, value: { errors: [] } })
    const { controller } = bench(validate)
    await controller.beginCompose('demo')
    validate.mockClear()
    controller.moveNode('a', { x: 5, y: 5 })
    controller.closeCompose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(validate).not.toHaveBeenCalled()
  })
})
