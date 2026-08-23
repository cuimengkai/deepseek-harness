/**
 * The flow-editor canvas: pure graph helpers, the per-session controller's
 * load/save/run/poll wiring against a fake wire, and the apply registration
 * (one `conversation.view` entry after trajectory, per-session controllers,
 * disposal on unload). Run refusal and validation messages are asserted as the
 * English/fallback text the view renders; the one localized validation sentinel
 * is asserted through `RUN_INPUT_INVALID`.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowAgentNode, FlowGraph, FlowRunSnapshot, FlowRunSummary, FlowSummary } from '@deepseek-ai/dsh-flow/types'
import { apply, inject } from '../src/client/index.ts'
import { FlowEditorView, type FlowEditorViewInjected } from '../src/client/FlowEditorView.tsx'
import { NS } from '../src/client/locales.ts'
import {
  addEdgeError, addNode, cascadePosition, kebabId, nextBranchLabel, nextNodeId,
  removeNode, starterGraph, tryAddEdge, uniqueFlowId, FlowEditorController,
  POLL_INTERVAL_MS, RUN_INPUT_INVALID,
} from '../src/client/flow-store.ts'

/** A saved flow the wire serves; the controller opens it as the latest. */
const FIXTURE_GRAPH: FlowGraph = {
  id: 'demo',
  name: 'Demo flow',
  description: 'A tiny demo.',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
    { id: 'agent-1', type: 'agent', position: { x: 220, y: 0 }, prompt: 'Do a thing.' },
    { id: 'end', type: 'end', position: { x: 440, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'agent-1' },
    { id: 'e2', from: 'agent-1', to: 'end' },
  ],
}

const SUMMARY: FlowSummary = { id: 'demo', name: 'Demo flow', nodeCount: 3, updatedAt: 100 }

const RUN_RUNNING: FlowRunSnapshot = {
  runId: 'r1', flowId: 'demo', flowName: 'Demo flow', status: 'running', agentsStarted: 1,
  nodeStatuses: { start: 'done', 'agent-1': 'running', end: 'pending' },
}

const RUN_DONE: FlowRunSnapshot = {
  runId: 'r1', flowId: 'demo', flowName: 'Demo flow', status: 'completed',
  stopReason: 'completed', agentsStarted: 1,
  nodeStatuses: { start: 'done', 'agent-1': 'done', end: 'done' },
}

const RUN_SUMMARY: FlowRunSummary = {
  runId: 'r1', flowId: 'demo', flowName: 'Demo flow', status: 'completed', startedAt: 100,
}

/** A fake flow wire whose answers the test settles by hand, recording every call. */
function flowWire() {
  const pending: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = []
  const calls: string[] = []
  const payloads: Array<{ name: string; args: unknown[] }> = []
  const defer = <T>(): Promise<T> => new Promise<T>((resolve, reject) => {
    pending.push({ resolve: resolve as (value: unknown) => void, reject })
  })
  const record = (name: string, ...args: unknown[]): void => {
    calls.push(name)
    payloads.push({ name, args })
  }
  const flow = {
    list: (arg: unknown) => { record('list', arg); return defer() },
    get: (arg: unknown) => { record('get', arg); return defer() },
    save: (arg: unknown) => { record('save', arg); return defer() },
    delete: (arg: unknown) => { record('delete', arg); return defer() },
    run: (arg: unknown) => { record('run', arg); return defer() },
    getRun: (arg: unknown) => { record('getRun', arg); return defer() },
    listRuns: (arg: unknown) => { record('listRuns', arg); return defer() },
    stop: (arg: unknown) => { record('stop', arg); return defer() },
  } as unknown as IApiClient['flow']
  const wire = { flow } as unknown as IApiClient
  return {
    wire,
    calls,
    payloads,
    answerOk(value: unknown): void {
      pending.shift()!.resolve({ rpcId: 'r', result: { ok: true as const, value } })
    },
    answerErr(message: string, code = 'internal'): void {
      pending.shift()!.resolve({
        rpcId: 'r', result: { ok: false as const, error: { code, message, details: {} } },
      })
    },
    rejectLast(error: Error): void {
      pending.shift()!.reject(error)
    },
  }
}

