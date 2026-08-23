/**
 * The flow-engine Service Definition: compiles a visual {@link FlowGraph}
 * into a workflow script, runs it off-loop via `workflowEngine`, and derives a
 * per-node run surface from the engine's `workflow/*` events.
 *
 * The run surface is event-derived, not engine-inspected: agent nodes move
 * `pending → running → done/failed/cancelled` from `workflow/agent-start` and
 * `workflow/agent-end`; condition/loop gates (which have no child event) are
 * marked `running` by their `phase()` call and settled by the next node event
 * or by `workflow/end`. The service emits no events of its own — the canvas
 * polls `getRun` for live status, so no `API_REMOTE_FORWARDED_EVENTS` row is
 * required for v1.
 * @module @deepseek-ai/dsh-flow/service
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowResultInfo, WorkflowRunInfo } from '@deepseek-ai/dsh-workflow'
import type { WorkflowEngine, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { compileFlow } from './compile.ts'
import { FlowError } from './error.ts'
import { expandGraph } from './expand.ts'
import { deleteFlowFile, listFlowFiles, readFlowFile, writeFlowFile } from './persistence.ts'
import { FlowRunId, type FlowGraph, type FlowNodeStatus, type FlowNodeType, type FlowRunId as FlowRunIdType, type FlowRunSnapshot, type FlowRunStatus, type FlowRunSummary, type FlowSummary } from './types.ts'
import { validateFlow } from './validate.ts'

/** Deployment-tunable flow-engine bounds (validated `Config`, never literals). */
export interface FlowEngineConfig {
  /** Cap on concurrently running flow runs. */
  maxLiveRuns: number
  /** Cap on settled runs kept in memory for `listRuns`/`getRun`. */
  maxRunHistory: number
}

/** What a caller asks for when starting a flow run. */
export interface FlowRunRequest {
  /** The graph to compile and execute. */
  graph: FlowGraph
  /** Optional input exposed to the script as the `args` global. */
  input?: unknown
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}

/** How a flow run settled, as the handle's resolved promise (never rejects). */
export interface FlowRunOutcome {
  readonly status: Exclude<FlowRunStatus, 'running'>
  /** Failure or cancellation text, present when the run ended with a message. */
  readonly error?: string
  /** How many `agent()` calls the run accepted. */
  readonly agentsStarted: number
}

/** Holder-owned live flow run: a settled outcome promise plus cancellation. */
export interface FlowRunHandle {
  readonly runId: FlowRunIdType
  /** Resolves when the run settles (never rejects). */
  readonly result: Promise<FlowRunOutcome>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
}

/** One live or settled run the service tracks. */
interface RunEntry {
  readonly runId: FlowRunIdType
  readonly flowId: string
  readonly flowName: string
  readonly workflowRun: WorkflowRun
  readonly startedAt: number
  readonly nodeTypes: Map<string, FlowNodeType>
  readonly nodeStatuses: Map<string, FlowNodeStatus>
  status: FlowRunStatus
  stopReason?: 'completed' | 'cancelled' | 'error'
  error: string | undefined
  agentsStarted: number
  /** The condition/loop whose `phase()` fired but whose branch has not yet produced a node event. */
  activeGate: { readonly nodeId: string } | undefined
}

/**
 * The flow-engine service. Requires the `workflowEngine` service in the same
 * composition; a composition mounting the flow engine without it fails loud at
 * load rather than resolving an empty run surface.
 */
export class FlowEngine extends Service {
  /** The engine's children execute through this service; the Loader defers this mount until it exists. */
  static inject = ['workflowEngine']

  static Config = z.object({
    maxLiveRuns: z.number().default(20),
    maxRunHistory: z.number().default(100),
  }) as z<FlowEngineConfig>

  private readonly workflow: WorkflowEngine
  private readonly config: FlowEngineConfig
  private readonly runs = new Map<FlowRunIdType, RunEntry>()
  private readonly runIdByWorkflow = new Map<string, FlowRunIdType>()
  private readonly outcomeResolvers = new Map<FlowRunIdType, (outcome: FlowRunOutcome) => void>()

