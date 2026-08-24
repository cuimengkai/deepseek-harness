/**
 * Preset composition graph helpers: the chain projection and the chain
 * mutations the preset composer drives over a `FlowGraph`.
 *
 * The host owns graph↔row conversion (`graphToRows` in agent-presets); the
 * browser cannot import the host package, so this module re-implements just
 * the pieces the composer needs — the rows a graph projects, and the chain
 * mutations that edit them — as pure functions over `FlowGraph` values. The
 * graphs the browser ever holds are chains (`start → one agent node per row →
 * end` in edge order), and every mutation preserves that: adding appends,
 * reordering relinks the chain edges, removing deletes a node and its edges.
 * Node ids are canvas-internal (`agent-1`, ...) and minted fresh; the row id
 * a node carries in `composition.id` stays stable across reorders, which is
 * what the dirty check relies on.
 */

import type { FlowAgentComposition, FlowAgentNode, FlowAgentOptions, FlowGraph, FlowModelKindBinding, FlowNode } from '@deepseek-ai/dsh-flow/types'
import type { ComposeRow, ModelKind } from '@deepseek-ai/dsh-api-remotes/client'

/** The cascade x-offset between chain nodes in a fresh layout. */
const CASCADE_X = 220

/**
 * Derive a composition row id from an installed module name: strip the
 * `@deepseek-ai/` and `dsh-` prefixes (so `@deepseek-ai/dsh-tool-bash` reads
 * as `tool-bash`), then append `-2`/`-3` until the id is free.
 * @param moduleName - the exact module specifier the row mounts.
 * @param rows - the rows already in the composition, for the conflict check.
 * @returns an id no row in the composition already uses.
 */
