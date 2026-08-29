/**
 * Pure FlowGraph mutations for the agent-mode orchestration canvas.
 */

import type { FlowAggregateItem, FlowAggregateMode, FlowClassifyClass, FlowEdge, FlowExtractParam, FlowExtractParamType, FlowGraph, FlowListOp, FlowNode } from '@deepseek-ai/dsh-flow/types'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** Node kinds the mode palette can place (start/end are structural). */
export type PlaceableNodeType = 'agent' | 'condition' | 'loop' | 'http' | 'template' | 'code' | 'aggregate' | 'list' | 'classify' | 'extract' | 'join'

/**
 * Mint a stable unused node id for a placeable type.
 * @param graph - the draft graph.
 * @param type - the node kind being placed.
 * @returns an id like `step-2` or `condition-1`.
 */
export function mintNodeId(graph: FlowGraph, type: PlaceableNodeType): string {
  const prefix = type === 'agent' ? 'step' : type
  let index = 1
  while (graph.nodes.some(node => node.id === `${prefix}-${String(index)}`)) index += 1
  return `${prefix}-${String(index)}`
}

/**
 * Default fields for a newly placed node.
 * @param type - placeable kind.
 * @param id - mintNodeId result.
 * @param position - canvas position.
 * @returns a FlowNode the validator accepts once edges are complete.
 */
export function defaultPlaceableNode(
  type: PlaceableNodeType,
  id: string,
  position: { x: number; y: number },
): FlowNode {
  switch (type) {
    case 'agent':
      return {
        id,
        type: 'agent',
        position,
        label: 'Agent',
        prompt: 'What should this agent do in this step?',
      }
    case 'condition':
      return {
        id,
        type: 'condition',
        position,
        label: 'Condition',
        expression: 'true',
      }
    case 'loop':
      return {
        id,
        type: 'loop',
        position,
        label: 'Loop',
        iterable: '[]',
        variable: 'item',
      }
    case 'http':
      return {
        id,
        type: 'http',
        position,
        label: 'HTTP Request',
        url: 'https://',
      }
    case 'template':
      return {
        id,
        type: 'template',
        position,
        label: 'Template',
        template: 'Write the template text here.',
      }
    case 'code':
      return {
        id,
        type: 'code',
        position,
        label: 'Code',
        source: 'return OUT',
      }
    case 'aggregate':
      return {
        id,
        type: 'aggregate',
        position,
        label: 'Aggregator',
        items: [{ name: 'value', expression: "OUT['step-1']" }],
        mode: 'object',
      }
    case 'list':
      return {
        id,
        type: 'list',
        position,
        label: 'List',
        source: "OUT['step-1']",
        op: 'first',
      }
    case 'classify':
      return {
        id,
        type: 'classify',
        position,
        label: 'Classifier',
        query: "${OUT['step-1']}",
        classes: [{ id: 'a', name: 'Class A' }, { id: 'b', name: 'Class B' }],
      }
    case 'extract':
      return {
        id,
        type: 'extract',
        position,
        label: 'Extractor',
        query: "${OUT['step-1']}",
        parameters: [{ name: 'value', type: 'string', required: true }],
      }
    case 'join':
      return {
        id,
        type: 'join',
        position,
        label: 'Join',
      }
    /* v8 ignore next 4 -- type is exhaustively PlaceableNodeType; only an out-of-sync caller past the type checker reaches this. */
    default: {
      const _never: never = type
      return _never
    }
  }
}

/**
 * Parse a palette / picker payload into a placeable type.
 * @param data - drop or pick payload.
 * @returns the type, or undefined when unknown.
 */
export function parsePlaceableType(data: string): PlaceableNodeType | undefined {
  if (data === 'agent' || data === 'condition' || data === 'loop' || data === 'http' || data === 'template' || data === 'code' || data === 'aggregate' || data === 'list' || data === 'classify' || data === 'extract' || data === 'join') return data
  return undefined
}

/**
 * Place a node at a position without wiring edges.
 * @param graph - current graph.
 * @param type - placeable kind.
 * @param position - drop position.
 * @returns the next graph and the new node id.
 */
export function addNodeAt(
  graph: FlowGraph,
  type: PlaceableNodeType,
  position: { x: number; y: number },
): { graph: FlowGraph; nodeId: string } {
  const nodeId = mintNodeId(graph, type)
  return {
    nodeId,
    graph: {
      ...graph,
      nodes: [...graph.nodes, defaultPlaceableNode(type, nodeId, position)],
    },
  }
}

/**
 * Connect two nodes, auto-labeling condition/loop branches when needed.
 * @param graph - current graph.
 * @param from - source node id.
 * @param to - target node id.
 * @returns the next graph, or the same graph when the edge is refused.
 */