  constructor(ctx: Context, config: FlowEngineConfig) {
    super(ctx, 'flowEngine')
    this.config = config
    const workflow = ctx.get('workflowEngine')
    if (workflow === undefined) {
      throw new FlowError('@deepseek-ai/dsh-flow requires @deepseek-ai/dsh-workflow in the composition (no workflowEngine service)', 'FLOW_ENGINE_ABSENT')
    }
    this.workflow = workflow
    // The engine dispatches `workflow/*` with no `this`, so every app-wide
    // listener fires regardless of mount position; `global: true` matches the
    // workflow package's own invariant listeners and survives a future
    // `this`-bound dispatch. Runs this service did not start are skipped by
    // `runIdByWorkflow`.
    ctx.on('workflow/phase', (info, title) => this.onPhase(info, title), { global: true })
    ctx.on('workflow/agent-start', (info, agent) => this.onAgentStart(info, agent), { global: true })
    ctx.on('workflow/agent-end', (info, agent) => this.onAgentEnd(info, agent), { global: true })
    ctx.on('workflow/end', (info, result) => this.onWorkflowEnd(info, result), { global: true })
    // The engine's `WorkflowRun` handles are holder-owned: the seam requires
    // the holder to dispose each run, or the underlying worker thread outlives
    // the composition and pins the process at teardown. Unloading the flow
    // engine abandons its live runs, so dispose them all here; each run's
    // settlement already disposes it too, so this only covers in-flight runs.
    ctx.effect(() => {
      return () => {
        for (const entry of this.runs.values()) void entry.workflowRun.dispose()
      }
    }, 'dsh-flow: dispose live runs on unload')
  }

  /**
   * Compile and start a flow run.
   * @param request - the graph, optional `args`, the parent agent, and an
   *   optional cancel signal.
   * @returns the live-run handle; its `result` resolves when the run settles.
   * @throws {@link FlowError} with `FLOW_INVALID` for an invalid graph and
   *   `FLOW_CAP` when the live-run bound is reached.
   */
  run(request: FlowRunRequest): FlowRunHandle {
    const { graph, input, parent, signal } = request
    const validation = validateFlow(graph)
    if (!validation.ok) {
      throw new FlowError(`flow is invalid: ${validation.errors.join('; ')}`, 'FLOW_INVALID')
    }
    const live = [...this.runs.values()].filter(run => run.status === 'running').length
    if (live >= this.config.maxLiveRuns) {
      throw new FlowError(`refusing to start a flow run: already ${live} live runs (max ${this.config.maxLiveRuns})`, 'FLOW_CAP')
    }
    const { script, meta } = compileFlow(graph)
    const workflowRun = this.workflow.start({
      script,
      meta,
      parent,
      ...(input === undefined ? {} : { args: input }),
      ...(signal === undefined ? {} : { signal }),
    })
    const runId = FlowRunId(randomUUID())
    // The run surface keys on the expanded id set (a sub-graph's nodes carry
    // their namespaced ids), and the owner map identifies the root start — the
    // only start reached when the run begins.
    const expanded = expandGraph(graph)
    const nodeTypes = new Map(expanded.graph.nodes.map(node => [node.id, node.type]))
    const nodeStatuses = new Map<string, FlowNodeStatus>()
    for (const node of expanded.graph.nodes) nodeStatuses.set(node.id, 'pending')
    nodeStatuses.set(
      expanded.graph.nodes.find(node => node.type === 'start' && expanded.owner.get(node.id) === node.id)?.id ?? '',
      'done',
    )
    const entry: RunEntry = {
      runId,
      flowId: graph.id,
      flowName: graph.name,
      workflowRun,
      startedAt: Date.now(),
      nodeTypes,
      nodeStatuses,
      status: 'running',
      error: undefined,
      agentsStarted: 0,
      activeGate: undefined,
    }
    this.runs.set(runId, entry)
    this.runIdByWorkflow.set(workflowRun.id, runId)
    let resolveOutcome: (outcome: FlowRunOutcome) => void = () => {}
    const result = new Promise<FlowRunOutcome>((resolve) => {
      resolveOutcome = resolve
    })
    this.outcomeResolvers.set(runId, resolveOutcome)
    return {
      runId,
      result,
      cancel: (reason?: string) => workflowRun.cancel(reason ?? 'cancelled by the user'),
    }
  }

