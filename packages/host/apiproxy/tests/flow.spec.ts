/**
 * flow.* rides the optional `ctx.get('flowEngine')` boundary: the store methods
 * (list/get/save/delete) forward the engine's results verbatim, the run methods
 * (run/getRun/listRuns/stop) address the engine's in-memory run surface, and
 * every method refuses with `flow-unavailable` when the composition mounts no
 * engine. `run` resolves the session's live agent as the parent of every child.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { FlowError } from '@deepseek-ai/dsh-flow/src/error.ts'
import type { FlowGraph, FlowRunSnapshot, FlowRunSummary, FlowSummary } from '@deepseek-ai/dsh-flow/types'
import type { ApiProxy, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { flowGetValueSchema, flowSaveRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/flow.schema'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`flow-${String(nextRpc++)}`), payload }
}

/** A valid acyclic graph the store and run surface serve. */
const FIXTURE_GRAPH: FlowGraph = {
  id: 'test-flow',
  name: 'Test Flow',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
    { id: 'work', type: 'agent', position: { x: 100, y: 0 }, prompt: 'Do it' },
    { id: 'end', type: 'end', position: { x: 200, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'work' },
    { id: 'e2', from: 'work', to: 'end' },
  ],
}

/** A settled snapshot of the fixture graph. */
const FIXTURE_RUN: FlowRunSnapshot = {
  runId: 'run-1',
  flowId: FIXTURE_GRAPH.id,
  flowName: FIXTURE_GRAPH.name,
  status: 'completed',
  stopReason: 'completed',
  agentsStarted: 1,
  nodeStatuses: { start: 'done', work: 'done', end: 'done' },
}

/** Minimal flow-engine service double: scriptable methods, sane defaults. */
function engineDouble(over: Partial<{
  list(root: string): Promise<FlowSummary[]>
  get(root: string, flowId: string): Promise<FlowGraph>
  save(root: string, graph: FlowGraph): Promise<FlowGraph>
  delete(root: string, flowId: string): Promise<void>
  run(request: { graph: FlowGraph; parent: unknown; input?: unknown; signal?: AbortSignal }):
  { runId: string; result: Promise<unknown>; cancel(): void }
  getRun(runId: string): FlowRunSnapshot | undefined
  listRuns(flowId?: string): FlowRunSummary[]
  stop(runId: string): void
}> = {}) {
  return {
    list: () => Promise.resolve([]),
    get: () => Promise.reject(new FlowError('flow "test-flow" does not exist', 'FLOW_NOT_FOUND')),
    save: (graph: FlowGraph) => Promise.resolve(graph),
    delete: () => Promise.resolve(),
    run: () => ({ runId: 'run-1', result: Promise.resolve({ status: 'completed' as const, agentsStarted: 0 }), cancel: () => {} }),
    getRun: () => undefined,
    listRuns: () => [],
    stop: () => {},
    ...over,
  }
}

/** Minimal live agent; the gateway only needs identity and its session. */
function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

async function harness(
  engine?: ReturnType<typeof engineDouble>,
): Promise<{ ctx: Context; api: ApiProxy }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (engine !== undefined) ctx.provide('flowEngine', engine as never)
  return {
    ctx,
    api: createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
  }
}