export function addEdge(graph: FlowGraph, from: string, to: string): FlowGraph {
  if (from === to) return graph
  const source = graph.nodes.find(node => node.id === from)
  const target = graph.nodes.find(node => node.id === to)
  if (source === undefined || target === undefined) return graph
  if (source.type === 'end') return graph
  if (target.type === 'start') return graph
  if (graph.edges.some(edge => edge.from === from && edge.to === to)) return graph

  const label = nextBranchLabel(graph, source)
  if (label === false) return graph
  const id = `e-${from}-${to}${label === undefined ? '' : `-${label}`}`
  const edge: FlowEdge = label === undefined
    ? { id, from, to }
    : { id, from, to, label }
  return { ...graph, edges: [...graph.edges, edge] }
}

/**
 * Remove a node and its incident edges. Start/end are structural and refused.
 * @param graph - current graph.
 * @param id - node to remove.
 * @returns the next graph.
 */
export function removeNode(graph: FlowGraph, id: string): FlowGraph {
  const node = graph.nodes.find(candidate => candidate.id === id)
  if (node === undefined || node.type === 'start' || node.type === 'end') return graph
  return {
    ...graph,
    nodes: graph.nodes.filter(candidate => candidate.id !== id),
    edges: graph.edges.filter(edge => edge.from !== id && edge.to !== id),
  }
}

/**
 * Remove one edge by id.
 * @param graph - current graph.
 * @param id - edge id.
 * @returns the next graph.
 */
export function removeEdge(graph: FlowGraph, id: string): FlowGraph {
  if (!graph.edges.some(edge => edge.id === id)) return graph
  return { ...graph, edges: graph.edges.filter(edge => edge.id !== id) }
}

/**
 * Insert a placeable node on the edge from→to (Dify-style midpoint +).
 * @param graph - current graph.
 * @param from - edge source.
 * @param to - edge target.
 * @param type - node to insert.
 * @returns the next graph and new node id, or undefined when the edge is missing.
 */
export function insertBetween(
  graph: FlowGraph,
  from: string,
  to: string,
  type: PlaceableNodeType,
): { graph: FlowGraph; nodeId: string } | undefined {
  const edge = graph.edges.find(candidate => candidate.from === from && candidate.to === to)
  if (edge === undefined) return undefined
  const fromNode = graph.nodes.find(node => node.id === from)
  const toNode = graph.nodes.find(node => node.id === to)
  if (fromNode === undefined || toNode === undefined) return undefined

  const position = {
    x: Math.round((fromNode.position.x + toNode.position.x) / 2),
    y: Math.round((fromNode.position.y + toNode.position.y) / 2),
  }
  const nodeId = mintNodeId(graph, type)
  const node = defaultPlaceableNode(type, nodeId, position)
  let next: FlowGraph = {
    ...graph,
    nodes: [...graph.nodes, node],
    edges: graph.edges.filter(candidate => candidate.id !== edge.id),
  }
  next = addEdge(next, from, nodeId)
  next = wireOutgoing(next, nodeId, to, type)
  return { graph: next, nodeId }
}

/**
 * Add a placeable node after `afterId` by splitting its first outgoing edge,
 * or by appending when it has none.
 * @param graph - current graph.
 * @param afterId - anchor node.
 * @param type - node to add.
 * @returns the next graph and new node id, or undefined when the anchor is missing.
 */
export function addAfter(
  graph: FlowGraph,
  afterId: string,
  type: PlaceableNodeType,
): { graph: FlowGraph; nodeId: string } | undefined {
  const after = graph.nodes.find(node => node.id === afterId)
  if (after === undefined || after.type === 'end') return undefined
  const outgoing = graph.edges.find(edge => edge.from === afterId)
  if (outgoing !== undefined) {
    return insertBetween(graph, outgoing.from, outgoing.to, type)
  }
  const position = { x: after.position.x + 200, y: after.position.y }
  const placed = addNodeAt(graph, type, position)
  return { graph: addEdge(placed.graph, afterId, placed.nodeId), nodeId: placed.nodeId }
}

/**
 * Wire a new node's required outgoing edges toward `to`.
 * @param graph - graph already containing the new node.
 * @param nodeId - the new node.
 * @param to - primary successor.
 * @param type - placeable kind.
 * @returns the wired graph.
 */