/** Flush the microtask chains the un-awaited controller continuations run on. */
const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** A controller on the given wire for session `s1` with a fixed workspace. */
function controller(wire: IApiClient, cwd?: string): FlowEditorController {
  return new FlowEditorController(wire, 's1' as SessionId, () => cwd)
}

/** Thread one successful connect gesture, throwing on an unexpected refusal. */
function withEdge(graph: FlowGraph, from: string, to: string): FlowGraph {
  const result = tryAddEdge(graph, from, to)
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`)
  return result.graph
}

/** A graph with a condition source between a start and an end, ready to branch. */
const CONDITION_GRAPH: FlowGraph = {
  id: 'branch', name: 'Branch',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
    { id: 'cond', type: 'condition', position: { x: 200, y: 0 }, expression: 'args.flag === true' },
    { id: 'end', type: 'end', position: { x: 400, y: 0 } },
  ],
  edges: [],
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the pure graph helpers', () => {
  it('mints unique node ids per type', () => {
    // starterGraph already carries one agent, so the next is agent-2.
    expect(nextNodeId(starterGraph(), 'agent')).toBe('agent-2')
    expect(nextNodeId(starterGraph(), 'condition')).toBe('condition-1')
    expect(nextNodeId(starterGraph(), 'start')).toBe('start')
    const twoAgents: FlowGraph = {
      ...starterGraph(),
      nodes: [...starterGraph().nodes, { id: 'agent-2', type: 'agent', position: { x: 0, y: 0 }, prompt: '' }],
    }
    expect(nextNodeId(twoAgents, 'agent')).toBe('agent-3')
  })

  it('addNode builds the right variant with its authored-fresh fields', () => {
    const base = starterGraph()
    const withAgent = addNode(base, 'agent', { x: 700, y: 0 })
    expect(withAgent.nodes[withAgent.nodes.length - 1])
      .toMatchObject({ type: 'agent', position: { x: 700, y: 0 }, prompt: 'Describe the agent task.' })
    const withCondition = addNode(base, 'condition', { x: 700, y: 80 })
    expect(withCondition.nodes[withCondition.nodes.length - 1])
      .toMatchObject({ type: 'condition', expression: 'args.flag === true' })
    const withLoop = addNode(base, 'loop', { x: 700, y: 160 })
    expect(withLoop.nodes[withLoop.nodes.length - 1])
      .toMatchObject({ type: 'loop', iterable: 'args.items', variable: 'item' })
    // Structural nodes carry no authored fields.
    const bare: FlowGraph = { id: 'bare', name: 'Bare', nodes: [], edges: [] }
    const withStart = addNode(bare, 'start', { x: 0, y: 0 })
    expect(withStart.nodes[0]).toEqual({ id: 'start', type: 'start', position: { x: 0, y: 0 } })
  })

  it('connects plain nodes and refuses self-loops and duplicates', () => {
    const base = starterGraph()
    const result = tryAddEdge(base, 'start', 'end')
    if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`)
    expect(result.graph.edges).toHaveLength(3)
    expect(tryAddEdge(result.graph, 'start', 'end')).toEqual({ ok: false, reason: 'duplicate' })
    expect(tryAddEdge(base, 'start', 'start')).toEqual({ ok: false, reason: 'self-loop' })
  })

  it('assigns true/false labels to a condition source and refuses a third branch', () => {
    const g1 = withEdge(CONDITION_GRAPH, 'cond', 'start')
    const g2 = withEdge(g1, 'cond', 'end')
    expect(g2.edges.map(edge => edge.label)).toEqual(['true', 'false'])
    expect(nextBranchLabel(g2, 'cond')).toBeUndefined()
    expect(tryAddEdge(g2, 'cond', 'start')).toEqual({ ok: false, reason: 'condition-full' })
    // Non-branching sources take no label.
    expect(nextBranchLabel(CONDITION_GRAPH, 'start')).toBeUndefined()
  })

  it('assigns body/after labels to a loop source and refuses a third branch', () => {
    const loopGraph: FlowGraph = {
      id: 'loop', name: 'Loop',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'loop', type: 'loop', position: { x: 200, y: 0 }, iterable: 'args.items', variable: 'item' },
        { id: 'end', type: 'end', position: { x: 400, y: 0 } },
      ],
      edges: [],
    }
    const g1 = withEdge(loopGraph, 'loop', 'start')
    const g2 = withEdge(g1, 'loop', 'end')
    expect(g2.edges.map(edge => edge.label)).toEqual(['body', 'after'])
    expect(tryAddEdge(g2, 'loop', 'start')).toEqual({ ok: false, reason: 'loop-full' })
  })

  it('removeNode drops the node and every edge touching it', () => {
    const after = removeNode(starterGraph(), 'agent-1')
    expect(after.nodes.map(node => node.id)).toEqual(['start', 'end'])
    expect(after.edges).toEqual([])
  })

  it('derives a kebab id and keeps it unique against the directory', () => {
    expect(kebabId('  My Flow!  ')).toBe('my-flow')
    expect(kebabId('')).toBe('flow')
    expect(kebabId('---')).toBe('flow')
    expect(uniqueFlowId('other', [SUMMARY])).toBe('other')
    expect(uniqueFlowId('demo', [SUMMARY])).toBe('demo-2')
  })

  it('cascades a new node right of the rightmost and staggers by row', () => {
    expect(cascadePosition(starterGraph())).toEqual({ x: 440 + 240, y: 0 })
  })

  it('describes every refused connect', () => {
    expect(addEdgeError('self-loop')).toContain('itself')
    expect(addEdgeError('duplicate')).toContain('already exists')
    expect(addEdgeError('condition-full')).toContain('true, false')
    expect(addEdgeError('loop-full')).toContain('body, after')
  })
})

