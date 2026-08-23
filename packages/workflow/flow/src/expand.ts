/**
 * Flow-graph expansion: flatten every agent node's `subgraph` into the graph
 * the engine actually compiles and seeds, so compilation and the run surface
 * see one flat id space. Sub-node ids are namespaced as
 * `${embedNodeId}-sub-${subNodeId}` (recursively, so a nested embedding
 * produces `embed-sub-embed-sub-…`), and the sub-graph's own `OUT`
 * references — in its prompts, condition expressions, and loop iterables —
 * are rewritten from the bare sub-node id to the namespaced one. The
 * expansion is pure: it returns a new graph plus an `owner` map and never
 * mutates its input.
 *
 * The rewrite is a strict-token substitution. Only `OUT` accessed directly by
 * a sub-node id (`OUT['a']` / `OUT["a"]` / `OUT.a`) is rewritten, only when
 * `a` is an id in that sub-graph (references to outer or sibling ids stay),
 * and only when `OUT` is not itself a member of a longer expression
 * (`foo.OUT.a` and `MYOUT.a` are left alone). A literal `OUT['a']` in a
 * prompt that was never meant as a reference is still rewritten — in the flow
 * vocabulary that spelling IS the reference syntax, so it is a documented
 * contract rather than a bug ([Known Limitations](README.md)).
 * @module @deepseek-ai/dsh-flow/expand
 */

import type { FlowEdge, FlowGraph, FlowNode } from './types.ts'

/** The flattened graph plus the ownership it carries. */
export interface ExpandedFlow {
  /** The outer nodes, then every sub-node under its namespaced id, with all edges. */
  readonly graph: FlowGraph
  /**
   * Each node id's owning node: a top-level node owns itself; a sub-node owns
   * the embedding node that contains it (the immediate embedder, so nested
   * sub-nodes own the node they are nested in, not the outermost one).
   */
  readonly owner: ReadonlyMap<string, string>
}

/** A reference to the shared `OUT` object's member via dot access (`OUT.a`). */
const OUT_DOT = /(?<![\w$.])OUT\.([A-Za-z_$][A-Za-z0-9_$]*)/g

/** A reference to the shared `OUT` object's member via quoted bracket access (`OUT['a']`). */
const OUT_BRACKET = /(?<![\w$.])OUT\s*\[\s*(['"])([^'"]+)\1\s*\]/g

/**
 * Expand a flow graph into the flat graph the engine compiles and runs.
 * @param graph - the flow to expand (must validate; each `subgraph` is
 *   assumed to be a valid standalone flow).
 * @returns the flattened graph and the owner map.
 */
export function expandGraph(graph: FlowGraph): ExpandedFlow {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const owner = new Map<string, string>()
  for (const node of graph.nodes) {
    owner.set(node.id, node.id)
    nodes.push(node)
    if (node.type === 'agent' && node.subgraph !== undefined) {
      embedSubgraph(node.id, node.subgraph, nodes, edges, owner)
    }
  }
  for (const edge of graph.edges) edges.push(edge)
  return {
    graph: {
      id: graph.id,
      name: graph.name,
      ...(graph.description === undefined ? {} : { description: graph.description }),
      nodes,
      edges,
    },
    owner,
  }
}

/**
 * Append one sub-graph's namespaced nodes and edges into the flat graph.
 * @param embedId - the embedding node's (already namespaced) id.
 * @param sub - the sub-graph to embed.
 * @param nodes - the flat node list to append to.
 * @param edges - the flat edge list to append to.
 * @param owner - the ownership map to populate.
 */
function embedSubgraph(
  embedId: string,
  sub: FlowGraph,
  nodes: FlowNode[],
  edges: FlowEdge[],
  owner: Map<string, string>,
): void {
  const subIds = new Set(sub.nodes.map(node => node.id))
  const ns = (id: string) => `${embedId}-sub-${id}`
  for (const node of sub.nodes) {
    const id = ns(node.id)
    owner.set(id, embedId)
    nodes.push(namespacedNode(node, ns, subIds))
    if (node.type === 'agent' && node.subgraph !== undefined) {
      embedSubgraph(id, node.subgraph, nodes, edges, owner)
    }
  }
  for (const edge of sub.edges) {
    edges.push({
      id: ns(edge.id),
      from: ns(edge.from),
      to: ns(edge.to),
      ...(edge.label === undefined ? {} : { label: edge.label }),
    })
  }
}

/** One sub node under its namespaced id, with its `OUT` references rewritten. */
function namespacedNode(node: FlowNode, ns: (id: string) => string, subIds: ReadonlySet<string>): FlowNode {
  if (node.type === 'agent') {
    return { ...node, id: ns(node.id), prompt: rewriteOutRefs(node.prompt, subIds, ns) }
  }
  if (node.type === 'condition') {
    return { ...node, id: ns(node.id), expression: rewriteOutRefs(node.expression, subIds, ns) }
  }
  if (node.type === 'loop') {
    return { ...node, id: ns(node.id), iterable: rewriteOutRefs(node.iterable, subIds, ns) }
  }
  return { ...node, id: ns(node.id) }
}

/**
 * Rewrite `OUT` references to sub-node ids in one sub-graph text (a prompt,
 * condition expression, or loop iterable) to the namespaced ids, so the
 * sub-graph keeps referring to its own outputs after flattening.
 * @param text - the JS expression or template-literal prompt source.
 * @param subIds - the sub-graph's own node ids (the only ids rewritten).
 * @param ns - the namespacing function for this sub-graph.
 * @returns the text with rewritten references.
 */
function rewriteOutRefs(text: string, subIds: ReadonlySet<string>, ns: (id: string) => string): string {
  return text
    .replace(OUT_BRACKET, (match, _quote: string, id: string) =>
      subIds.has(id) ? `OUT[${JSON.stringify(ns(id))}]` : match)
    .replace(OUT_DOT, (match, id: string) =>
      subIds.has(id) ? `OUT[${JSON.stringify(ns(id))}]` : match)
}
