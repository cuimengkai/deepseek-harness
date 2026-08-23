/**
 * Flow-engine service: run lifecycle, node-status derivation from the
 * `workflow/*` events, and the persisted flow store.
 * @module tests/service
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResult,
  WorkflowResultInfo,
  WorkflowRun,
  WorkflowRunId as WorkflowRunIdType,
  WorkflowStartRequest,
} from '@deepseek-ai/dsh-workflow'
import { FlowEngine, FlowError, FlowRunId } from '../src/index.ts'
import type { FlowAgentNode, FlowConditionNode, FlowEdge, FlowGraph, FlowLoopNode, FlowNode } from '../src/index.ts'

/** A controllable engine that records requests and re-emits its lifecycle events. */
class StubEngine extends WorkflowEngine {
  requests: WorkflowStartRequest[] = []
  cancels: string[] = []

  start(request: WorkflowStartRequest): WorkflowRun {
    this.requests.push(request)
    const id = WorkflowRunId(`run-${this.requests.length}`)
    return {
      id,
      meta: request.meta,
      // The flow service settles its own outcome on workflow/end and never
      // awaits the engine's result, so this promise is left pending.
      result: new Promise<WorkflowResult>(() => {}),
      cancel: (reason?: string) => {
        this.cancels.push(reason ?? 'cancelled')
        this.end(request, { stopReason: 'cancelled', ...(reason === undefined ? {} : { error: reason }), agentsStarted: 0 })
      },
      dispose: async () => {},
    }
  }

  private info(request: WorkflowStartRequest): { id: WorkflowRunIdType; meta: WorkflowStartRequest['meta'] } {
    return { id: WorkflowRunId(`run-${this.requests.indexOf(request) + 1}`), meta: request.meta }
  }

  phase(request: WorkflowStartRequest, title: string): void {
    this.emitWorkflowEvent('workflow/phase', this.info(request), title)
  }

  agentStart(request: WorkflowStartRequest, agent: WorkflowAgentInfo): void {
    this.emitWorkflowEvent('workflow/agent-start', this.info(request), agent)
  }

  agentEnd(request: WorkflowStartRequest, agent: WorkflowAgentEndInfo): void {
    this.emitWorkflowEvent('workflow/agent-end', this.info(request), agent)
  }

  end(request: WorkflowStartRequest, result: WorkflowResultInfo): void {
    this.emitWorkflowEvent('workflow/end', this.info(request), result)
  }
}

/** Fields the per-type node helpers add; `Omit<FlowNode>` alone keeps only common keys. */
type NodeExtra =
  | Partial<Omit<FlowAgentNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowConditionNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowLoopNode, 'id' | 'type' | 'position'>>

/** A node factory with a stable id and origin position. */
function node(type: FlowNode['type'], id: string, extra: NodeExtra): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, ...extra } as FlowNode
}

const start = (id = 'start') => node('start', id, {})
const end = (id = 'end') => node('end', id, {})
const agent = (id: string, prompt = 'work on it') => node('agent', id, { prompt })
const condition = (id: string, expression = 'OUT.a.kind === "go"') => node('condition', id, { expression })

let edgeSeq = 0
/** An edge with a stable unique id; `label` is a branch label when given. */
function edge(from: string, to: string, label?: string): FlowEdge {
  edgeSeq += 1
  return { id: `e${edgeSeq}`, from, to, ...(label === undefined ? {} : { label }) }
}

/** Assemble a graph from nodes and edges. */
function graph(nodes: readonly FlowNode[], edges: readonly FlowEdge[], extra?: Partial<FlowGraph>): FlowGraph {
  return { id: 'demo-flow', name: 'Demo', nodes, edges, ...extra }
}

/** The standard research flow used across run tests. */
function linearGraph(): FlowGraph {
  return graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end')])
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(StubEngine)
  await ctx.plugin(FlowEngine, { maxLiveRuns: 2, maxRunHistory: 2 })
  const engine = ctx.flowEngine as FlowEngine
  const stub = ctx.workflowEngine as StubEngine
  const parent = {} as unknown as Agent
  return { ctx, engine, stub, parent }
}

