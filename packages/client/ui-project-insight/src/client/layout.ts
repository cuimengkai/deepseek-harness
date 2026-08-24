/**
 * The pure dagre layout behind the topology graph: a left-to-right layered
 * placement of the bounded node set. Positions are natural flow coordinates
 * normalized to the origin — the renderer fits the viewport to the returned
 * bbox, so nothing here depends on the container size and the layout is fully
 * deterministic. A small container never compresses node spacing, because
 * compressing positions below node width would stack nodes (positions are
 * flow-space corners; the node boxes stay their natural size).
 */

import dagre from '@dagrejs/dagre'

/** The default node card size the layout plans boxes around. */
export const NODE_WIDTH = 180
export const NODE_HEIGHT = 60

/** The rank/column spacing dagre lays the graph with. */
const RANK_DIR = 'LR'
const NODE_SEP = 48
const RANK_SEP = 80

/** One node's top-left corner in flow coordinates. */
export interface LayoutPoint {
  readonly x: number
  readonly y: number
}

/** The layout result: each node's corner plus the natural bounding box. */
export interface LayoutResult {
  /** Node id → top-left corner, origin-normalized. */
  readonly positions: ReadonlyMap<string, LayoutPoint>
  /** The natural layout width; the viewport fits to this. */
  readonly width: number
  /** The natural layout height; the viewport fits to this. */
  readonly height: number
}

/**
 * Lay the bounded node set left-to-right: nodes sharing a rank share a column,
 * edges flow right. The returned bbox is the extent of all node boxes after
 * normalizing the top-left to the origin.
 * @param nodes - the bounded node set.
 * @param edges - the bounded edge set.
 * @param nodeWidth - planned node box width.
 * @param nodeHeight - planned node box height.
 * @returns per-node corners plus the natural bounding box (empty for no nodes).
 */
export function layoutDagre(
  nodes: readonly { readonly id: string }[],
  edges: readonly { readonly source: string; readonly target: string }[],
  nodeWidth = NODE_WIDTH,
  nodeHeight = NODE_HEIGHT,
): LayoutResult {
  const positions = new Map<string, LayoutPoint>()
  if (nodes.length === 0) return { positions, width: 0, height: 0 }

  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: RANK_DIR, nodesep: NODE_SEP, ranksep: RANK_SEP })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const node of nodes) graph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
  for (const edge of edges) graph.setEdge(edge.source, edge.target)
  dagre.layout(graph)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const center = graph.node(node.id) as { readonly x?: number; readonly y?: number } | undefined
    if (center === undefined) continue
    if (center.x === undefined || center.y === undefined) continue
    const x = center.x - nodeWidth / 2
    const y = center.y - nodeHeight / 2
    positions.set(node.id, { x, y })
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + nodeWidth)
    maxY = Math.max(maxY, y + nodeHeight)
  }
  if (positions.size === 0) return { positions, width: 0, height: 0 }

  // Normalize to the origin so the returned bbox starts at (0, 0); the renderer
  // fits the viewport to that bbox regardless of dagre's internal margins.
  const normalized = new Map<string, LayoutPoint>()
  for (const node of nodes) {
    const point = positions.get(node.id)
    if (point === undefined) continue
    normalized.set(node.id, { x: point.x - minX, y: point.y - minY })
  }
  return {
    positions: normalized,
    width: maxX - minX,
    height: maxY - minY,
  }
}
