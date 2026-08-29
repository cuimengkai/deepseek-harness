/**
 * Flow graph validation: the structural rules, a branch-context analysis that
 * proves the recursive-CPS compilation never re-runs a node, and — for an
 * agent node's `subgraph` — a recursive validation of the sub-graph as its own
 * standalone flow.
 *
 * The graph compiles to nested `await visit(...)` calls, so a node with more
 * than one incoming edge (a merge) is safe only when its branches are mutually
 * exclusive — they may diverge at a `condition` (exactly one branch executes)
 * — or when the merge target is an explicit `join` after a parallel fan-out.
 * A loop's `body`/`after` split still cannot reconverge. To decide that, each
 * node is annotated with the set of "branch contexts" it can be reached
 * through — every split decision on a path from `start`, propagated in
 * topological order. Two incoming contexts are exclusive iff their first
 * divergence is at a condition or classify class split; a non-join merge is
 * valid iff every pair of its incoming contexts is exclusive. A fan-out that
 * reconverges at a non-join node is rejected by the same rule.
 *
 * A sub-graph never interacts with the branch-context analysis across levels: it
 * has a single entry (the embedding node) and its terminals have no outgoing
 * edges, so a merge can only form among one level's own branches. Each level is
 * therefore validated on its own, and the union is sound by construction.
 *
 * All rules return a discriminated result rather than throwing, so the RPC and
 * the canvas can surface every error at once.
 * @module @deepseek-ai/dsh-flow/validate
 */

import type { FlowEdge, FlowGraph, FlowNode, FlowNodeType } from './types.ts'

/** A validation pass with no findings. */
export interface FlowValidationOk {
  readonly ok: true
}

/** A validation pass with human-readable findings. */
export interface FlowValidationFailure {
  readonly ok: false
  readonly errors: readonly string[]
}

/** The outcome of {@link validateFlow}. */
export type FlowValidation = FlowValidationOk | FlowValidationFailure

/** Bound on per-node branch contexts; crossing it means the flow is too complex. */
const MAX_CONTEXTS_PER_NODE = 128

/** One path's split decisions: `splitNodeId -> branch label` (`p<i>` for fan-outs). */
type BranchContext = Map<string, string>

/** A valid kebab-case flow id (also the persisted file name). */
const FLOW_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** The branch labels a condition's and a loop's outgoing edges must carry. */
const BRANCH_LABELS: Record<Exclude<FlowNodeType, 'start' | 'end' | 'agent' | 'http' | 'template' | 'code' | 'aggregate' | 'list' | 'classify' | 'extract' | 'join'>, readonly string[]> = {
  condition: ['true', 'false'],
  loop: ['body', 'after'],
}

/**
 * Validate one flow graph, including every agent node's `subgraph` as its own
 * standalone flow. The union graph through an embedding node is acyclic and
 * well-typed iff both levels are — the sub-graph has a single entry (the
 * embedding node) and its terminals have no outgoing edges, so a cycle, an
 * unreachable node, a bad branch label, or a reconvergent merge can only live
 * at one level — so each level validates itself and the composition is sound
 * by construction.
 * @param graph - the graph to check.
 * @returns `{ ok: true }` or `{ ok: false, errors }`.
 */