describe('FlowEngine run lifecycle', () => {
  it('throws FLOW_ENGINE_ABSENT without the workflow engine', () => {
    // `static inject` makes the Loader defer FlowEngine until workflowEngine
    // mounts, so a bare-context `ctx.plugin` would stay PENDING instead of
    // constructing. Direct construction is the Cordis runner's own path, and
    // the guard that matters is the constructor's fail-loud check.
    const ctx = new Context()
    expect(() => new FlowEngine(ctx, { maxLiveRuns: 20, maxRunHistory: 100 })).toThrow(/requires @deepseek-ai\/dsh-workflow/)
  })

  it('rejects an invalid graph with FLOW_INVALID', async () => {
    const { engine, parent } = await setup()
    const bad = graph([start(), agent('a')], [edge('start', 'a'), edge('start', 'a')])
    expect(() => engine.run({ graph: bad, parent })).toThrow(FlowError)
    expect(() => engine.run({ graph: bad, parent })).toThrow(/duplicate edge/)
  })

  it('forwards the compiled script, meta, and parent, and marks the start node done', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0]!.script).toContain('return await visit("start")')
    expect(stub.requests[0]!.meta).toMatchObject({ name: 'demo-flow' })
    expect(stub.requests[0]!.parent).toBe(parent)
    const snapshot = engine.getRun(handle.runId)
    expect(snapshot?.status).toBe('running')
    expect(snapshot?.nodeStatuses).toEqual({ start: 'done', a: 'pending', end: 'pending' })
  })

  it('derives node statuses from phase/agent events and resolves the outcome on workflow/end', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph(
      [start(), condition('c'), agent('t'), agent('f')],
      [edge('start', 'c'), edge('c', 't', 'true'), edge('c', 'f', 'false')],
    )
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!

    stub.phase(request, 'c')
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ c: 'running' })

    stub.agentStart(request, { seq: 1, label: 't', phase: 't', childId: 'c1' as never })
    stub.agentEnd(request, { seq: 1, label: 't', phase: 't', outcome: 'completed', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ c: 'done', t: 'done' })

    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    const outcome = await handle.result
    expect(outcome).toEqual({ status: 'completed', agentsStarted: 1 })
    expect(engine.getRun(handle.runId)).toMatchObject({ status: 'completed', stopReason: 'completed', agentsStarted: 1 })
  })

  it('settles an agent failure as failed and an end node as done', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.agentStart(request, { seq: 1, label: 'a', phase: 'a', childId: 'c1' as never })
    stub.agentEnd(request, { seq: 1, label: 'a', phase: 'a', outcome: 'failed', childId: 'c1' as never })
    stub.end(request, { stopReason: 'error', error: 'the child failed', agentsStarted: 1 })
    const outcome = await handle.result
    expect(outcome).toEqual({ status: 'error', error: 'the child failed', agentsStarted: 1 })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ a: 'failed', end: 'done' })
  })

  it('cancels a live run via stop() and resolves the outcome cancelled', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    engine.stop(handle.runId)
    expect(stub.cancels).toEqual(['cancelled by the user'])
    const outcome = await handle.result
    expect(outcome).toEqual({ status: 'cancelled', error: 'cancelled by the user', agentsStarted: 0 })
  })

  it('settles a lingering gate at workflow/end (condition whose arm is a terminal)', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph([start(), condition('c'), end()], [edge('start', 'c'), edge('c', 'end', 'true'), edge('c', 'end', 'false')])
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    stub.phase(request, 'c')
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    await handle.result
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ c: 'done', end: 'done' })
  })

  it('throws FLOW_RUN_NOT_FOUND for an unknown stop target', async () => {
    const { engine } = await setup()
    expect(() => engine.stop(FlowRunId('ghost'))).toThrow(/no flow run "ghost"/)
  })

  it('enforces the live-run bound with FLOW_CAP', async () => {
    const { engine, parent } = await setup()
    engine.run({ graph: linearGraph(), parent })
    engine.run({ graph: linearGraph(), parent })
    expect(() => engine.run({ graph: linearGraph(), parent })).toThrow(/already 2 live runs/)
  })

  it('lists runs newest first and prunes settled runs beyond the history bound', async () => {
    const { engine, stub, parent } = await setup()
    const first = engine.run({ graph: linearGraph(), parent })
    const second = engine.run({ graph: linearGraph(), parent })
    expect(engine.listRuns()).toHaveLength(2)
    stub.end(stub.requests[0]!, { stopReason: 'completed', agentsStarted: 0 })
    stub.end(stub.requests[1]!, { stopReason: 'completed', agentsStarted: 0 })
    await Promise.all([first.result, second.result])
    const third = engine.run({ graph: linearGraph(), parent })
    stub.end(stub.requests[2]!, { stopReason: 'completed', agentsStarted: 0 })
    await third.result
    // The two most recent settled runs remain; the oldest is pruned.
    expect(engine.listRuns()).toHaveLength(2)
    expect(engine.getRun(first.runId)).toBeUndefined()
    expect(engine.getRun(second.runId)).not.toBeUndefined()
  })
})