describe('the flow-editor controller', () => {
  it('stays idle for a session with no workspace', async () => {
    const h = flowWire()
    const c = controller(h.wire)
    void c.load()
    await flush()
    expect(c.store.getSnapshot().status).toBe('idle')
    expect(h.calls).toEqual([])
  })

  it('opens the starter draft when the flow directory is empty', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    void c.load()
    await flush()
    h.answerOk({ flows: [] })
    await flush()
    const state = c.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.graph).toEqual(starterGraph())
    expect(state.flowId).toBe('')
    expect(state.dirty).toBe(true)
    expect(h.calls).toEqual(['list', 'listRuns'])
  })

  it('opens the most recently saved flow', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    void c.load()
    await flush()
    h.answerOk({ flows: [SUMMARY] })
    await flush()
    h.answerOk(FIXTURE_GRAPH)
    await flush()
    const state = c.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.graph).toEqual(FIXTURE_GRAPH)
    expect(state.flowId).toBe('demo')
    expect(state.dirty).toBe(false)
    expect(h.calls).toEqual(['list', 'get', 'listRuns'])
  })

  it('folds a flow-unavailable refusal into the read-only state', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    void c.load()
    await flush()
    h.answerErr('no flow engine', 'flow-unavailable')
    await flush()
    const state = c.store.getSnapshot()
    expect(state.status).toBe('unavailable')
    expect(state.error).toBeNull()
    expect(state.graph).toBeNull()
  })

  it('surfaces a rejected list as the load failure', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    void c.load()
    await flush()
    h.rejectLast(new Error('boom'))
    await flush()
    expect(c.store.getSnapshot()).toMatchObject({ status: 'error', error: 'flow.list failed' })
  })

  it('resets to a fresh draft on newFlow', () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    const state = c.store.getSnapshot()
    expect(state.graph).toEqual(starterGraph())
    expect(state.flowId).toBe('')
    expect(state.dirty).toBe(true)
    expect(state.status).toBe('ready')
    expect(h.calls).toEqual([])
  })

  it('selectFlow opens the chosen saved flow', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    void c.selectFlow('demo')
    await flush()
    h.answerOk(FIXTURE_GRAPH)
    await flush()
    const state = c.store.getSnapshot()
    expect(state.graph).toEqual(FIXTURE_GRAPH)
    expect(state.flowId).toBe('demo')
    expect(state.dirty).toBe(false)
    expect(h.calls).toEqual(['get', 'listRuns'])
  })

  it('save mints a directory-unique id and re-reads the directory', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    const saving = c.save()
    await flush()
    expect(h.calls).toEqual(['save'])
    const saveArg = h.payloads[0]!.args[0] as { cwd: string; graph: { id: string; name: string } }
    expect(saveArg.cwd).toBe('/proj')
    expect(saveArg.graph).toMatchObject({ id: 'untitled-flow', name: 'Untitled Flow' })
    h.answerOk({ id: 'untitled-flow' })
    await flush()
    expect(h.calls).toEqual(['save', 'list'])
    h.answerOk({ flows: [SUMMARY] })
    await flush()
    const state = c.store.getSnapshot()
    expect(state.flowId).toBe('untitled-flow')
    expect(state.dirty).toBe(false)
    expect(state.status).toBe('ready')
    expect(state.flows).toEqual([SUMMARY])
    await saving
  })

  it('deleteFlow removes the flow and re-reads the directory', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    void c.deleteFlow('demo')
    await flush()
    expect(h.calls).toEqual(['delete'])
    h.answerOk({})
    await flush()
    expect(h.calls).toEqual(['delete', 'list'])
    h.answerOk({ flows: [] })
    await flush()
    expect(c.store.getSnapshot().flows).toEqual([])
  })

  it('routes graph edits through the store', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    c.addNode('agent')
    const state = c.store.getSnapshot()
    expect(state.dirty).toBe(true)
    expect(state.graph?.nodes.find(node => node.id === 'agent-1'))
      .toMatchObject({ type: 'agent', prompt: 'Describe the agent task.' })

    c.moveNode('agent-1', { x: 900, y: 40 })
    expect(c.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-1')?.position)
      .toEqual({ x: 900, y: 40 })

    c.updateNode('agent-1', { prompt: 'New prompt.' })
    expect(c.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-1'))
      .toMatchObject({ prompt: 'New prompt.' })

    // Empty provider/model values drop the key rather than sending '' (the
    // engine emits a provider/model only when present).
    c.updateAgentOptions('agent-1', ' deepseek ', '')
    expect(c.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-1'))
      .toMatchObject({ agentOptions: { provider: 'deepseek' } })
    c.updateAgentOptions('agent-1', ' ', ' ')
    const cleared = c.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-1')
    expect('agentOptions' in cleared!).toBe(false)

    c.removeNode('agent-1')
    expect(c.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-1')).toBeUndefined()
  })

  it('addNodeAt places a node at an explicit graph point and clamps a negative drop', () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()

    c.addNodeAt('agent', { x: 700, y: 120 })
    const added = c.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-2')
    expect(added).toMatchObject({ type: 'agent', position: { x: 700, y: 120 } })
    expect(c.store.getSnapshot().selectedNodeId).toBe('agent-2')
    expect(c.store.getSnapshot().dirty).toBe(true)

    // A drop outside the origin clamps to 0.
    c.addNodeAt('condition', { x: -20, y: -40 })
    const clamped = c.store.getSnapshot().graph?.nodes.find(node => node.id === 'condition-1')
    expect(clamped).toMatchObject({ type: 'condition', position: { x: 0, y: 0 } })
    expect(c.store.getSnapshot().selectedNodeId).toBe('condition-1')
    expect(c.store.getSnapshot().selectedEdgeId).toBeNull()
  })

  it('binds per-kind model routes without dropping the plain route', () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    c.addNode('agent')
    const nodeId = 'agent-1'

    c.updateAgentModelKind(nodeId, 'image', 'provider', 'dify')
    c.updateAgentModelKind(nodeId, 'image', 'model', 'gpt-v')
    c.updateAgentModelKind(nodeId, 'text', 'model', 'deepseek-v3')
    expect((c.store.getSnapshot().graph?.nodes.find(node => node.id === nodeId) as FlowAgentNode | undefined)?.agentOptions)
      .toEqual({
        modelKinds: {
          image: { provider: 'dify', model: 'gpt-v' },
          text: { model: 'deepseek-v3' },
        },
      })

    // Editing the plain route keeps the per-kind routes.
    c.updateAgentOptions(nodeId, 'deepseek', 'deepseek-v4')
    expect((c.store.getSnapshot().graph?.nodes.find(node => node.id === nodeId) as FlowAgentNode | undefined)?.agentOptions)
      .toEqual({
        provider: 'deepseek',
        model: 'deepseek-v4',
        modelKinds: {
          image: { provider: 'dify', model: 'gpt-v' },
          text: { model: 'deepseek-v3' },
        },
      })

    // Clearing one field of a kind leaves the other; clearing both removes
    // just that route (an empty provider would be rejected by the engine).
    c.updateAgentModelKind(nodeId, 'image', 'provider', '')
    expect((c.store.getSnapshot().graph?.nodes.find(node => node.id === nodeId) as FlowAgentNode | undefined)?.agentOptions)
      .toEqual({
        provider: 'deepseek',
        model: 'deepseek-v4',
        modelKinds: {
          image: { model: 'gpt-v' },
          text: { model: 'deepseek-v3' },
        },
      })
    c.updateAgentModelKind(nodeId, 'image', 'model', '')
    expect((c.store.getSnapshot().graph?.nodes.find(node => node.id === nodeId) as FlowAgentNode | undefined)?.agentOptions)
      .toEqual({
        provider: 'deepseek',
        model: 'deepseek-v4',
        modelKinds: { text: { model: 'deepseek-v3' } },
      })

    // Clearing the last kind removes modelKinds, keeping the plain route.
    c.updateAgentModelKind(nodeId, 'text', 'model', '')
    expect((c.store.getSnapshot().graph?.nodes.find(node => node.id === nodeId) as FlowAgentNode | undefined)?.agentOptions)
      .toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
  })

  it('routes a connect gesture and a refusal through the store', () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    c.addNode('condition')
    c.addEdge('condition-1', 'start')
    const edge = c.store.getSnapshot().graph?.edges.find(edge => edge.from === 'condition-1')
    expect(edge).toEqual({ id: 'e3', from: 'condition-1', to: 'start', label: 'true' })
    expect(c.store.getSnapshot().error).toBeNull()
    // A branching source takes its next label, so a repeat of an existing
    // non-branching pair is what refuses; the reason surfaces in the strip.
    c.addEdge('start', 'agent-1')
    expect(c.store.getSnapshot().error).toBe(addEdgeError('duplicate'))
  })

  it('refuses a run whose input text is not valid JSON', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    c.setInputText('not json')
    const running = c.run()
    await flush()
    expect(c.store.getSnapshot().error).toBe(RUN_INPUT_INVALID)
    expect(h.calls).toEqual([])
    await running
  })

  it('starts a run and polls its live snapshot', async () => {
    vi.useFakeTimers()
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    c.setInputText('{"flag": true}')
    const running = c.run()
    await flush()
    expect(h.calls).toEqual(['run'])
    const runArg = h.payloads[0]!.args[0] as { sessionId: string; input: { flag: boolean }; graph: { id: string } }
    expect(runArg.sessionId).toBe('s1')
    expect(runArg.input).toEqual({ flag: true })
    expect(runArg.graph).toMatchObject({ id: 'starter' })
    h.answerOk({ runId: 'r1' })
    await flush()
    expect(h.calls).toEqual(['run', 'getRun'])
    h.answerOk({ run: RUN_RUNNING })
    await flush()
    expect(c.store.getSnapshot().status).toBe('running')
    expect(c.store.getSnapshot().run).toEqual(RUN_RUNNING)

    // The interval re-polls the host; the settled snapshot stops the poll and
    // refreshes the runs list.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(h.calls.filter(call => call === 'getRun')).toHaveLength(2)
    h.answerOk({ run: RUN_DONE })
    await flush()
    const state = c.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.run).toEqual(RUN_DONE)
    expect(state.nodeStatuses).toEqual(RUN_DONE.nodeStatuses)
    expect(h.calls.filter(call => call === 'listRuns')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(h.calls.filter(call => call === 'getRun')).toHaveLength(2)
    c.dispose()
    await running
  })

  it('stop cancels the live run through the wire', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    c.setInputText('{}')
    void c.run()
    await flush()
    h.answerOk({ runId: 'r1' })
    await flush()
    const stopping = c.stop()
    await flush()
    expect(h.payloads.find(payload => payload.name === 'stop')!.args[0]).toEqual({ runId: 'r1' })
    // Settle the poll's outstanding getRun first so the stop answer is unambiguous.
    h.answerOk({ run: RUN_RUNNING })
    await flush()
    h.answerOk({})
    await stopping
    c.dispose()
  })

  it('dispose stops the live poll', async () => {
    vi.useFakeTimers()
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    c.newFlow()
    c.setInputText('{}')
    void c.run()
    await flush()
    h.answerOk({ runId: 'r1' })
    await flush()
    expect(h.calls.filter(call => call === 'getRun')).toHaveLength(1)
    c.dispose()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(h.calls.filter(call => call === 'getRun')).toHaveLength(1)
  })

  it('refreshes the runs directory when asked', async () => {
    const h = flowWire()
    const c = controller(h.wire, '/proj')
    void c.refreshRuns('demo')
    await flush()
    expect(h.calls).toEqual(['listRuns'])
    expect(h.payloads[0]!.args[0]).toEqual({ flowId: 'demo' })
    h.answerOk({ runs: [RUN_SUMMARY] })
    await flush()
    expect(c.store.getSnapshot().runs).toEqual([RUN_SUMMARY])
  })
})

