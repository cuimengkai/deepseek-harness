/**
 * Flow-editor controller: owns the authored graph, the flows directory, and
 * the live-run surface for one session. Graph mutations are pure functions
 * over {@link FlowGraph} (unit-testable without a wire); every RPC refusal
 * folds into an unavailable (no engine) or an error state the view renders.
 * Runs poll the host's snapshot until they settle; the poll timer is the
 * controller's only retained handle and is cleared by
 * {@link FlowEditorController.dispose}.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  FlowAgentNode, FlowAgentOptions, FlowGraph, FlowModelKindBinding, FlowNode, FlowNodeStatus, FlowNodeType,
  FlowRunSnapshot, FlowRunSummary, FlowSummary,
} from '@deepseek-ai/dsh-flow/types'

/** How often a live run's snapshot is re-read. */
export const POLL_INTERVAL_MS = 800

/** The wire error code the host answers when no flow engine is mounted. */
export const FLOW_UNAVAILABLE = 'flow-unavailable'

/** The error sentinel for a run whose input text is not valid JSON; the view localizes it. */
export const RUN_INPUT_INVALID = 'run.inputInvalid'

/** A model kind the canvas can bind (mirrors `ModelKind` without a dsh-llm dependency). */
export type FlowModelKind = keyof NonNullable<FlowAgentOptions['modelKinds']>

/** Why a connect gesture was refused. */
export type AddEdgeReason =
  | 'self-loop'
  | 'duplicate'
  | 'condition-full'
  | 'loop-full'

/** The result of one connect gesture. */
export type AddEdgeResult = { ok: true; graph: FlowGraph } | { ok: false; reason: AddEdgeReason }

/** A wire refusal: envelope error, or `null` when the transport rejected instead. */
type FlowWireError = { code: string; message: string } | null

/** The branch labels a branching node's outgoing edges may carry, in connect order. */
const CONDITION_LABELS = ['true', 'false'] as const
const LOOP_LABELS = ['body', 'after'] as const

/** A node type the palette offers (start/end are structural, created with the flow). */
export type PaletteNodeType = Extract<FlowNodeType, 'agent' | 'condition' | 'loop'>

/** The authored-fresh fields a palette node may carry, keyed by type. */
type NodeDefaults = Partial<Record<'prompt' | 'expression' | 'iterable' | 'variable', string>>

const DEFAULT_NODE: Record<PaletteNodeType, NodeDefaults> = {
  agent: { prompt: 'Describe the agent task.' },
  condition: { expression: 'args.flag === true' },
  loop: { iterable: 'args.items', variable: 'item' },
}

/** Brand-less starter graph for a session with no saved flows yet. */
export function starterGraph(): FlowGraph {
  return {
    id: 'starter',
    name: 'Untitled Flow',
    description: 'Start editing: add agents, a condition, or a loop.',
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      { id: 'agent-1', type: 'agent', position: { x: 220, y: 0 }, prompt: 'Describe the agent task.' },
      { id: 'end', type: 'end', position: { x: 440, y: 0 } },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'agent-1' },
      { id: 'e2', from: 'agent-1', to: 'end' },
    ],
  }
}

/** A unique node id for one type: `agent-1`, `condition-2`, and so on. */
export function nextNodeId(graph: FlowGraph, type: FlowNodeType): string {
  if (type === 'start') return 'start'
  if (type === 'end') return 'end'
  const count = graph.nodes.filter(node => node.type === type).length
  return `${type}-${count + 1}`
}

/** A unique edge id (`e1`, `e2`, ...). */
export function nextEdgeId(graph: FlowGraph): string {
  let index = graph.edges.length + 1
  while (graph.edges.some(edge => edge.id === `e${index}`)) index += 1
  return `e${index}`
}