describe('FlowEngine flow store', () => {
  let root: string
  let engine: FlowEngine

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-flow-'))
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    await ctx.plugin(FlowEngine)
    engine = ctx.flowEngine as FlowEngine
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('saves, lists, reads, and deletes flows under .dsh/flows', async () => {
    const g = linearGraph()
    await engine.save(root, g)
    expect(await engine.list(root)).toEqual([
      { id: 'demo-flow', name: 'Demo', nodeCount: 3, updatedAt: expect.any(Number) },
    ])
    expect(await engine.get(root, 'demo-flow')).toEqual(g)
    await engine.delete(root, 'demo-flow')
    await expect(engine.get(root, 'demo-flow')).rejects.toThrow(/does not exist/)
  })

  it('refuses to save an invalid graph', async () => {
    const bad = graph([start(), agent('a')], [edge('start', 'a'), edge('start', 'a')])
    await expect(engine.save(root, bad)).rejects.toThrow(/duplicate edge/)
  })

  it('fails loud on a corrupt or versioned document', async () => {
    await engine.save(root, linearGraph())
    const { writeFile } = await import('node:fs/promises')
    const { flowPath } = await import('../src/persistence.ts')
    await writeFile(flowPath(root, 'demo-flow'), 'not json')
    await expect(engine.get(root, 'demo-flow')).rejects.toThrow(/not valid JSON/)
  })

  it('skips an unparseable document in the listing', async () => {
    await engine.save(root, linearGraph())
    const { writeFile } = await import('node:fs/promises')
    const { flowPath } = await import('../src/persistence.ts')
    await writeFile(flowPath(root, 'demo-flow'), 'not json')
    const list = await engine.list(root)
    expect(list).toEqual([])
  })
})

describe('FlowEngine: embedded sub-graphs', () => {
  /** An outer chain start → embedding agent `e` → end around a branching sub-graph. */
  function nestedGraph(): FlowGraph {
    const sub = graph(
      [start(), agent('x', 'work on x'), condition('c', 'OUT.x.kind === "go"'), agent('t', 'passed: ${OUT.x}'), agent('f', 'failed'), end()],
      [edge('start', 'x'), edge('x', 'c'), edge('c', 't', 'true'), edge('c', 'f', 'false'), edge('t', 'end'), edge('f', 'end')],
      { id: 'sub-flow', name: 'Sub' },
    )
    const embed: FlowAgentNode = {
      id: 'e',
      type: 'agent',
      position: { x: 0, y: 0 },
      prompt: '',
      subgraph: sub,
    }
    return graph([start(), embed, end()], [edge('start', 'e'), edge('e', 'end')])
  }

  it('seeds the run surface from the expanded id set and marks only the root start done', async () => {
    const { engine, parent } = await setup()
    const handle = engine.run({ graph: nestedGraph(), parent })
    const snapshot = engine.getRun(handle.runId)
    expect(snapshot?.nodeStatuses).toEqual({
      start: 'done',
      e: 'pending',
      'e-sub-start': 'pending',
      'e-sub-x': 'pending',
      'e-sub-c': 'pending',
      'e-sub-t': 'pending',
      'e-sub-f': 'pending',
      'e-sub-end': 'pending',
      end: 'pending',
    })
  })

  it('forwards the nested branch to both terminals and the expanded phases in the run meta', async () => {
    const { engine, stub, parent } = await setup()
    engine.run({ graph: nestedGraph(), parent })
    const request = stub.requests[0]!
    // The sub-graph's condition reaches both terminals; the embedding runs the
    // sub-graph's namespaced start, and the phase titles are the expanded ids.
    expect(request.script).toContain('await visit("e-sub-start")')
    expect(request.script).toContain('await visit("e-sub-t")')
    expect(request.script).toContain('await visit("e-sub-f")')
    expect(request.meta.phases?.map(phase => phase.title)).toEqual([
      'start', 'e', 'e-sub-start', 'e-sub-x', 'e-sub-c', 'e-sub-t', 'e-sub-f', 'e-sub-end', 'end',
    ])
  })

  it('derives namespaced sub-node statuses from phase and agent events', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: nestedGraph(), parent })
    const request = stub.requests[0]!
    stub.phase(request, 'e-sub-c')
    stub.agentStart(request, { seq: 1, label: 't', phase: 'e-sub-t', childId: 'c1' as never })
    stub.agentEnd(request, { seq: 1, label: 't', phase: 'e-sub-t', outcome: 'completed', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ 'e-sub-c': 'done', 'e-sub-t': 'done' })
  })
})