export function validateFlow(graph: FlowGraph): FlowValidation {
  const errors: string[] = []
  validateGraph(graph, errors, true)
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

/**
 * Validate one graph level, appending findings to `errors`. A sub-graph is
 * validated with `checkIdentity` false because its `id`/`name` are labels, not
 * the persisted file name.
 * @param graph - the graph level to check.
 * @param errors - the shared findings list.
 * @param checkIdentity - whether the level's `id`/`name` are checked.
 */
function validateGraph(graph: FlowGraph, errors: string[], checkIdentity: boolean): void {
  const nodes = new Map<string, FlowNode>()
  const outEdges = new Map<string, FlowEdge[]>()

  if (checkIdentity) {
    if (!FLOW_ID_PATTERN.test(graph.id)) {
      errors.push(`flow id "${graph.id}" is not kebab-case (lowercase letters, digits, hyphens)`)
    }
    if (graph.name.trim() === '') errors.push('flow name is empty')
  }

  const starts = graph.nodes.filter(node => node.type === 'start')
  if (starts.length !== 1) errors.push(`a flow needs exactly one start node (found ${starts.length})`)
  /* v8 ignore next -- the nullish arm is unreachable: when length is 1, starts[0] exists */
  const startId = starts.length === 1 ? starts[0]?.id : undefined

  const edgeKeys = new Set<string>()
  for (const node of graph.nodes) {
    if (node.id === '') errors.push('a node has an empty id')
    if (nodes.has(node.id)) {
      errors.push(`duplicate node id "${node.id}"`)
      continue
    }
    // An embedding node (one with a `subgraph`) runs its sub-graph instead of a
    // subagent, so its prompt is unused and may be empty. A plain agent needs
    // at least one of systemPrompt / prompt non-empty after trim.
    if (node.type === 'agent' && node.subgraph === undefined) {
      const system = node.systemPrompt?.trim() ?? ''
      if (system === '' && node.prompt.trim() === '') {
        errors.push(`agent node "${node.id}" has an empty prompt`)
      }
    }
    if (node.type === 'condition' && node.expression.trim() === '') {
      errors.push(`condition node "${node.id}" has an empty expression`)
    }
    if (node.type === 'loop') {
      if (node.iterable.trim() === '') errors.push(`loop node "${node.id}" has an empty iterable`)
      if (!isValidIdentifier(node.variable)) {
        errors.push(`loop node "${node.id}" variable "${node.variable}" is not a valid JS identifier`)
      }
    }
    if (node.type === 'http' && node.url.trim() === '') {
      errors.push(`http node "${node.id}" has an empty url`)
    }
    if (node.type === 'template' && node.template.trim() === '') {
      errors.push(`template node "${node.id}" has an empty template`)
    }
    if (node.type === 'code' && node.source.trim() === '') {
      errors.push(`code node "${node.id}" has an empty source`)
    }
    if (node.type === 'aggregate') {
      if (node.items.length === 0) {
        errors.push(`aggregate node "${node.id}" needs at least one item`)
      }
      if (node.mode !== 'object' && node.mode !== 'first' && node.mode !== 'concat') {
        errors.push(`aggregate node "${node.id}" has an unknown mode`)
      }
      const names = new Set<string>()
      for (const [index, item] of node.items.entries()) {
        if (item.name.trim() === '') {
          errors.push(`aggregate node "${node.id}" item ${String(index)} has an empty name`)
        } else if (names.has(item.name)) {
          errors.push(`aggregate node "${node.id}" repeats item name "${item.name}"`)
        } else {
          names.add(item.name)
        }
        if (item.expression.trim() === '') {
          errors.push(`aggregate node "${node.id}" item "${item.name || String(index)}" has an empty expression`)
        }
      }
    }
    if (node.type === 'list') {
      if (node.source.trim() === '') {
        errors.push(`list node "${node.id}" has an empty source`)
      }
      if (node.op !== 'first' && node.op !== 'last' && node.op !== 'length' && node.op !== 'reverse' && node.op !== 'flatten') {
        errors.push(`list node "${node.id}" has an unknown op`)
      }
    }
    if (node.type === 'classify') {
      if (node.query.trim() === '') {
        errors.push(`classify node "${node.id}" has an empty query`)
      }
      if (node.classes.length < 2) {
        errors.push(`classify node "${node.id}" needs at least two classes`)
      }
      const classIds = new Set<string>()
      for (const [index, item] of node.classes.entries()) {
        if (item.id.trim() === '') {
          errors.push(`classify node "${node.id}" class ${String(index)} has an empty id`)
        } else if (item.id === 'default') {
          errors.push(`classify node "${node.id}" reserves "default" as the unmatched-class label`)
        } else if (classIds.has(item.id)) {
          errors.push(`classify node "${node.id}" repeats class id "${item.id}"`)
        } else {
          classIds.add(item.id)
        }
      }
    }
    if (node.type === 'extract') {
      if (node.query.trim() === '') {
        errors.push(`extract node "${node.id}" has an empty query`)
      }
      if (node.parameters.length === 0) {
        errors.push(`extract node "${node.id}" needs at least one parameter`)
      }
      const names = new Set<string>()
      for (const [index, param] of node.parameters.entries()) {
        if (param.name.trim() === '') {
          errors.push(`extract node "${node.id}" parameter ${String(index)} has an empty name`)
        } else if (names.has(param.name)) {
          errors.push(`extract node "${node.id}" repeats parameter name "${param.name}"`)
        } else {
          names.add(param.name)
        }
        if (param.type !== 'string' && param.type !== 'number' && param.type !== 'integer' && param.type !== 'boolean') {
          errors.push(`extract node "${node.id}" parameter "${param.name || String(index)}" has an unknown type`)
        }
      }
    }
    if (node.type === 'agent' && node.subgraph !== undefined) {
      validateGraph(node.subgraph, errors, false)
    }
    nodes.set(node.id, node)
    outEdges.set(node.id, [])
  }

  for (const edge of graph.edges) {
    const key = JSON.stringify([edge.from, edge.to, edge.label ?? null])
    if (edgeKeys.has(key)) {
      errors.push(`duplicate edge from "${edge.from}" to "${edge.to}"${edge.label === undefined ? '' : ` labeled "${edge.label}"`}`)
    }
    edgeKeys.add(key)
    if (edge.from === edge.to) errors.push(`edge "${edge.id}" connects a node to itself`)
    if (!nodes.has(edge.from)) errors.push(`edge "${edge.id}" starts at unknown node "${edge.from}"`)
    if (!nodes.has(edge.to)) errors.push(`edge "${edge.id}" ends at unknown node "${edge.to}"`)
    const out = outEdges.get(edge.from)
    if (out !== undefined) out.push(edge)
  }

  const inEdges = new Map<string, FlowEdge[]>()
  for (const node of graph.nodes) inEdges.set(node.id, [])
  for (const edge of graph.edges) inEdges.get(edge.to)?.push(edge)

  for (const node of graph.nodes) {
    /* v8 ignore next -- every node id is seeded into outEdges when the nodes are indexed */
    const out = outEdges.get(node.id) ?? []
    switch (node.type) {
      case 'start':
        if (out.length !== 1) errors.push(`start node "${node.id}" needs exactly one outgoing edge (found ${out.length})`)
        break
      case 'end':
        if (out.length !== 0) errors.push(`end node "${node.id}" cannot have outgoing edges`)
        break
      case 'condition':
      case 'loop':
        checkBranchLabels(node, out, BRANCH_LABELS[node.type], errors)
        break
      case 'classify':
        checkClassifyLabels(node, out, errors)
        break
      case 'agent':
      case 'http':
      case 'template':
      case 'code':
      case 'aggregate':
      case 'list':
      case 'extract':
        // 0 outgoing edges is a valid terminal; >= 2 is a parallel fan-out
        // whose reconvergence the exclusivity analysis rejects unless the
        // shared successor is an explicit join.
        break
      case 'join':
        if (out.length > 1) errors.push(`join node "${node.id}" needs at most one outgoing edge (found ${out.length})`)
        break
    }
  }
  for (const edge of graph.edges) {
    const source = nodes.get(edge.from)
    if (source === undefined) continue
    if (
      edge.label !== undefined
      && (source.type === 'agent' || source.type === 'http' || source.type === 'template' || source.type === 'code' || source.type === 'aggregate' || source.type === 'list' || source.type === 'extract' || source.type === 'join' || source.type === 'start' || source.type === 'end')
    ) {
      errors.push(`edge "${edge.id}" carries a branch label on a ${source.type} node`)
    }
    if (source.type === 'condition' && edge.label !== 'true' && edge.label !== 'false') {
      errors.push(`condition node "${source.id}" edge "${edge.id}" must be labeled true or false`)
    }
    if (source.type === 'loop' && edge.label !== 'body' && edge.label !== 'after') {
      errors.push(`loop node "${source.id}" edge "${edge.id}" must be labeled body or after`)
    }
  }

  if (errors.length > 0) return

  // Reachability requires a valid edge set (no duplicate/unknown edges above).
  const cyclic = cycleNodes(graph, outEdges)
  if (cyclic.length > 0) errors.push(`flow contains a cycle through: ${cyclic.join(', ')}`)
  const topo = topologicalOrder(graph, outEdges)
  if (topo === undefined) return
  /* v8 ignore next -- a missing start already pushed a finding and the graph returned above */
  if (startId === undefined) return
  /* v8 ignore next -- a cycle pushes a finding and makes topo undefined, so errors are empty here */
  if (errors.length > 0) return

  const reachableFromStart = reachable(startId, outEdges)
  for (const node of graph.nodes) {
    if (!reachableFromStart.has(node.id)) errors.push(`node "${node.id}" is unreachable from start`)
  }
  /* v8 ignore start -- in an acyclic graph every node reaches a terminal, so this finding cannot fire */
  for (const node of graph.nodes) {
    if ((outEdges.get(node.id)?.length ?? 0) !== 0 && !reachesTerminal(node.id, outEdges)) {
      errors.push(`node "${node.id}" reaches no terminal (an end node or a node with no outgoing edges)`)
    }
  }
  /* v8 ignore stop */
  if (errors.length > 0) return

  const exclusivity = checkExclusivity(graph, topo, outEdges)
  if (exclusivity !== undefined) {
    for (const error of exclusivity) errors.push(error)
  }
}

/** Validate a branch node's two outgoing edges and their labels, appending findings. */
function checkBranchLabels(
  node: FlowNode,
  out: FlowEdge[],
  labels: readonly string[],
  errors: string[],
): void {
  if (out.length !== 2) {
    errors.push(`${node.type} node "${node.id}" needs exactly two outgoing edges (found ${out.length})`)
    return
  }
  for (const edge of out) {
    if (edge.label === undefined || !labels.includes(edge.label)) {
      errors.push(`${node.type} node "${node.id}" edge "${edge.id}" must be labeled ${labels.join(' or ')}`)
    }
  }
}

/**
 * Validate a classify node's outgoing edges: one labeled edge per class id,
 * plus an optional `default` for a null / unknown structured result.
 */
function checkClassifyLabels(
  node: FlowNode,
  out: FlowEdge[],
  errors: string[],
): void {
  if (node.type !== 'classify') return
  const classIds = node.classes
    .map(item => item.id)
    .filter(id => id.trim() !== '' && id !== 'default')
  const seen = new Set<string>()
  for (const edge of out) {
    if (edge.label === undefined || (edge.label !== 'default' && !classIds.includes(edge.label))) {
      errors.push(`classify node "${node.id}" edge "${edge.id}" must be labeled with a class id or default`)
      continue
    }
    if (seen.has(edge.label)) {
      errors.push(`classify node "${node.id}" repeats outgoing label "${edge.label}"`)
      continue
    }
    seen.add(edge.label)
  }
  for (const id of classIds) {
    if (!seen.has(id)) {
      errors.push(`classify node "${node.id}" is missing an outgoing edge labeled "${id}"`)
    }
  }
}

/** Whether `name` is a legal JS identifier. */
function isValidIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}