  /**
   * Cancel a live run.
   * @param runId - the run to cancel.
   * @throws {@link FlowError} with `FLOW_RUN_NOT_FOUND` for an unknown run.
   */
  stop(runId: FlowRunIdType): void {
    const entry = this.runs.get(runId)
    if (entry === undefined) throw new FlowError(`no flow run "${runId}"`, 'FLOW_RUN_NOT_FOUND')
    entry.workflowRun.cancel('cancelled by the user')
  }

  /**
   * List tracked runs, newest first.
   * @param flowId - optional filter to one flow.
   * @returns the run summaries (live runs first, then settled within the
   *   history bound).
   */
  listRuns(flowId?: string): FlowRunSummary[] {
    return [...this.runs.values()]
      .filter(run => flowId === undefined || run.flowId === flowId)
      .map(run => ({
        runId: run.runId,
        flowId: run.flowId,
        flowName: run.flowName,
        status: run.status,
        startedAt: run.startedAt,
      }))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  /**
   * Read one run's live snapshot.
   * @param runId - the run to read.
   * @returns the snapshot, or `undefined` for an unknown or pruned run.
   */
  getRun(runId: FlowRunIdType): FlowRunSnapshot | undefined {
    const entry = this.runs.get(runId)
    if (entry === undefined) return undefined
    return {
      runId: entry.runId,
      flowId: entry.flowId,
      flowName: entry.flowName,
      status: entry.status,
      ...(entry.stopReason === undefined ? {} : { stopReason: entry.stopReason }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
      agentsStarted: entry.agentsStarted,
      nodeStatuses: Object.fromEntries(entry.nodeStatuses),
    }
  }

  /**
   * Validate and persist a flow under `<root>/.dsh/flows/<id>.flow.json`.
   * @param root - the owning project root.
   * @param graph - the graph to save.
   * @returns the graph, unchanged.
   * @throws {@link FlowError} with `FLOW_INVALID` for an invalid graph.
   */
  async save(root: string, graph: FlowGraph): Promise<FlowGraph> {
    const validation = validateFlow(graph)
    if (!validation.ok) {
      throw new FlowError(validation.errors.join('; '), 'FLOW_INVALID')
    }
    await writeFlowFile(root, graph)
    return graph
  }

  /**
   * List the flows saved under `<root>/.dsh/flows`.
   * @param root - the owning project root.
   * @returns the flow summaries.
   */
  async list(root: string): Promise<FlowSummary[]> {
    return listFlowFiles(root)
  }

  /**
   * Read one saved flow.
   * @param root - the owning project root.
   * @param flowId - the flow's id.
   * @returns the validated graph.
   * @throws {@link FlowError} with `FLOW_NOT_FOUND`, `FLOW_VERSION`, or
   *   `FLOW_INVALID`.
   */
  async get(root: string, flowId: string): Promise<FlowGraph> {
    return readFlowFile(root, flowId)
  }

  /**
   * Delete one saved flow.
   * @param root - the owning project root.
   * @param flowId - the flow's id.
   * @throws {@link FlowError} with `FLOW_NOT_FOUND` when no such flow exists.
   */
  async delete(root: string, flowId: string): Promise<void> {
    return deleteFlowFile(root, flowId)
  }

  /** Settle the gate a phase opened and open the next one, for a condition/loop. */
  private onPhase(info: WorkflowRunInfo, title: string): void {
    const runId = this.runIdFor(info.id)
    if (runId === undefined) return
    const entry = this.runs.get(runId)
    if (entry === undefined) return
    this.clearGate(entry)
    if (entry.nodeTypes.get(title) === 'condition' || entry.nodeTypes.get(title) === 'loop') {
      entry.nodeStatuses.set(title, 'running')
      entry.activeGate = { nodeId: title }
    }
  }

  /** Mark an agent node `running`, settling the preceding gate. */
  private onAgentStart(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void {
    const runId = this.runIdFor(info.id)
    if (runId === undefined) return
    const entry = this.runs.get(runId)
    if (entry === undefined) return
    this.clearGate(entry)
    if (agent.phase !== undefined && entry.nodeTypes.has(agent.phase)) {
      entry.nodeStatuses.set(agent.phase, 'running')
    }
  }

  /** Settle one agent node by its call outcome. */
  private onAgentEnd(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void {
    const runId = this.runIdFor(info.id)
    if (runId === undefined) return
    const entry = this.runs.get(runId)
    if (entry === undefined) return
    if (agent.phase === undefined || !entry.nodeTypes.has(agent.phase)) return
    const status: FlowNodeStatus = agent.outcome === 'completed' ? 'done' : agent.outcome === 'failed' ? 'failed' : 'cancelled'
    entry.nodeStatuses.set(agent.phase, status)
  }

  /** Settle the run, resolve the handle's outcome, and prune the history bound. */
  private onWorkflowEnd(info: WorkflowRunInfo, result: WorkflowResultInfo): void {
    const runId = this.runIdFor(info.id)
    if (runId === undefined) return
    const entry = this.runs.get(runId)
    if (entry === undefined) return
    if (entry.status !== 'running') return // already settled (idempotent guard)
    entry.status = result.stopReason
    entry.stopReason = result.stopReason
    entry.error = result.error
    entry.agentsStarted = result.agentsStarted
    this.clearGate(entry)
    // A parallel branch or gate that never produced a node event is cancelled
    // by the settlement.
    for (const [id, status] of entry.nodeStatuses) {
      if (status === 'running') entry.nodeStatuses.set(id, 'cancelled')
    }
    for (const [id, type] of entry.nodeTypes) {
      if (type === 'end') entry.nodeStatuses.set(id, 'done')
    }
    const resolve = this.outcomeResolvers.get(runId)
    if (resolve !== undefined) {
      resolve({
        status: result.stopReason,
        ...(result.error === undefined ? {} : { error: result.error }),
        agentsStarted: result.agentsStarted,
      })
      this.outcomeResolvers.delete(runId)
    }
    // The run's worker is no longer needed once settled: every field
    // `getRun`/`listRuns` reads lives on this entry, so dispose the holder-owned
    // `WorkflowRun` to release its thread (the seam's `dispose()` is idempotent).
    void entry.workflowRun.dispose()
    this.pruneHistory()
  }

  /** Map a workflow run id to the flow run this service started, if any. */
  private runIdFor(workflowRunId: string): FlowRunIdType | undefined {
    return this.runIdByWorkflow.get(workflowRunId)
  }

  /** Settle the pending condition/loop gate, if one is open. */
  private clearGate(entry: RunEntry): void {
    if (entry.activeGate !== undefined) {
      entry.nodeStatuses.set(entry.activeGate.nodeId, 'done')
      entry.activeGate = undefined
    }
  }

  /** Drop the oldest settled runs beyond `maxRunHistory`. */
  private pruneHistory(): void {
    const settled = [...this.runs.entries()].filter(([, run]) => run.status !== 'running')
    if (settled.length <= this.config.maxRunHistory) return
    const excess = settled.length - this.config.maxRunHistory
    for (const [runId, run] of settled.sort((a, b) => a[1].startedAt - b[1].startedAt).slice(0, excess)) {
      this.runs.delete(runId)
      this.runIdByWorkflow.delete(run.workflowRun.id)
      this.outcomeResolvers.delete(runId)
    }
  }
}