/** The next branch label a condition/loop source may take, if any remains. */
export function nextBranchLabel(graph: FlowGraph, from: string): string | undefined {
  const source = graph.nodes.find(node => node.id === from)
  const labels = source?.type === 'condition' ? CONDITION_LABELS
    : source?.type === 'loop' ? LOOP_LABELS
      : []
  const taken = new Set(graph.edges.filter(edge => edge.from === from).map(edge => edge.label))
  return labels.find(label => !taken.has(label))
}

/** Append one node at a given position, returning the new graph. */
export function addNode(graph: FlowGraph, type: FlowNodeType, position: { x: number; y: number }): FlowGraph {
  const id = nextNodeId(graph, type)
  // The union's variant is chosen by `type`, which a property spread cannot
  // express statically, so each narrowed branch asserts the known-good node.
  const node: FlowNode = type === 'agent' || type === 'condition' || type === 'loop'
    ? { ...DEFAULT_NODE[type], id, type, position } as FlowNode
    : { id, type, position }
  return { ...graph, nodes: [...graph.nodes, node] }
}

/** Move one node, returning the new graph. */
export function moveNode(graph: FlowGraph, nodeId: string, position: { x: number; y: number }): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(node => node.id === nodeId ? { ...node, position } : node),
  }
}

/** Patch one node's authored fields, returning the new graph. */
export function updateNode(graph: FlowGraph, nodeId: string, patch: Partial<FlowNode>): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(node => node.id === nodeId ? { ...node, ...patch } as FlowNode : node),
  }
}

/** Remove one node and every edge touching it, returning the new graph. */
export function removeNode(graph: FlowGraph, nodeId: string): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter(node => node.id !== nodeId),
    edges: graph.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId),
  }
}

/**
 * Connect two nodes. A condition/loop source takes its next free branch label
 * (`true`/`false`, `body`/`after`) and refuses once both labels are taken;
 * an unlabeled edge is refused when the pair already exists. Self-loops are
 * never drawn.
 */
export function tryAddEdge(graph: FlowGraph, from: string, to: string): AddEdgeResult {
  if (from === to) return { ok: false, reason: 'self-loop' }
  const source = graph.nodes.find(node => node.id === from)
  const sourceType = source?.type
  const branching = sourceType === 'condition' || sourceType === 'loop'
  const label = branching ? nextBranchLabel(graph, from) : undefined
  if (branching && label === undefined) {
    return { ok: false, reason: sourceType === 'condition' ? 'condition-full' : 'loop-full' }
  }
  const duplicate = graph.edges.some(edge => edge.from === from && edge.to === to && edge.label === label)
  if (duplicate) return { ok: false, reason: 'duplicate' }
  return {
    ok: true,
    graph: {
      ...graph,
      edges: [...graph.edges, { id: nextEdgeId(graph), from, to, ...(label === undefined ? {} : { label }) }],
    },
  }
}

/** Remove one edge, returning the new graph. */
export function removeEdge(graph: FlowGraph, edgeId: string): FlowGraph {
  return { ...graph, edges: graph.edges.filter(edge => edge.id !== edgeId) }
}

/** A kebab-case flow id derived from the display name, or `flow`. */
export function kebabId(name: string): string {
  const kebab = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return kebab.length === 0 ? 'flow' : kebab
}