export function rowIdFor(moduleName: string, rows: readonly ComposeRow[]): string {
  const base = moduleName.replace(/^@deepseek-ai\//, '').replace(/^dsh-/, '')
  const used = new Set(rows.map(row => row.id))
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${String(n)}`
    if (!used.has(candidate)) return candidate
  }
}

/**
 * Project one composition row from an agent node's `composition` field, in
 * the JSON-safe shape the host's rows composer accepts.
 * @param composition - the agent node's composition field.
 * @returns the row, omitting every field the node did not carry.
 */
export function compositionToRow(composition: FlowAgentComposition): ComposeRow {
  return {
    name: composition.module,
    ...composition.id === undefined ? {} : { id: composition.id },
    ...composition.config === undefined ? {} : { config: composition.config },
    ...composition.group === undefined ? {} : { group: composition.group },
    ...composition.disabled === undefined ? {} : { disabled: composition.disabled },
    ...composition.inject === undefined ? {} : { inject: composition.inject },
  }
}

/** The agent nodes of a preset graph, in chain (edge) order. */
export function chainAgents(graph: FlowGraph): FlowAgentNode[] {
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from)
    if (list === undefined) outgoing.set(edge.from, [edge.to])
    else list.push(edge.to)
  }
  const ordered: string[] = []
  const visited = new Set<string>()
  const follow = (id: string): void => {
    if (visited.has(id) || id === 'end') return
    visited.add(id)
    ordered.push(id)
    for (const to of outgoing.get(id) ?? []) follow(to)
  }
  follow('start')
  // A chain is fully reachable from start; a malformed remainder (the host
  // only ever serves chains, so this is defensive) appends in node order so
  // the projection stays deterministic instead of silently dropping nodes.
  for (const node of graph.nodes) {
    if (node.type === 'agent' && !visited.has(node.id)) ordered.push(node.id)
  }
  return ordered.flatMap((id) => {
    const node = byId.get(id)
    return node !== undefined && node.type === 'agent' ? [node] : []
  })
}

/**
 * The composition rows a preset graph projects, in chain order. The mount
 * order the host writes is this order, so the composer's dirty check and the
 * no-rows blocker both read it from the graph.
 * @param graph - the preset graph.
 * @returns the rows in chain order.
 */
export function graphRows(graph: FlowGraph): ComposeRow[] {
  return chainAgents(graph).flatMap((node) => {
    const composition = node.composition
    return composition === undefined ? [] : [compositionToRow(composition)]
  })
}

/** Whether two graphs carry the same authored content: rows, node positions, AND the per-node agent routes. */
export function graphLayoutEqual(a: FlowGraph, b: FlowGraph): boolean {
  const aRows = graphRows(a)
  const bRows = graphRows(b)
  if (aRows.length !== bRows.length) return false
  // The length guard guarantees every `aRows` index is in-bounds in `bRows`.
  const sameRows = aRows.every((row, index) => {
    const other = bRows[index]
    return other !== undefined && row.id === other.id && row.name === other.name
  })
  if (!sameRows) return false
  if (a.nodes.length !== b.nodes.length) return false
  const positions = (graph: FlowGraph): string =>
    graph.nodes.map(node => `${node.id}:${node.position.x},${node.position.y}`).join('|')
  if (positions(a) !== positions(b)) return false
  // A model-kind binding is authored content, so a route edit wakes Save like
  // a row or layout edit does. Keyed by node id so a relabeled route is caught
  // wherever it sits.
  const routes = (graph: FlowGraph): string =>
    graph.nodes
      .map(node => node.type === 'agent' ? `${node.id}:${JSON.stringify(node.agentOptions ?? {})}` : node.id)
      .join('|')
  return routes(a) === routes(b)
}

/**
 * The next binding after editing one side of a model-kind route: the edited
 * field takes `value` ('' clears it), the other keeps what the node bound.
 * @param binding - the kind's current binding, absent before the first edit.
 * @param field - which side is edited.
 * @param value - the provider or model id, or '' to clear that side.
 * @returns the next binding, or undefined when both sides are clear.
 */
function bindModelKindField(
  binding: FlowModelKindBinding | undefined,
  field: 'provider' | 'model',
  value: string,
): FlowModelKindBinding | undefined {
  const provider = field === 'provider' ? value : binding?.provider
  const model = field === 'model' ? value : binding?.model
  // A binding cleared to nothing routes the node's own default, so it is the
  // same as a kind never bound — the empty entry must not survive as a no-op.
  const next = {
    ...provider === undefined || provider === '' ? {} : { provider },
    ...model === undefined || model === '' ? {} : { model },
  }
  return Object.keys(next).length === 0 ? undefined : next
}

/**
 * Bind one model kind's route on one agent node, writing `agentOptions.modelKinds`.
 * The first edit on a kind creates its binding; clearing a field omits it from
 * the binding, and clearing both drops the kind entry entirely — an omitted
 * kind routes the node's own default. The node's own `provider`/`model` (if
 * the graph carried any) are left alone.
 * @param graph - the chain before the edit.
 * @param nodeId - the agent node's canvas id.
 * @param kind - the model kind being bound.
 * @param field - which side of the binding is edited.
 * @param value - the provider or model id, or '' to clear that side.
 * @returns the graph with the node's route bound, or the same graph when the
 * node is absent or is not an agent.
 */
export function setAgentModelKind(
  graph: FlowGraph,
  nodeId: string,
  kind: ModelKind,
  field: 'provider' | 'model',
  value: string,
): FlowGraph {
  const nodes = graph.nodes.map((node): FlowNode => {
    if (node.id === nodeId && node.type === 'agent') {
      const options = node.agentOptions
      const kinds = { ...(options?.modelKinds ?? {}) } as Partial<Record<ModelKind, FlowModelKindBinding>>
      const next = bindModelKindField(kinds[kind], field, value)
      let modelKinds: Partial<Record<ModelKind, FlowModelKindBinding>> | undefined
      if (next === undefined) {
        // Rebuild without the dynamic key rather than deleting it, so no null
        // binding survives to keep the edit "dirty".
        const { [kind]: _dropped, ...withoutKind } = kinds
        modelKinds = Object.keys(withoutKind).length === 0 ? undefined : withoutKind
      } else {
        modelKinds = { ...kinds, [kind]: next }
      }
      // Clearing the last binding restores the node exactly: the node's own
      // provider/model survive, and a node that never carried agentOptions
      // must not be invented one, or the edit would stay "dirty" against it.
      if (modelKinds === undefined) {
        const rest: FlowAgentOptions | undefined = options === undefined
          ? undefined
          : {
            ...options.provider === undefined ? {} : { provider: options.provider },
            ...options.model === undefined ? {} : { model: options.model },
          }
        if (rest === undefined) return node
        if (rest.provider === undefined && rest.model === undefined) {
          const { agentOptions: _dropped, ...bare } = node
          return bare
        }
        return { ...node, agentOptions: rest }
      }
      return { ...node, agentOptions: { ...options, modelKinds } }
    }
    return node
  })
  return nodes.some((node, index) => node !== graph.nodes[index]) ? { ...graph, nodes } : graph
}

/**
 * An empty chain graph: start and end only, directly connected. The canvas
 * serves this for a brand-new preset, and the host's chain projection for an
 * empty composition renders the same shape.
 * @param id - the preset id ('' for a preset not created yet).
 * @param name - the display name.
 * @returns the two-node chain.
 */
export function emptyChainGraph(id: string, name: string): FlowGraph {
  return {
    id,
    name,
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      { id: 'end', type: 'end', position: { x: CASCADE_X, y: 0 } },
    ],
    edges: [{ id: 'e-start', from: 'start', to: 'end' }],
  }
}

/**
 * The cascade position the n-th appended module lands at (0-based n), matching
 * the host's regenerated chain layout.
 * @param n - the zero-based index of the module being appended.
 * @returns the cascade graph position.
 */
export function cascadePosition(n: number): { x: number; y: number } {
  return { x: CASCADE_X * (n + 1), y: 0 }
}

/** The chain edges for an ordered agent node id list. */
function chainEdges(agentIds: readonly string[]): FlowGraph['edges'] {
  if (agentIds.length === 0) return [{ id: 'e-start', from: 'start', to: 'end' }]
  const edges: Array<{ id: string; from: string; to: string }> = []
  let from: string = 'start'
  for (const id of agentIds) {
    edges.push({ id: edges.length === 0 ? 'e-start' : `e-${edges.length - 1}`, from, to: id })
    from = id
  }
  edges.push({ id: 'e-end', from, to: 'end' })
  return edges
}

/** The graph with its chain edges relinked for an ordered agent id list. */
function withAgentOrder(graph: FlowGraph, agentIds: readonly string[]): FlowGraph {
  return { ...graph, edges: chainEdges(agentIds) }
}

/** The canvas-internal id minted for the next agent node (max `agent-N` + 1). */
function nextAgentId(graph: FlowGraph): string {
  let max = 0
  for (const node of graph.nodes) {
    const match = /^agent-(\d+)$/.exec(node.id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return `agent-${max + 1}`
}

/**
 * Add a module as a new agent node at the end of the chain. A module already
 * in the composition is refused — one agent runs one instance of a plugin.
 * @param graph - the chain before the addition.
 * @param moduleName - the module being dragged in from the palette.
 * @param position - the canvas position the new node lands at.
 * @returns the extended graph and the new node id, or undefined on a duplicate.
 */
export function chainAddModule(
  graph: FlowGraph,
  moduleName: string,
  position: { x: number; y: number },
): { graph: FlowGraph; nodeId: string } | undefined {
  const agents = chainAgents(graph)
  if (agents.some(node => node.composition?.module === moduleName)) return undefined
  const nodeId = nextAgentId(graph)
  const node: FlowAgentNode = {
    id: nodeId,
    type: 'agent',
    position,
    prompt: '',
    composition: { module: moduleName, id: rowIdFor(moduleName, graphRows(graph)) },
  }
  // The end terminal sits one cascade past the last agent, so appending moves
  // it out to keep the new node from landing on it (the empty chain's end
  // starts at the first cascade slot, which is exactly where the first agent
  // would go).
  const endAt = cascadePosition(agents.length + 1)
  const nodes = graph.nodes.map(node => node.type === 'end' ? { ...node, position: endAt } : node)
  return {
    graph: withAgentOrder({ ...graph, nodes: [...nodes, node] }, [...agents.map(agent => agent.id), nodeId]),
    nodeId,
  }
}

/**
 * Remove one agent node and its edges from the chain.
 * @param graph - the chain before the removal.
 * @param nodeId - the canvas node id being removed.
 * @returns the chain without that node, relinked around the gap.
 */
export function chainRemoveNode(graph: FlowGraph, nodeId: string): FlowGraph {
  if (!graph.nodes.some(node => node.id === nodeId)) return graph
  const nodes = graph.nodes.filter(node => node.id !== nodeId)
  const ids = nodes.flatMap(node => node.type === 'agent' ? [node.id] : [])
  return withAgentOrder({ ...graph, nodes }, ids)
}

/**
 * Move one node's canvas position, leaving the chain order alone.
 * @param graph - the chain before the move.
 * @param nodeId - the node being dragged.
 * @param position - the new graph position.
 * @returns the graph with that node repositioned.
 */
export function chainMoveNode(
  graph: FlowGraph,
  nodeId: string,
  position: { x: number; y: number },
): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(node => node.id === nodeId ? { ...node, position } : node),
  }
}

/**
 * Reorder the chain so the node `to` runs immediately after the node `from` —
 * the connect gesture on the canvas, Dify-style. Positions are untouched; only
 * the chain edges move.
 * @param graph - the chain before the reorder.
 * @param fromNodeId - the node the dragged port came from.
 * @param toNodeId - the node being moved after it.
 * @returns the reordered chain, or the same graph when either id is absent.
 */
export function chainReorder(graph: FlowGraph, fromNodeId: string, toNodeId: string): FlowGraph {
  const ids = chainAgents(graph).map(node => node.id)
  const fromIndex = ids.indexOf(fromNodeId)
  const toIndex = ids.indexOf(toNodeId)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return graph
  ids.splice(toIndex, 1)
  ids.splice(ids.indexOf(fromNodeId) + 1, 0, toNodeId)
  return withAgentOrder(graph, ids)
}

/**
 * Reorder the chain by index: move the agent at `fromIndex` so it lands before
 * the element originally at `toIndex` (or at the end when past the last one).
 * @param graph - the chain before the move.
 * @param fromIndex - the agent being moved.
 * @param toIndex - the target slot, clamped to the chain bounds.
 * @returns the reordered chain, or the same graph when `fromIndex` is out of range.
 */
export function chainMoveIndex(graph: FlowGraph, fromIndex: number, toIndex: number): FlowGraph {
  const ids = chainAgents(graph).map(node => node.id)
  if (fromIndex < 0 || fromIndex >= ids.length) return graph
  const moved = ids.splice(fromIndex, 1)[0]
  /* v8 ignore next -- the range guard above guarantees a moved element */
  if (moved === undefined) return graph
  ids.splice(Math.min(Math.max(toIndex, 0), ids.length), 0, moved)
  return withAgentOrder(graph, ids)
}

/**
 * The chain slot a module picked for one node lands at: the slot right after
 * that node. A pick for the start terminal goes first; one for the end
 * terminal or for a missing node keeps the chain tail — the caller already
 * appended the new module there, so returning null means no move.
 * @param after - the canvas node id the pick follows.
 * @param agents - the chain's agent nodes, in chain order.
 * @returns the target chain index, or null to keep the module at the tail.
 */
export function insertSlot(after: string, agents: readonly FlowAgentNode[]): number | null {
  if (after === 'start') return 0
  if (after === 'end') return null
  const index = agents.findIndex(node => node.id === after)
  return index === -1 ? null : index + 1
}