/**
 * A deterministic topological order via Kahn's algorithm; `undefined` when the
 * graph has a cycle (see {@link cycleNodes} for the finding).
 */
function topologicalOrder(graph: FlowGraph, outEdges: Map<string, FlowEdge[]>): string[] | undefined {
  const indegree = new Map<string, number>()
  for (const node of graph.nodes) indegree.set(node.id, 0)
  /* v8 ignore next -- every node id is seeded with 0 above, so the fallback is never read */
  for (const edge of graph.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  /* v8 ignore next -- every node id is seeded with 0 above, so the fallback is never read */
  const queue: string[] = graph.nodes.filter(node => (indegree.get(node.id) ?? 0) === 0).map(node => node.id).sort()
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    /* v8 ignore next -- every reachable target id is seeded in indegree */
    for (const edge of outEdges.get(id) ?? []) {
      /* v8 ignore next -- every reachable target id is seeded in indegree */
      const next = (indegree.get(edge.to) ?? 1) - 1
      indegree.set(edge.to, next)
      if (next === 0) {
        queue.push(edge.to)
        queue.sort()
      }
    }
  }
  return order.length === graph.nodes.length ? order : undefined
}

/** The nodes on a cycle, in stable order, or an empty list for an acyclic graph. */
function cycleNodes(graph: FlowGraph, outEdges: Map<string, FlowEdge[]>): string[] {
  const indegree = new Map<string, number>()
  for (const node of graph.nodes) indegree.set(node.id, 0)
  /* v8 ignore next -- every node id is seeded with 0 above, so the fallback is never read */
  for (const edge of graph.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  /* v8 ignore next -- every node id is seeded with 0 above, so the fallback is never read */
  const queue: string[] = graph.nodes.filter(node => (indegree.get(node.id) ?? 0) === 0).map(node => node.id)
  while (queue.length > 0) {
    const id = queue.shift() as string
    /* v8 ignore next -- every reachable target id is seeded in indegree */
    for (const edge of outEdges.get(id) ?? []) {
      /* v8 ignore next -- every reachable target id is seeded in indegree */
      const next = (indegree.get(edge.to) ?? 1) - 1
      indegree.set(edge.to, next)
      if (next === 0) queue.push(edge.to)
    }
  }
  /* v8 ignore next -- every node id is seeded with 0 above, so the fallback is never read */
  return graph.nodes.filter(node => (indegree.get(node.id) ?? 0) > 0).map(node => node.id).sort()
}

/** Whether `from` can reach any terminal (a node with no outgoing edges). */
function reachesTerminal(from: string, outEdges: Map<string, FlowEdge[]>): boolean {
  const seen = new Set<string>([from])
  const queue = [from]
  while (queue.length > 0) {
    const id = queue.shift() as string
    /* v8 ignore next -- every node id reached here is seeded in outEdges */
    if ((outEdges.get(id)?.length ?? 0) === 0) return true
    /* v8 ignore next -- every node id reached here is seeded in outEdges */
    for (const edge of outEdges.get(id) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to)
        queue.push(edge.to)
      }
    }
  }
  /* v8 ignore next -- an acyclic graph's walk always finds a terminal, so the loop never exhausts */
  return false
}