/** A fresh flow id unique against the saved directory. */
export function uniqueFlowId(name: string, flows: readonly FlowSummary[]): string {
  const base = kebabId(name)
  if (!flows.some(flow => flow.id === base)) return base
  let suffix = 2
  while (flows.some(flow => flow.id === `${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/** The canvas position a freshly added node lands at: right of the rightmost node, staggered by row. */
export function cascadePosition(graph: FlowGraph): { x: number; y: number } {
  const rightmost = graph.nodes.reduce((max, node) => Math.max(max, node.position.x), 0)
  const row = graph.nodes.filter(node => node.position.x === rightmost).length
  return { x: rightmost + 240, y: (row - 1) * 40 }
}

/** Human text for a rejected connect, keyed for the view to localize. */
export function addEdgeError(reason: AddEdgeReason): string {
  switch (reason) {
    case 'self-loop': return 'Cannot connect a node to itself.'
    case 'duplicate': return 'This connection already exists.'
    case 'condition-full': return 'The condition already has both branches (true, false).'
    case 'loop-full': return 'The loop already has both branches (body, after).'
  }
}

/** The live-run state one session's canvas tracks. */
export interface FlowEditorState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'running' | 'unavailable' | 'error'
  /** The last failure message, or a transient refusal (invalid run input, refused connect). */
  error: string | null
  flows: readonly FlowSummary[]
  /** The selected flow's id; empty while the draft is not yet saved. */
  flowId: string
  graph: FlowGraph | null
  dirty: boolean
  selectedNodeId: string | null
  selectedEdgeId: string | null
  /** The settled-or-live snapshot of the most recent run, when any. */
  run: FlowRunSnapshot | null
  runs: readonly FlowRunSummary[]
  inputText: string
  /** Per-node status of the most recent run, when any. */
  nodeStatuses: Readonly<Record<string, FlowNodeStatus>> | null
}

const INITIAL: FlowEditorState = {
  status: 'idle',
  error: null,
  flows: [],
  flowId: '',
  graph: null,
  dirty: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  run: null,
  runs: [],
  inputText: '{}',
  nodeStatuses: null,
}

/** The folded outcome of one flow wire call. */
type FlowCallResult<T> = { ok: true; value: T } | { ok: false; error: FlowWireError }

/** Await one unary flow call and fold both refusal shapes into one result. */
async function flowCall<T>(
  call: () => Promise<{ result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }>,
): Promise<FlowCallResult<T>> {
  let response: { result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }
  try {
    response = await call()
  } catch {
    // The transport rejected rather than answering; the caller renders its
    // fallback text in the canvas error strip.
    return { ok: false, error: null }
  }
  return response.result.ok ? { ok: true, value: response.result.value } : { ok: false, error: response.result.error }
}

/** The controller for one session's flow canvas. */
export class FlowEditorController {
  /** Canvas snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<FlowEditorState> = createSnapshotStore(INITIAL)

  private loadedCwd: string | undefined
  private runId: string | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined

  /**
   * @param api - the flow wire face.
   * @param sessionId - the session the canvas belongs to (run attribution).
   * @param getCwd - the session's workspace root, read reactively so a
   *   workspace switch reloads the canvas.
   */
  constructor(
    private readonly api: IApiClient,
    private readonly sessionId: SessionId,
    private readonly getCwd: () => string | undefined,
  ) {}

  private set(patch: Partial<FlowEditorState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /** Fold a refusal into an `unavailable` (no engine) or an `error` state for load-time failures. */
  private fail(error: FlowWireError, fallback: string): Pick<FlowEditorState, 'status' | 'error'> {
    return error?.code === FLOW_UNAVAILABLE
      ? { status: 'unavailable', error: null }
      : { status: 'error', error: error?.message ?? fallback }
  }

  /** Fold a refusal into an `unavailable` (no engine) or a `ready` state with the message. */
  private failReady(error: FlowWireError, fallback: string): Pick<FlowEditorState, 'status' | 'error'> {
    return error?.code === FLOW_UNAVAILABLE
      ? { status: 'unavailable', error: null }
      : { status: 'ready', error: error?.message ?? fallback }
  }

  /**
   * Load the flows directory for the session's workspace and open the most
   * recently saved flow (or an unsaved starter when the directory is empty).
   * A session with no workspace or a load already in flight is a no-op.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const cwd = this.getCwd()
    if (cwd === undefined) return
    const before = this.store.getSnapshot()
    if (before.status === 'loading') return
    if (this.loadedCwd === cwd && !before.dirty) return
    this.set({ status: 'loading', error: null })
    const listed = await flowCall(() => this.api.flow.list({ cwd }))
    if (!listed.ok) {
      this.set({ ...this.fail(listed.error, 'flow.list failed'), graph: null, flowId: '', flows: [] })
      return
    }
    const flows = listed.value.flows
    const [latest] = [...flows].sort((a, b) => b.updatedAt - a.updatedAt)
    if (latest === undefined) {
      this.set({ status: 'ready', flows, graph: starterGraph(), flowId: '', dirty: true, error: null })
    } else {
      const fetched = await flowCall(() => this.api.flow.get({ cwd, id: latest.id }))
      this.set(fetched.ok
        ? { status: 'ready', flows, graph: fetched.value, flowId: latest.id, dirty: false, error: null }
        : { ...this.fail(fetched.error, 'flow.get failed'), flows, graph: null, flowId: '', dirty: false })
    }
    this.loadedCwd = cwd
    void this.refreshRuns(this.store.getSnapshot().flowId)
  }

  /** Open one saved flow by id. */
  async selectFlow(id: string): Promise<void> {
    const cwd = this.getCwd()
    if (cwd === undefined) return
    const fetched = await flowCall(() => this.api.flow.get({ cwd, id }))
    if (!fetched.ok) {
      this.set(this.failReady(fetched.error, 'flow.get failed'))
      return
    }
    this.set({ graph: fetched.value, flowId: id, dirty: false, error: null, selectedNodeId: null, selectedEdgeId: null })
    void this.refreshRuns(id)
  }

  /** Start a fresh unsaved draft. */
  newFlow(): void {
    this.set({
      graph: starterGraph(), flowId: '', dirty: true, status: 'ready',
      selectedNodeId: null, selectedEdgeId: null, error: null,
    })
  }

  /** Persist the draft, minting a directory-unique id for a first save. */
  async save(): Promise<void> {
    const cwd = this.getCwd()
    const { graph, flowId } = this.store.getSnapshot()
    if (cwd === undefined || graph === null) return
    this.set({ status: 'saving', error: null })
    const id = flowId === '' ? uniqueFlowId(graph.name, this.store.getSnapshot().flows) : flowId
    const saved: FlowGraph = { ...graph, id, name: graph.name.trim().length === 0 ? id : graph.name }
    const result = await flowCall(() => this.api.flow.save({ cwd, graph: saved }))
    if (!result.ok) {
      this.set(this.failReady(result.error, 'flow.save failed'))
      return
    }
    this.set({ graph: saved, flowId: id, dirty: false, status: 'ready', error: null })
    const listed = await flowCall(() => this.api.flow.list({ cwd }))
    if (listed.ok) this.set({ flows: listed.value.flows })
    void this.refreshRuns(id)
  }

  /** Delete one saved flow; the current draft falls back to a fresh one. */
  async deleteFlow(id: string): Promise<void> {
    const cwd = this.getCwd()
    if (cwd === undefined) return
    await flowCall(() => this.api.flow.delete({ cwd, id }))
    const listed = await flowCall(() => this.api.flow.list({ cwd }))
    const { flowId } = this.store.getSnapshot()
    if (!listed.ok) return
    this.set({ flows: listed.value.flows })
    if (flowId === id) {
      this.set({ graph: starterGraph(), flowId: '', dirty: true, selectedNodeId: null, selectedEdgeId: null })
    }
  }

  /** Add a palette node at the cascade position and select it. */
  addNode(type: PaletteNodeType): void {
    const graph = this.store.getSnapshot().graph
    if (graph === null) return
    this.addNodeAt(type, cascadePosition(graph))
  }

  /**
   * Add a palette node at an explicit graph position (clamped to the origin)
   * and select it. Only the palette's node types are placed; a drop payload
   * carrying anything else is refused.
   * @param data - the palette drop payload: one of the palette node types.
   * @param position - graph-space position; a negative drop clamps to 0.
   */
  addNodeAt(data: string, position: { x: number; y: number }): void {
    if (data !== 'agent' && data !== 'condition' && data !== 'loop') return
    const type: PaletteNodeType = data
    const graph = this.store.getSnapshot().graph
    if (graph === null) return
    const id = nextNodeId(graph, type)
    const next = addNode(graph, type, { x: Math.max(0, position.x), y: Math.max(0, position.y) })
    this.set({ graph: next, dirty: true, selectedNodeId: id, selectedEdgeId: null, error: null })
  }

  /** Move one node, marking the draft dirty. */
  moveNode(nodeId: string, position: { x: number; y: number }): void {
    const graph = this.store.getSnapshot().graph
    if (graph === null) return
    this.set({ graph: moveNode(graph, nodeId, position), dirty: true })
  }

  /** Patch one node's authored fields. */
  updateNode(nodeId: string, patch: Partial<FlowNode>): void {
    const graph = this.store.getSnapshot().graph
    if (graph === null) return
    this.set({ graph: updateNode(graph, nodeId, patch), dirty: true, error: null })
  }

  /**
   * Set an agent node's plain delegation route. Empty provider/model strings
   * drop their key — the engine emits a provider/model only when present, so a
   * cleared field must remove the key rather than send an empty value.
   * Existing per-kind routes are preserved.
   */
  updateAgentOptions(nodeId: string, provider: string, model: string): void {
    const current = this.agentOptionsOf(nodeId)
    const trimmedProvider = provider.trim()
    const trimmedModel = model.trim()
    this.setAgentOptions(nodeId, {
      ...(current?.modelKinds === undefined ? {} : { modelKinds: current.modelKinds }),
      ...(trimmedProvider.length > 0 ? { provider: trimmedProvider } : {}),
      ...(trimmedModel.length > 0 ? { model: trimmedModel } : {}),
    })
  }

  /**
   * Set one model kind's route field. An empty value removes that field — the
   * engine rejects empty strings, so a cleared provider must leave just the
   * model. The kind's route is removed when both fields are empty; clearing
   * the last kind removes `modelKinds` entirely. Untouched kinds keep their
   * routes.
   */
  updateAgentModelKind(nodeId: string, kind: FlowModelKind, field: 'provider' | 'model', value: string): void {
    const current = this.agentOptionsOf(nodeId)
    const trimmed = value.trim()
    const bind = { ...current?.modelKinds?.[kind] }
    if (field === 'provider') delete bind.provider
    else delete bind.model
    const next: FlowModelKindBinding = trimmed.length > 0 ? { ...bind, [field]: trimmed } : bind
    const existing = current?.modelKinds
    const kinds: Partial<Record<FlowModelKind, FlowModelKindBinding>> = {}
    for (const key of Object.keys(existing ?? {})) {
      if (key === kind) continue
      const binding = existing?.[key as FlowModelKind]
      if (binding !== undefined) kinds[key as FlowModelKind] = binding
    }
    if ((next.provider ?? '').length > 0 || (next.model ?? '').length > 0) {
      kinds[kind] = next
    }
    this.setAgentOptions(nodeId, {
      ...(current?.provider === undefined ? {} : { provider: current.provider }),
      ...(current?.model === undefined ? {} : { model: current.model }),
      ...(Object.keys(kinds).length === 0 ? {} : { modelKinds: kinds }),
    })
  }

  /** The agent node's current delegation options, or undefined when absent. */
  private agentOptionsOf(nodeId: string): FlowAgentOptions | undefined {
    const graph = this.store.getSnapshot().graph
    if (graph === null) return undefined
    const node = graph.nodes.find(
      (candidate): candidate is FlowAgentNode => candidate.id === nodeId && candidate.type === 'agent',
    )
    return node?.agentOptions
  }

  /** Replace an agent node's delegation options wholesale, dropping the key when every field is empty. */
  private setAgentOptions(nodeId: string, options: FlowAgentOptions): void {
    const graph = this.store.getSnapshot().graph
    if (graph === null) return
    const hasContent = Object.values(options).some(value =>
      value === undefined ? false
        : typeof value === 'string' ? value.length > 0
          : Object.keys(value as object).length > 0)
    const next: FlowGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.id !== nodeId || node.type !== 'agent') return node
        const { agentOptions: _dropped, ...rest } = node
        return hasContent ? { ...rest, agentOptions: options } : rest
      }),
    }
    this.set({ graph: next, dirty: true, error: null })
  }

  /** Remove one node and its edges. */
  removeNode(nodeId: string): void {
    const graph = this.store.getSnapshot().graph
    if (graph === null) return
    this.set({
      graph: removeNode(graph, nodeId),
      dirty: true,
      selectedNodeId: null,
      selectedEdgeId: null,
      error: null,
    })
  }

  /** Connect two nodes; a refused gesture surfaces the reason as the canvas error. */
  addEdge(from: string, to: string): void {
    const graph = this.store.getSnapshot().graph
    if (graph === null) return
    const result = tryAddEdge(graph, from, to)
    if (result.ok) {
      this.set({ graph: result.graph, dirty: true, error: null })
    } else {
      this.set({ error: addEdgeError(result.reason) })
    }
  }

  /** Remove one edge. */
  removeEdge(edgeId: string): void {
    const graph = this.store.getSnapshot().graph
    if (graph === null) return
    this.set({ graph: removeEdge(graph, edgeId), dirty: true, selectedEdgeId: null, error: null })
  }

  selectNode(nodeId: string | null): void {
    this.set({ selectedNodeId: nodeId, selectedEdgeId: null })
  }

  selectEdge(edgeId: string | null): void {
    this.set({ selectedEdgeId: edgeId, selectedNodeId: null })
  }

  setInputText(text: string): void {
    this.set({ inputText: text })
  }

  /**
   * Start a run of the current draft and poll the host's snapshot until it
   * settles. The input text is parsed as JSON first; a parse failure refuses
   * the run and surfaces the message.
   * @returns once the run started (not settled).
   */
  async run(): Promise<void> {
    const cwd = this.getCwd()
    const { graph, inputText } = this.store.getSnapshot()
    if (cwd === undefined || graph === null) return
    let input: unknown
    try {
      input = JSON.parse(inputText)
    } catch {
      this.set({ error: RUN_INPUT_INVALID })
      return
    }
    this.set({
      status: 'running',
      error: null,
      run: null,
      nodeStatuses: Object.fromEntries(graph.nodes.map(node => [node.id, 'pending'])),
    })
    const result = await flowCall(() => this.api.flow.run({ sessionId: this.sessionId, graph, input }))
    if (!result.ok) {
      this.set(this.failReady(result.error, 'flow.run failed'))
      return
    }
    this.runId = result.value.runId
    this.startPolling(result.value.runId)
  }

  /** Cancel the live run; its snapshot settles through the poll. */
  async stop(): Promise<void> {
    const runId = this.runId
    if (runId === undefined) return
    await flowCall(() => this.api.flow.stop({ runId }))
  }

  /** Re-read the runs directory for the current flow. */
  async refreshRuns(flowId: string): Promise<void> {
    const result = await flowCall(() => this.api.flow.listRuns({ ...(flowId === '' ? {} : { flowId }) }))
    if (result.ok) this.set({ runs: result.value.runs })
  }

  /** Stop polling and release the controller's only retained handle. */
  dispose(): void {
    this.stopPolling()
  }

  private startPolling(runId: string): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => { void this.poll(runId) }, POLL_INTERVAL_MS)
    void this.poll(runId)
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  private async poll(runId: string): Promise<void> {
    const result = await flowCall(() => this.api.flow.getRun({ runId }))
    if (!result.ok) {
      this.stopPolling()
      this.set(this.failReady(result.error, 'flow.getRun failed'))
      return
    }
    const snapshot = result.value.run
    if (snapshot === null) {
      this.stopPolling()
      this.set({ status: 'ready', error: 'flow.run not found' })
      return
    }
    this.set({ run: snapshot, nodeStatuses: snapshot.nodeStatuses })
    if (snapshot.status !== 'running') {
      this.stopPolling()
      this.set({ status: 'ready' })
      void this.refreshRuns(snapshot.flowId)
    }
  }
}