describe('ui-flow-editor apply', () => {
  async function bench() {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const h = flowWire()
    ctx.provide('connection', { api: h.wire } as never)
    const state = { current: 's1', byId: { s1: { id: 's1', cwd: '/proj' } } }
    const listeners = new Set<() => void>()
    ctx.provide('sessions', {
      list: {
        getSnapshot: () => state,
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      },
    } as never)
    return { ctx, slots: ctx.get('slots') as SlotRegistry }
  }

  /** Declare the conversation ring so the view registration can land. */
  function declareView(slots: SlotRegistry): () => void {
    const disposers = [
      slots.register({
        name: 'root',
        children: { conversation: { kind: 'single', scope: 'root' } },
      } as never, () => null),
      slots.register({
        name: 'conversation',
        children: { 'conversation.view': { kind: 'list', scope: 'session' } },
      } as never, () => null),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'sessions'])
  })

  it('registers the flow canvas after trajectory at order 15', async () => {
    const { ctx, slots } = await bench()
    const disposeView = declareView(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    expect(entry.component).toBe(FlowEditorView)
    expect(entry.options.id).toBe('flow-editor')
    expect(entry.options.order).toBe(15)
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('流程')
    disposeView()
  })

  it('hands each session its own controller and drops the entry on unload', async () => {
    const { ctx, slots } = await bench()
    const disposeView = declareView(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('conversation.view')[0]!
    const injectFace = entry.inject as unknown as (sessionId: SessionId) => FlowEditorViewInjected
    const a = injectFace('s1' as SessionId)
    const again = injectFace('s1' as SessionId)
    const b = injectFace('s2' as SessionId)
    expect(a.controller).toBe(again.controller)
    expect(a.controller).not.toBe(b.controller)
    expect(slots.entries('conversation.view')).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
    disposeView()
  })
})