/** The set of nodes reachable from `from`. */
function reachable(from: string, outEdges: Map<string, FlowEdge[]>): Set<string> {
  const seen = new Set<string>([from])
  const queue = [from]
  while (queue.length > 0) {
    const id = queue.shift() as string
    /* v8 ignore next -- the walk only ever visits ids seeded in outEdges */
    for (const edge of outEdges.get(id) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to)
        queue.push(edge.to)
      }
    }
  }
  return seen
}

/**
 * The branch-context exclusivity analysis. Returns the findings, or `undefined`
 * when every merge is provably single-arrival.
 */
function checkExclusivity(
  graph: FlowGraph,
  topo: string[],
  outEdges: Map<string, FlowEdge[]>,
): string[] | undefined {
  const errors: string[] = []
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const contexts = new Map<string, BranchContext[]>()
  const incoming = new Map<string, BranchContext[]>()
  for (const node of graph.nodes) {
    contexts.set(node.id, [])
    incoming.set(node.id, [])
  }
  const start = graph.nodes.find(node => node.type === 'start')
  /* v8 ignore next -- a validated graph has exactly one start, and checkExclusivity runs only on valid graphs */
  if (start === undefined) return errors.length > 0 ? errors : undefined
  contexts.set(start.id, [new Map()])

  let overflow: string | undefined
  for (const id of topo) {
    const node = nodes.get(id)
    /* v8 ignore next -- topo ids are graph node ids, all present in nodes */
    if (node === undefined) continue
    /* v8 ignore next -- every node id is seeded in contexts above */
    const nodeContexts = contexts.get(id) ?? []
    /* v8 ignore next -- outEdges is seeded for every node id by the caller */
    const out = outEdges.get(id) ?? []
    if (node.type === 'join') {
      // A join is a sync barrier: one continuation, one collapsed context.
      // Passing every incoming context through would make the successor a
      // non-exclusive merge even though the arms already waited here.
      const next = out[0]
      if (next !== undefined && nodeContexts.length > 0) {
        if (!propagate(contexts, incoming, extend(new Map(), id, 'joined'), next.to)) {
          overflow = contextOverflow(node.id)
        }
      }
      continue
    }
    for (const context of nodeContexts) {
      if (overflow !== undefined) break
      switch (node.type) {
        case 'start':
          for (const edge of out) {
            /* v8 ignore next 3 -- the start is the only zero-indegree node, so its single target has no contexts yet */
            if (!propagate(contexts, incoming, context, edge.to)) {
              overflow = contextOverflow(node.id)
            }
          }
          break
        case 'end':
          break
        case 'agent':
        case 'http':
        case 'template':
        case 'code':
        case 'aggregate':
        case 'list':
        case 'extract': {
          let branch = 0
          for (const edge of out) {
            const next = out.length === 1 ? context : extend(context, id, `p${branch}`)
            if (!propagate(contexts, incoming, next, edge.to)) {
              overflow = contextOverflow(node.id)
              break
            }
            branch++
          }
          break
        }
        case 'condition':
        case 'loop':
        case 'classify':
          for (const edge of out) {
            if (!propagate(contexts, incoming, extend(context, id, edge.label as string), edge.to)) {
              overflow = contextOverflow(node.id)
              break
            }
          }
          break
      }
    }
  }
  if (overflow !== undefined) return [overflow]

  for (const node of graph.nodes) {
    /* v8 ignore next -- every node id is seeded in incoming above */
    const ins = incoming.get(node.id) ?? []
    if (ins.length < 2 || !hasNonExclusivePair(ins, nodes, topo)) continue
    if (node.type === 'join') continue
    errors.push(
      `node "${node.id}" is reached by branches that can both run — merge only after a condition's`
      + ' true/false split or a classify class split, never after a parallel fan-out or a loop body/after split',
    )
  }

  return errors.length > 0 ? errors : undefined
}