describe('flow store methods', () => {
  it('list serves the engine summaries verbatim', async () => {
    const engine = engineDouble({
      list: async () => [{ id: FIXTURE_GRAPH.id, name: FIXTURE_GRAPH.name, nodeCount: 3, updatedAt: 1 }],
    })
    const { api } = await harness(engine)

    const response = await api.flow.list(request({ cwd: '/tmp/project' }))

    expect(response.result.ok).toBe(true)
    if (response.result.ok) {
      expect(response.result.value).toEqual({
        flows: [{ id: 'test-flow', name: 'Test Flow', nodeCount: 3, updatedAt: 1 }],
      })
    }
  })

  it('get serves the stored graph verbatim', async () => {
    const engine = engineDouble({ get: async () => FIXTURE_GRAPH })
    const { api } = await harness(engine)

    const response = await api.flow.get(request({ cwd: '/tmp/project', id: 'test-flow' }))

    expect(response.result.ok).toBe(true)
    if (response.result.ok) expect(response.result.value).toEqual(FIXTURE_GRAPH)
  })

  it('save returns the saved graph id', async () => {
    const engine = engineDouble()
    const { api } = await harness(engine)

    const response = await api.flow.save(request({ cwd: '/tmp/project', graph: FIXTURE_GRAPH }))

    expect(response.result.ok).toBe(true)
    if (response.result.ok) expect(response.result.value).toEqual({ id: 'test-flow' })
  })

  it('delete acknowledges', async () => {
    const engine = engineDouble()
    const { api } = await harness(engine)

    const response = await api.flow.delete(request({ cwd: '/tmp/project', id: 'test-flow' }))

    expect(response.result.ok).toBe(true)
  })

  it('maps a thrown store failure onto its wire code', async () => {
    const engine = engineDouble({
      save: async () => { throw new FlowError('flow is invalid: no start node', 'FLOW_INVALID') },
    })
    const { api } = await harness(engine)

    const response = await api.flow.save(request({ cwd: '/tmp/project', graph: FIXTURE_GRAPH }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('flow-invalid')
    expect(response.result.error.message).toContain('no start node')
  })

  it('maps a missing flow onto flow-not-found with the payload id', async () => {
    const engine = engineDouble()
    const { api } = await harness(engine)

    const response = await api.flow.get(request({ cwd: '/tmp/project', id: 'missing' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('flow-not-found')
    if (response.result.error.code === 'flow-not-found') {
      expect(response.result.error.details).toEqual({ flowId: 'missing' })
    }
  })
})

describe('flow run methods', () => {
  it('run starts under the session live agent', async () => {
    const seen: unknown[] = []
    const engine = engineDouble({
      run: (request) => {
        seen.push(request.parent)
        return { runId: 'run-1', result: Promise.resolve({ status: 'completed' as const, agentsStarted: 0 }), cancel: () => {} }
      },
    })
    const { ctx, api } = await harness(engine)
    const session = ctx.sessions.create(SessionId('flow-run-s1'))
    const agent = stubAgent(session)
    ctx.agents.register(agent)

    const response = await api.flow.run(
      request({ sessionId: SessionId('flow-run-s1'), graph: FIXTURE_GRAPH }),
      new AbortController().signal,
    )

    expect(response.result.ok).toBe(true)
    if (response.result.ok) expect(response.result.value).toEqual({ runId: 'run-1' })
    expect(seen).toEqual([agent])
  })

  it('run maps an invalid graph onto flow-invalid', async () => {
    const engine = engineDouble({
      run: () => { throw new FlowError('flow is invalid: no start node', 'FLOW_INVALID') },
    })
    const { ctx, api } = await harness(engine)
    ctx.agents.register(stubAgent(ctx.sessions.create(SessionId('flow-run-s2'))))

    const response = await api.flow.run(
      request({ sessionId: SessionId('flow-run-s2'), graph: FIXTURE_GRAPH }),
      new AbortController().signal,
    )

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('flow-invalid')
  })

  it('getRun serves the live snapshot, null when unknown', async () => {
    const engine = engineDouble({ getRun: runId => (runId === 'run-1' ? FIXTURE_RUN : undefined) })
    const { api } = await harness(engine)

    const known = await api.flow.getRun(request({ runId: 'run-1' }))
    const unknown = await api.flow.getRun(request({ runId: 'run-9' }))

    expect(known.result.ok).toBe(true)
    if (known.result.ok) expect(known.result.value).toEqual({ run: FIXTURE_RUN })
    expect(unknown.result.ok).toBe(true)
    if (unknown.result.ok) expect(unknown.result.value).toEqual({ run: null })
  })

  it('listRuns serves the summaries verbatim', async () => {
    const engine = engineDouble({
      listRuns: flowId => (flowId === undefined ? [{ runId: 'run-1', flowId: 'test-flow', flowName: 'Test Flow', status: 'completed', startedAt: 1 }] : []),
    })
    const { api } = await harness(engine)

    const all = await api.flow.listRuns(request({}))
    const filtered = await api.flow.listRuns(request({ flowId: 'other' }))

    expect(all.result.ok).toBe(true)
    if (all.result.ok) {
      expect(all.result.value.runs).toHaveLength(1)
    }
    expect(filtered.result.ok).toBe(true)
    if (filtered.result.ok) expect(filtered.result.value.runs).toEqual([])
  })

  it('stop acknowledges', async () => {
    const engine = engineDouble()
    const { api } = await harness(engine)

    const response = await api.flow.stop(request({ runId: 'run-1' }))

    expect(response.result.ok).toBe(true)
  })

  it('maps an unknown run onto flow-run-not-found with the payload run id', async () => {
    const engine = engineDouble({
      stop: () => { throw new FlowError('no flow run "run-9"', 'FLOW_RUN_NOT_FOUND') },
    })
    const { api } = await harness(engine)

    const response = await api.flow.stop(request({ runId: 'run-9' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('flow-run-not-found')
    if (response.result.error.code === 'flow-run-not-found') {
      expect(response.result.error.details).toEqual({ runId: 'run-9' })
    }
  })
})

describe('flow engine absence', () => {
  it('refuses every method with flow-unavailable', async () => {
    const { api } = await harness()

    const list = await api.flow.list(request({ cwd: '/tmp/project' }))
    const run = await api.flow.run(request({ sessionId: SessionId('any'), graph: FIXTURE_GRAPH }), new AbortController().signal)

    for (const response of [list, run]) {
      expect(response.result.ok).toBe(false)
      if (response.result.ok) throw new Error('unreachable')
      expect(response.result.error.code).toBe('flow-unavailable')
      expect(response.result.error.message).toContain('flow engine is absent')
    }
  })
})

describe('flow wire schema preserves modelKinds', () => {
  const modelKindsGraph: FlowGraph = {
    ...FIXTURE_GRAPH,
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      {
        id: 'work',
        type: 'agent',
        position: { x: 100, y: 0 },
        prompt: 'Do it',
        agentOptions: { provider: 'deepseek', model: 'chat', modelKinds: { image: { provider: 'deepseek', model: 'vl' } } },
      },
      { id: 'end', type: 'end', position: { x: 200, y: 0 } },
    ],
    edges: FIXTURE_GRAPH.edges,
  }

  it('keeps per-kind model bindings through save and get', () => {
    const saved = flowSaveRequestSchema.parse({ cwd: '/tmp/project', graph: modelKindsGraph })
    const savedNode = saved.graph.nodes.find(node => node.type === 'agent')
    expect(savedNode?.agentOptions?.modelKinds).toEqual({ image: { provider: 'deepseek', model: 'vl' } })

    const got = flowGetValueSchema.parse(modelKindsGraph)
    const gotNode = got.nodes.find(node => node.type === 'agent')
    expect(gotNode?.agentOptions?.modelKinds).toEqual({ image: { provider: 'deepseek', model: 'vl' } })
  })

  it('rejects a malformed per-kind binding', () => {
    // Untyped on purpose: the wire accepts arbitrary JSON, and the schema must
    // reject a binding that is not an object of provider/model strings rather
    // than silently drop it (the value a typed FlowGraph cannot even express).
    const malformed = {
      ...FIXTURE_GRAPH,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        {
          id: 'work',
          type: 'agent',
          position: { x: 100, y: 0 },
          prompt: 'Do it',
          agentOptions: { modelKinds: { image: 42 } },
        },
        { id: 'end', type: 'end', position: { x: 200, y: 0 } },
      ],
      edges: FIXTURE_GRAPH.edges,
    }

    expect(() => flowSaveRequestSchema.parse({ cwd: '/tmp/project', graph: malformed })).toThrow()
  })
})
