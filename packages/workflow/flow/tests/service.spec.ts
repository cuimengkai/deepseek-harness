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
  WorkflowNodeEndInfo,
  WorkflowNodeInfo,
  WorkflowResult,
  WorkflowResultInfo,
  WorkflowRun,
  WorkflowRunId as WorkflowRunIdType,
  WorkflowStartRequest,
} from '@deepseek-ai/dsh-workflow'
import { FlowEngine, FlowError, FlowRunId } from '../src/index.ts'
import type {
  FlowAgentNode,
  FlowAggregateNode,
  FlowClassifyNode,
  FlowCodeNode,
  FlowConditionNode,
  FlowEdge,
  FlowExtractNode,
  FlowGraph,
  FlowHttpNode,
  FlowJoinNode,
  FlowListNode,
  FlowLoopNode,
  FlowNode,
  FlowTemplateNode,
} from '../src/index.ts'

/** A controllable engine that records requests and re-emits its lifecycle events. */
class StubEngine extends WorkflowEngine {
  requests: WorkflowStartRequest[] = []
  cancels: string[] = []
  /** How many `WorkflowRun.dispose()` calls the returned runs recorded. */
  disposedRuns = 0
  /** Optional script return value resolved with each `end()` (defaults to null). */
  resultValues = new WeakMap<WorkflowStartRequest, unknown>()
  private readonly resultResolvers = new WeakMap<
    WorkflowStartRequest,
    { resolve: (value: WorkflowResult) => void }
  >()

  start(request: WorkflowStartRequest): WorkflowRun {
    this.requests.push(request)
    const id = WorkflowRunId(`run-${this.requests.length}`)
    const deferred = Promise.withResolvers<WorkflowResult>()
    this.resultResolvers.set(request, deferred)
    return {
      id,
      meta: request.meta,
      result: deferred.promise,
      cancel: (reason?: string) => {
        this.cancels.push(reason ?? 'cancelled')
        this.end(request, { stopReason: 'cancelled', ...(reason === undefined ? {} : { error: reason }), agentsStarted: 0 })
      },
      dispose: async () => {
        this.disposedRuns += 1
      },
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

  nodeStart(request: WorkflowStartRequest, node: WorkflowNodeInfo): void {
    this.emitWorkflowEvent('workflow/node-start', this.info(request), node)
  }

  nodeEnd(request: WorkflowStartRequest, node: WorkflowNodeEndInfo): void {
    this.emitWorkflowEvent('workflow/node-end', this.info(request), node)
  }

  end(request: WorkflowStartRequest, result: WorkflowResultInfo): void {
    const value = this.resultValues.get(request) ?? null
    this.resultResolvers.get(request)?.resolve({
      value,
      stopReason: result.stopReason,
      ...(result.error === undefined ? {} : { error: result.error }),
      agentsStarted: result.agentsStarted,
    })
    this.emitWorkflowEvent('workflow/end', this.info(request), result)
  }
}

/** Fields the per-type node helpers add; `Omit<FlowNode>` alone keeps only common keys. */
type NodeExtra =
  | Partial<Omit<FlowAgentNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowConditionNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowLoopNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowHttpNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowTemplateNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowCodeNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowAggregateNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowListNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowClassifyNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowExtractNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowJoinNode, 'id' | 'type' | 'position'>>

/** A node factory with a stable id and origin position. */
function node(type: FlowNode['type'], id: string, extra: NodeExtra): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, ...extra } as FlowNode
}

const start = (id = 'start') => node('start', id, {})
const end = (id = 'end') => node('end', id, {})
const agent = (id: string, prompt = 'work on it') => node('agent', id, { prompt })
const condition = (id: string, expression = 'OUT.a.kind === "go"') => node('condition', id, { expression })
const http = (id: string, url = 'https://example.com') => node('http', id, { url })
const template = (id: string, source = 'hello') => node('template', id, { template: source })
const code = (id: string, source = 'return 1') => node('code', id, { source })
const aggregate = (id: string, items = [{ name: 'a', expression: '1' }], mode: 'object' | 'first' | 'concat' = 'object') =>
  node('aggregate', id, { items, mode })