/** Whether any pair of a node's incoming contexts can both run. */
function hasNonExclusivePair(
  ins: readonly BranchContext[],
  nodes: Map<string, FlowNode>,
  topo: string[],
): boolean {
  for (let i = 0; i < ins.length; i++) {
    const a = ins[i]
    /* v8 ignore next -- incoming holds only BranchContext objects, never undefined */
    if (a === undefined) continue
    for (let j = i + 1; j < ins.length; j++) {
      const b = ins[j]
      /* v8 ignore next -- incoming holds only BranchContext objects, never undefined */
      if (b === undefined) continue
      if (!contextsExclusive(a, b, nodes, topo)) return true
    }
  }
  return false
}

/** The overflow finding for a node whose context set hit the cap. */
function contextOverflow(nodeId: string): string {
  return `flow is too complex: node "${nodeId}" accumulates over ${MAX_CONTEXTS_PER_NODE} branch contexts`
}

/**
 * Add a context to a node, deduplicated and bounded, and record it as a
 * delivered in-edge context.
 * @param contexts - per-node deduplicated context sets (drives propagation).
 * @param incoming - per-node delivered in-edge contexts (drives merge checks).
 * @param context - the context to deliver.
 * @param nodeId - the receiving node.
 * @returns `false` when the node's context set hit the cap (the analysis must
 *   stop — a truncated context set would misjudge merges), otherwise `true`.
 */