function wireOutgoing(
  graph: FlowGraph,
  nodeId: string,
  to: string,
  type: PlaceableNodeType,
): FlowGraph {
  if (type === 'agent' || type === 'http' || type === 'template' || type === 'code' || type === 'aggregate' || type === 'list' || type === 'extract' || type === 'join') return addEdge(graph, nodeId, to)
  if (type === 'classify') {
    const source = graph.nodes.find(node => node.id === nodeId)
    let next = graph
    if (source?.type === 'classify') {
      for (const item of source.classes) {
        next = withLabeledEdge(next, nodeId, to, item.id)
      }
    }
    next = withLabeledEdge(next, nodeId, to, 'default')
    return next
  }
  if (type === 'condition') {
    let next = withLabeledEdge(graph, nodeId, to, 'true')
    next = withLabeledEdge(next, nodeId, to, 'false')
    return next
  }
  // Loop body and after cannot merge on the same successor — send after to end.
  const end = graph.nodes.find(node => node.type === 'end')
  let next = withLabeledEdge(graph, nodeId, to, 'body')
  if (end !== undefined && end.id !== to) {
    next = withLabeledEdge(next, nodeId, end.id, 'after')
  } else {
    const afterId = mintNodeId(next, 'agent')
    // wireOutgoing's only caller (insertBetween) always adds nodeId's node to
    // `graph` before this call, so the find always succeeds; the `?? 0` guard
    // below is defensive against a future caller that does not.
    const anchor = next.nodes.find(node => node.id === nodeId)
    const afterNode = {
      ...defaultPlaceableNode('agent', afterId, {
        /* v8 ignore next -- see above; the fallback arm never runs through the current call graph */
        x: (anchor?.position.x ?? 0) + 200,
        /* v8 ignore next -- see above; the fallback arm never runs through the current call graph */
        y: (anchor?.position.y ?? 0) + 140,
      }),
      label: 'After loop',
      prompt: 'Runs after the loop finishes.',
    }
    next = { ...next, nodes: [...next.nodes, afterNode] }
    next = withLabeledEdge(next, nodeId, afterId, 'after')
    if (end !== undefined) next = addEdge(next, afterId, end.id)
  }
  return next
}

/**
 * Pick the next required branch label for a condition/loop source, or undefined
 * for unlabeled edges. Returns false when the source already has its quota.
 * @param graph - current graph.
 * @param source - source node.
 * @returns label, undefined, or false when full.
 */
function nextBranchLabel(
  graph: FlowGraph,
  source: FlowNode,
): string | undefined | false {
  const out = graph.edges.filter(edge => edge.from === source.id)
  if (source.type === 'condition') {
    if (!out.some(edge => edge.label === 'true')) return 'true'
    if (!out.some(edge => edge.label === 'false')) return 'false'
    return false
  }
  if (source.type === 'loop') {
    if (!out.some(edge => edge.label === 'body')) return 'body'
    if (!out.some(edge => edge.label === 'after')) return 'after'
    return false
  }
  if (source.type === 'classify') {
    for (const item of source.classes) {
      if (!out.some(edge => edge.label === item.id)) return item.id
    }
    if (!out.some(edge => edge.label === 'default')) return 'default'
    return false
  }
  if (source.type === 'start' && out.length >= 1) return false
  return undefined
}

/**
 * Add a labeled edge if it is not already present.
 * @param graph - current graph.
 * @param from - source.
 * @param to - target.
 * @param label - branch label.
 * @returns the next graph.
 */
function withLabeledEdge(
  graph: FlowGraph,
  from: string,
  to: string,
  label: string,
): FlowGraph {
  // wireOutgoing's only caller passes a freshly minted `from`, so no existing
  // edge shares it; this guard defends a future wireOutgoing change that
  // reuses a (from, to, label) tuple.
  /* v8 ignore next 3 -- see above; unreachable through the current call graph */
  if (graph.edges.some(edge => edge.from === from && edge.to === to && edge.label === label)) {
    return graph
  }
  const id = `e-${from}-${to}-${label}`
  return {
    ...graph,
    edges: [...graph.edges, { id, from, to, label }],
  }
}

/**
 * Serialize aggregate items as one `name: expression` line each.
 * @param items - the node's items.
 * @returns inspector textarea text.
 */
export function formatAggregateItems(items: readonly FlowAggregateItem[]): string {
  return items.map(item => `${item.name}: ${item.expression}`).join('\n')
}

/**
 * Parse inspector textarea text into aggregate items. Blank lines are dropped.
 * A line without `:` keeps the whole line as the name and an empty expression
 * so the validator can surface the empty-expression finding.
 * @param text - inspector textarea value.
 * @returns parsed items, possibly empty.
 */
export function parseAggregateItems(text: string): FlowAggregateItem[] {
  const items: FlowAggregateItem[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const split = line.indexOf(':')
    if (split === -1) {
      items.push({ name: line, expression: '' })
      continue
    }
    items.push({ name: line.slice(0, split).trim(), expression: line.slice(split + 1).trim() })
  }
  return items
}

/**
 * Parse an inspector select value into an aggregate mode.
 * @param data - select value.
 * @returns the mode, or undefined when unknown.
 */
export function parseAggregateMode(data: string): FlowAggregateMode | undefined {
  if (data === 'object' || data === 'first' || data === 'concat') return data
  return undefined
}