const list = (id: string, source = '[1]', op: 'first' | 'last' | 'length' | 'reverse' | 'flatten' = 'first') =>
  node('list', id, { source, op })
const classify = (
  id: string,
  query = 'which',
  classes: { id: string; name?: string }[] = [{ id: 'a' }, { id: 'b' }],
) => node('classify', id, { query, classes })
const joinNode = (id: string) => node('join', id, {})
const extract = (
  id: string,
  query = 'extract it',
  parameters: { name: string; type: 'string' | 'number' | 'integer' | 'boolean'; required?: boolean }[] = [
    { name: 'value', type: 'string' },
  ],
) => node('extract', id, { query, parameters })

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
  const engine = ctx.flowEngine
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

  it('compiles a seed map into the started script', async () => {
    const { engine, stub, parent } = await setup()
    engine.run({ graph: linearGraph(), parent, seed: { a: 'cached' } })
    expect(stub.requests[0]!.script).toContain('const SEED = {"a":"cached"}')
  })

  it('projects an { OUT, IN } envelope into nodeOutputs and nodeInputs', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.agentStart(request, { seq: 1, label: 'a', phase: 'a', childId: 'c1' as never })
    stub.agentEnd(request, { seq: 1, label: 'a', phase: 'a', outcome: 'completed', childId: 'c1' as never })
    stub.resultValues.set(request, { OUT: { a: 'ok' }, IN: { a: {} } })
    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    await handle.result
    expect(engine.getRun(handle.runId)).toMatchObject({
      nodeOutputs: { a: 'ok' },
      nodeInputs: { a: {} },
    })
  })

  it('forwards the compiled script, meta, and parent, and marks the start node done', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0]!.script).toContain('const _done = await visit("start")')
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
    expect(engine.getRun(handle.runId)?.nodeDurationsMs?.t).toEqual(expect.any(Number))

    stub.resultValues.set(request, { t: 'branch ok', start: 'ignored-non-agent' })
    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    const outcome = await handle.result
    expect(outcome).toEqual({ status: 'completed', agentsStarted: 1 })
    expect(engine.getRun(handle.runId)).toMatchObject({
      status: 'completed',
      stopReason: 'completed',
      agentsStarted: 1,
      nodeOutputs: { t: 'branch ok' },
    })
  })

  it('derives node statuses from an http node\'s node-start/node-end events, mirroring an agent node', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph([start(), http('h'), end()], [edge('start', 'h'), edge('h', 'end')])
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!

    stub.nodeStart(request, { seq: 1, phase: 'h' })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ h: 'running' })

    stub.nodeEnd(request, { seq: 1, phase: 'h', outcome: 'completed' })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ h: 'done' })
    expect(engine.getRun(handle.runId)?.nodeDurationsMs?.h).toEqual(expect.any(Number))

    stub.resultValues.set(request, { h: { status: 200 } })
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    await handle.result
    expect(engine.getRun(handle.runId)).toMatchObject({ status: 'completed', nodeOutputs: { h: { status: 200 } } })
  })

  it('settles a failed or unknown-phase http node, mirroring an agent node', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph([start(), http('h'), end()], [edge('start', 'h'), edge('h', 'end')])
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    // A node-start/node-end for a phase this run never tracks (e.g. a stray
    // event from a different run) is ignored rather than crashing the
    // derivation.
    stub.nodeStart(request, { seq: 1, phase: 'ghost' })
    stub.nodeEnd(request, { seq: 1, phase: 'ghost', outcome: 'completed' })
    stub.nodeStart(request, { seq: 1, phase: 'h' })
    stub.nodeEnd(request, { seq: 1, phase: 'h', outcome: 'failed' })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ h: 'failed' })
    stub.end(request, { stopReason: 'error', error: 'the fetch failed', agentsStarted: 0 })
    await handle.result
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ h: 'failed' })
  })

  it('settles a node-end that never saw a matching node-start, and a cancelled outcome', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph([start(), http('h'), end()], [edge('start', 'h'), edge('h', 'end')])
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    // No preceding nodeStart, so nodeStartedAt has no entry to clear.
    stub.nodeEnd(request, { seq: 1, phase: 'h', outcome: 'cancelled' })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ h: 'cancelled' })
    expect(engine.getRun(handle.runId)?.nodeDurationsMs?.h).toBeUndefined()
    stub.end(request, { stopReason: 'cancelled', agentsStarted: 0 })
    await handle.result
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

  it('derives node statuses from a code node\'s node-start/node-end events, mirroring an http node', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph([start(), code('c'), end()], [edge('start', 'c'), edge('c', 'end')])
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!

    stub.nodeStart(request, { seq: 1, phase: 'c' })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ c: 'running' })

    stub.nodeEnd(request, { seq: 1, phase: 'c', outcome: 'completed' })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ c: 'done' })
    expect(engine.getRun(handle.runId)?.nodeDurationsMs?.c).toEqual(expect.any(Number))

    stub.resultValues.set(request, { c: { value: 1, logs: [] } })
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    await handle.result
    expect(engine.getRun(handle.runId)).toMatchObject({
      status: 'completed',
      nodeOutputs: { c: { value: 1, logs: [] } },
    })
  })

  it('derives an aggregate node\'s status from its phase call, settled by the next node event', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph(
      [start(), aggregate('agg'), agent('a'), end()],
      [edge('start', 'agg'), edge('agg', 'a'), edge('a', 'end')],
    )
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    stub.phase(request, 'agg')
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ agg: 'running' })
    stub.agentStart(request, { seq: 1, label: 'a', phase: 'a', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ agg: 'done', a: 'running' })
    stub.agentEnd(request, { seq: 1, label: 'a', phase: 'a', outcome: 'completed', childId: 'c1' as never })
    stub.resultValues.set(request, { agg: { a: 1 }, a: 'ok' })
    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    await handle.result
    expect(engine.getRun(handle.runId)).toMatchObject({ nodeOutputs: { agg: { a: 1 }, a: 'ok' } })
  })

  it('derives a join node\'s status from its phase call, settled by the next node event', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph(
      [start(), agent('split'), agent('x'), agent('y'), joinNode('j'), end()],
      [edge('start', 'split'), edge('split', 'x'), edge('split', 'y'), edge('x', 'j'), edge('y', 'j'), edge('j', 'end')],
    )
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    stub.phase(request, 'j')
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ j: 'running' })
    stub.end(request, { stopReason: 'completed', agentsStarted: 2 })
    await handle.result
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ j: 'done', end: 'done' })
  })

  it('derives a list node\'s status from its phase call, settled at workflow/end when it is a terminal', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph([start(), list('lst'), end()], [edge('start', 'lst'), edge('lst', 'end')])
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    stub.phase(request, 'lst')
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    await handle.result
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ lst: 'done', end: 'done' })
  })

  it('derives a classify node\'s status from agent-start/agent-end, like an agent node', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph(
      [start(), classify('cls'), end()],
      [edge('start', 'cls'), edge('cls', 'end', 'a'), edge('cls', 'end', 'b')],
    )
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    stub.agentStart(request, { seq: 1, label: 'cls', phase: 'cls', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ cls: 'running' })
    stub.agentEnd(request, { seq: 1, label: 'cls', phase: 'cls', outcome: 'completed', childId: 'c1' as never })
    stub.resultValues.set(request, { cls: { class: 'a' } })
    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    await handle.result
    expect(engine.getRun(handle.runId)).toMatchObject({
      status: 'completed',
      nodeOutputs: { cls: { class: 'a' } },
    })
  })

  it('derives an extract node\'s status from agent-start/agent-end, like an agent node', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph([start(), extract('ex'), end()], [edge('start', 'ex'), edge('ex', 'end')])
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    stub.agentStart(request, { seq: 1, label: 'ex', phase: 'ex', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ ex: 'running' })
    stub.agentEnd(request, { seq: 1, label: 'ex', phase: 'ex', outcome: 'completed', childId: 'c1' as never })
    stub.resultValues.set(request, { ex: { value: 'ok' } })
    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    await handle.result
    expect(engine.getRun(handle.runId)).toMatchObject({ nodeOutputs: { ex: { value: 'ok' } } })
  })

  it('derives a template node\'s status from its phase call, settled by the next node event, mirroring a condition gate', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph(
      [start(), template('tpl'), agent('a'), end()],
      [edge('start', 'tpl'), edge('tpl', 'a'), edge('a', 'end')],
    )
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!

    stub.phase(request, 'tpl')
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ tpl: 'running' })

    stub.agentStart(request, { seq: 1, label: 'a', phase: 'a', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ tpl: 'done', a: 'running' })

    stub.agentEnd(request, { seq: 1, label: 'a', phase: 'a', outcome: 'completed', childId: 'c1' as never })
    stub.resultValues.set(request, { tpl: 'hello', a: 'agent reply' })
    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    await handle.result
    expect(engine.getRun(handle.runId)).toMatchObject({ nodeOutputs: { tpl: 'hello', a: 'agent reply' } })
  })

  it('settles a lingering template gate at workflow/end (template is a terminal)', async () => {
    const { engine, stub, parent } = await setup()
    const g = graph([start(), template('tpl'), end()], [edge('start', 'tpl'), edge('tpl', 'end')])
    const handle = engine.run({ graph: g, parent })
    const request = stub.requests[0]!
    stub.phase(request, 'tpl')
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    await handle.result
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ tpl: 'done', end: 'done' })
  })

  it('throws FLOW_RUN_NOT_FOUND for an unknown stop target', async () => {
    const { engine } = await setup()
    expect(() =>{  engine.stop(FlowRunId('ghost')) }).toThrow(/no flow run "ghost"/)
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

  it('passes the input args and a cancel signal through to the engine', async () => {
    const { engine, stub, parent } = await setup()
    const signal = new AbortController().signal
    engine.run({ graph: linearGraph(), input: { items: [1, 2] }, parent, signal })
    expect(stub.requests[0]!.args).toEqual({ items: [1, 2] })
    expect(stub.requests[0]!.signal).toBe(signal)
  })

  it('cancels a run through the handle with a custom reason', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    handle.cancel('changed my mind')
    expect(stub.cancels).toEqual(['changed my mind'])
    await expect(handle.result).resolves.toEqual({ status: 'cancelled', error: 'changed my mind', agentsStarted: 0 })
  })

  it('cancels a run through the handle with the default reason', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    handle.cancel()
    expect(stub.cancels).toEqual(['cancelled by the user'])
  })

  it('ignores workflow events for runs this service did not start', async () => {
    const { ctx, engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.agentStart(request, { seq: 1, label: 'a', phase: 'a', childId: 'c1' as never })
    // A foreign run id is not in runIdByWorkflow, so every event type returns
    // before touching the tracked run.
    const foreign = { id: WorkflowRunId('foreign'), meta: { name: 'x', description: 'd' } }
    ctx.emit('workflow/phase', foreign, 'ghost')
    ctx.emit('workflow/agent-start', foreign, { seq: 2, label: 'x', phase: 'a', childId: 'c2' as never })
    ctx.emit('workflow/agent-end', foreign, { seq: 2, label: 'x', phase: 'a', outcome: 'completed', childId: 'c2' as never })
    ctx.emit('workflow/node-start', foreign, { seq: 1, phase: 'a' })
    ctx.emit('workflow/node-end', foreign, { seq: 1, phase: 'a', outcome: 'completed' })
    ctx.emit('workflow/end', foreign, { stopReason: 'completed', agentsStarted: 0 })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ a: 'running' })
    expect(engine.getRun(handle.runId)?.status).toBe('running')
  })

  it('is idempotent against a second workflow/end', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    await handle.result
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    expect(engine.getRun(handle.runId)).toMatchObject({ status: 'completed', agentsStarted: 0 })
  })

  it('cancels a node still running when the run settles', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.agentStart(request, { seq: 1, label: 'a', phase: 'a', childId: 'c1' as never })
    // The agent call never settles; the run's end cancels it.
    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    await handle.result
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ a: 'cancelled', end: 'done' })
  })

  it('settles a cancelled agent call as cancelled', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.agentStart(request, { seq: 1, label: 'a', phase: 'a', childId: 'c1' as never })
    stub.agentEnd(request, { seq: 1, label: 'a', phase: 'a', outcome: 'cancelled', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ a: 'cancelled' })
  })

  it('records nodeDurationsMs and nodeOutputs from a completed result OUT map', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.agentStart(request, { seq: 1, label: 'a', phase: 'a', childId: 'c1' as never })
    stub.agentEnd(request, { seq: 1, label: 'a', phase: 'a', outcome: 'completed', childId: 'c1' as never })
    stub.resultValues.set(request, {
      a: 'agent reply',
      ghost: 'ignored unknown id',
      start: { nested: true },
    })
    stub.end(request, { stopReason: 'completed', agentsStarted: 1 })
    await handle.result
    const snapshot = engine.getRun(handle.runId)
    expect(snapshot?.nodeOutputs).toEqual({ a: 'agent reply', start: { nested: true } })
    expect(snapshot?.nodeDurationsMs?.a).toBeGreaterThanOrEqual(0)
  })

  it('skips non-JSON-safe OUT entries when projecting nodeOutputs', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.resultValues.set(request, {
      a: undefined,
      end: () => 'fn',
    })
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    await handle.result
    expect(engine.getRun(handle.runId)?.nodeOutputs).toBeUndefined()
  })

  it('projects null and array OUT entries as JSON-safe node outputs', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.resultValues.set(request, { a: null, end: [1, 'two', true] })
    stub.end(request, { stopReason: 'completed', agentsStarted: 0 })
    await handle.result
    expect(engine.getRun(handle.runId)?.nodeOutputs).toEqual({ a: null, end: [1, 'two', true] })
  })

  it('ignores an agent-end whose phase it does not track', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    stub.agentEnd(request, { seq: 1, label: 'x', phase: 'ghost', outcome: 'completed', childId: 'c1' as never })
    stub.agentEnd(request, { seq: 1, label: 'x', outcome: 'completed', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ a: 'pending' })
  })

  it('settles an agent-end that never saw a matching agent-start', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    // No preceding agentStart, so nodeStartedAt has no entry to clear.
    stub.agentEnd(request, { seq: 1, label: 'a', phase: 'a', outcome: 'completed', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ a: 'done' })
    expect(engine.getRun(handle.runId)?.nodeDurationsMs?.a).toBeUndefined()
  })

  it('ignores an agent-start that carries no phase', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    // The start event omits `phase`, so no node is marked running.
    stub.agentStart(request, { seq: 1, label: 'a', childId: 'c1' as never })
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ a: 'pending' })
  })

  it('ignores a phase for a node it does not gate', async () => {
    const { engine, stub, parent } = await setup()
    const handle = engine.run({ graph: linearGraph(), parent })
    const request = stub.requests[0]!
    // `a` is an agent node, so the phase call opens no gate.
    stub.phase(request, 'a')
    expect(engine.getRun(handle.runId)?.nodeStatuses).toMatchObject({ a: 'pending' })
  })

  it('lists runs filtered to one flow id', async () => {
    const { engine, parent } = await setup()
    engine.run({ graph: linearGraph(), parent })
    const other = graph(
      [start(), agent('b'), end()],
      [edge('start', 'b'), edge('b', 'end')],
      { id: 'other-flow', name: 'Other' },
    )
    engine.run({ graph: other, parent })
    const filtered = engine.listRuns('other-flow')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.flowId).toBe('other-flow')
    expect(engine.listRuns()).toHaveLength(2)
  })

  it('disposes live runs when the composition unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    const flowFiber = await ctx.plugin(FlowEngine, { maxLiveRuns: 2, maxRunHistory: 2 })
    const engine = ctx.flowEngine
    const stub = ctx.workflowEngine as StubEngine
    const parent = {} as unknown as Agent
    engine.run({ graph: linearGraph(), parent })
    expect(stub.disposedRuns).toBe(0)
    // Unloading the composition disposes the flow engine's fiber, whose
    // ctx.effect teardown disposes every live holder-owned WorkflowRun.
    await flowFiber.dispose()
    expect(stub.disposedRuns).toBe(1)
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
    engine = ctx.flowEngine
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('saves, lists, reads, and deletes flows under .dsh/flows', async () => {
    const g = linearGraph()
    await engine.save(root, g)
    expect(await engine.list(root)).toEqual([
      { id: 'demo-flow', name: 'Demo', nodeCount: 3, updatedAt: expect.any(Number) as number },
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