function propagate(
  contexts: Map<string, BranchContext[]>,
  incoming: Map<string, BranchContext[]>,
  context: BranchContext,
  nodeId: string,
): boolean {
  const list = contexts.get(nodeId)
  /* v8 ignore next -- nodeId is a validated node id, seeded in contexts */
  if (list === undefined) return true
  for (const existing of list) {
    /* v8 ignore next -- every delivered context is new: distinct paths diverge at a recorded split */
    if (sameContext(existing, context)) return true
  }
  if (list.length >= MAX_CONTEXTS_PER_NODE) return false
  list.push(context)
  incoming.get(nodeId)?.push(context)
  return true
}

/** Whether two contexts record the same split decisions. */
function sameContext(a: BranchContext, b: BranchContext): boolean {
  if (a.size !== b.size) return false
  for (const [split, branch] of a) {
    if (b.get(split) !== branch) return false
  }
  /* v8 ignore next -- propagate deduplicates, so no two delivered contexts are ever equal */
  return true
}

/** A context with one split decision added. */
function extend(context: BranchContext, split: string, branch: string): BranchContext {
  const next = new Map(context)
  next.set(split, branch)
  return next
}

/**
 * Whether two incoming contexts are mutually exclusive: their first divergence
 * in topological order is at a condition (exactly one branch executes). A
 * divergence at a parallel fan-out or a loop body/after split, or no divergence
 * at all, means both paths can run.
 */
function contextsExclusive(
  a: BranchContext,
  b: BranchContext,
  nodes: Map<string, FlowNode>,
  topo: string[],
): boolean {
  for (const splitId of topo) {
    /* v8 ignore next -- splitId iterates topo, a set of graph node ids, all present in nodes */
    const type = nodes.get(splitId)?.type
    if (type !== 'condition' && type !== 'loop' && type !== 'agent' && type !== 'http' && type !== 'template' && type !== 'code' && type !== 'aggregate' && type !== 'list' && type !== 'classify' && type !== 'extract') continue
    const branchA = a.get(splitId)
    const branchB = b.get(splitId)
    if (branchA !== undefined && branchB !== undefined && branchA !== branchB) {
      return type === 'condition' || type === 'classify'
    }
    // One branch selecting a split the other never reaches is a divergence
    // above that split — an earlier topo entry carries it, so skip.
  }
  /* v8 ignore next -- two distinct incoming contexts always diverge at a recorded split, so the loop never exhausts */
  return false
}