/**
 * Parse an inspector select value into a list operator.
 * @param data - select value.
 * @returns the operator, or undefined when unknown.
 */
export function parseListOp(data: string): FlowListOp | undefined {
  if (data === 'first' || data === 'last' || data === 'length' || data === 'reverse' || data === 'flatten') return data
  return undefined
}

/**
 * Serialize classify classes as one `id: name` line each.
 * @param classes - the node's classes.
 * @returns inspector textarea text.
 */
export function formatClassifyClasses(classes: readonly FlowClassifyClass[]): string {
  return classes.map(item => item.name === undefined || item.name === '' ? item.id : `${item.id}: ${item.name}`).join('\n')
}

/**
 * Parse inspector textarea text into classify classes. Blank lines are dropped.
 * A line without `:` is the id with no display name.
 * @param text - inspector textarea value.
 * @returns parsed classes, possibly empty.
 */
export function parseClassifyClasses(text: string): FlowClassifyClass[] {
  const classes: FlowClassifyClass[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const split = line.indexOf(':')
    if (split === -1) {
      classes.push({ id: line })
      continue
    }
    const id = line.slice(0, split).trim()
    const name = line.slice(split + 1).trim()
    classes.push(name === '' ? { id } : { id, name })
  }
  return classes
}

/**
 * Serialize extract parameters as `name[!]: type description` lines.
 * @param parameters - the node's parameters.
 * @returns inspector textarea text.
 */
export function formatExtractParams(parameters: readonly FlowExtractParam[]): string {
  return parameters.map((param) => {
    const flag = param.required === true ? '!' : ''
    const desc = param.description === undefined || param.description === '' ? '' : ` ${param.description}`
    return `${param.name}${flag}: ${param.type}${desc}`
  }).join('\n')
}

/**
 * Parse inspector textarea text into extract parameters. Blank lines are dropped.
 * A trailing `!` on the name marks the field required. The first token after
 * `:` is the type; the rest is the description.
 * @param text - inspector textarea value.
 * @returns parsed parameters, possibly empty.
 */
export function parseExtractParams(text: string): FlowExtractParam[] {
  const parameters: FlowExtractParam[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const split = line.indexOf(':')
    const left = (split === -1 ? line : line.slice(0, split)).trim()
    const right = split === -1 ? '' : line.slice(split + 1).trim()
    const required = left.endsWith('!')
    const name = required ? left.slice(0, -1).trim() : left
    const tokens = right.split(/\s+/)
    const typeToken = tokens[0] ?? ''
    const type = parseExtractParamType(typeToken) ?? (typeToken as FlowExtractParamType)
    const description = tokens.slice(1).join(' ').trim()
    parameters.push({
      name,
      type,
      ...description === '' ? {} : { description },
      ...required ? { required: true } : {},
    })
  }
  return parameters
}

/**
 * Parse an inspector type token into an extract parameter type.
 * @param data - type token.
 * @returns the type, or undefined when unknown.
 */
export function parseExtractParamType(data: string): FlowExtractParamType | undefined {
  if (data === 'string' || data === 'number' || data === 'integer' || data === 'boolean') return data
  return undefined
}

/**
 * Node ids reachable from `from` (not including `from` itself).
 * @param graph - the flow.
 * @param from - origin node id.
 * @returns descendant ids.
 */
export function descendantIds(graph: FlowGraph, from: string): Set<string> {
  const outgoing = new Map<string, string[]>()
  for (const node of graph.nodes) outgoing.set(node.id, [])
  for (const edge of graph.edges) outgoing.get(edge.from)?.push(edge.to)
  const seen = new Set<string>()
  const queue = [...outgoing.get(from) ?? []]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of outgoing.get(id) ?? []) queue.push(next)
  }
  return seen
}

/**
 * Build a Variable Inspector seed: keep last-run outputs for nodes that are
 * not `fromId` and not its descendants. When `edited` is set, `fromId` is
 * also seeded so the node is skipped and only descendants re-run.
 * @param outputs - last-run `nodeOutputs`.
 * @param graph - the draft graph.
 * @param fromId - the inspector's selected node.
 * @param edited - optional replacement output for `fromId`.
 * @returns the seed map.
 */
export function seedForRerun(
  outputs: Readonly<Record<string, JsonValue>>,
  graph: FlowGraph,
  fromId: string,
  edited?: JsonValue,
): Record<string, JsonValue> {
  const skip = descendantIds(graph, fromId)
  const seed: Record<string, JsonValue> = {}
  for (const [id, value] of Object.entries(outputs)) {
    if (id === fromId || skip.has(id)) continue
    seed[id] = value
  }
  if (edited !== undefined) seed[fromId] = edited
  return seed
}
