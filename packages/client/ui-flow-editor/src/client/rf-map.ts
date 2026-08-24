/**
 * Pure graph ↔ React Flow mapping for the shared canvas: a {@link FlowGraph}
 * becomes React Flow's `Node[]`/`Edge[]`, and React Flow's gesture events
 * reduce to {@link FlowCanvasSurface} calls. No DOM and no React Flow store is
 * touched, so every mapping is unit-tested without a canvas — the jsdom specs
 * that drive the real canvas assert the same math through the DOM.
 */

import type { ReactNode } from 'react'
import type { Connection, Edge, Node } from '@xyflow/react'
import type { FlowGraph, FlowNode } from '@deepseek-ai/dsh-flow/types'
import type { FlowCanvasSurface } from './FlowCanvas.tsx'

/** The custom node type id the canvas registers. */
export const CANVAS_NODE_TYPE = 'flowCanvas'
/** The custom edge type id the canvas registers. */
export const INSERTABLE_EDGE_TYPE = 'insertable'

/** The data one canvas node carries: the flow node plus the render/gesture hooks. */
export type CanvasNodeData = {
  /** The flow node being rendered. */
  readonly node: FlowNode
  /** The caller's card renderer for one node. */
  readonly renderNode: (node: FlowNode) => ReactNode
  /** Whether the canvas is read-only (hides the connect handles and add button). */
  readonly readOnly: boolean
  /** The caller's per-node extra class, for run-status accents. */
  readonly nodeClass?: (node: FlowNode) => string | undefined
  /** The connect handle's accessible name. */
  readonly connectAriaLabel?: string
  /** Opens the caller's node picker for a successor of this node. */
  readonly onAddNode?: (nodeId: string) => void
  /** The add button's accessible name. */
  readonly addNodeAriaLabel?: string
}

/** The data one insertable edge carries: the branch label plus the insert hook. */
export type InsertableEdgeData = {
  /** Whether the canvas is read-only (hides the edge's insert button). */
  readonly readOnly: boolean
  /** The branch label (`true`/`false`/`body`/`after`). */
  readonly label?: string
  /** Opens the caller's node picker to insert between two nodes. */
  readonly onInsertBetween?: (from: string, to: string) => void
  /** The insert button's accessible name. */
  readonly insertBetweenAriaLabel?: string
}

/** The React Flow node model the canvas renders. */
export type CanvasNodeModel = Node<CanvasNodeData, typeof CANVAS_NODE_TYPE>
/** The React Flow edge model the canvas renders. */
export type InsertableEdgeModel = Edge<InsertableEdgeData, typeof INSERTABLE_EDGE_TYPE>

/** The surface options every node mapping reads. */
export interface CanvasNodeOptions {
  readonly readOnly: boolean
  readonly selectedNodeId: string | null
  /** The caller's per-node extra class, for run-status accents. */
  readonly nodeClass?: (node: FlowNode) => string | undefined
  /** The connect handle's accessible name. */
  readonly connectAriaLabel?: string
  /** Opens the caller's node picker for a successor of this node. */
  readonly onAddNode?: (nodeId: string) => void
  /** The add button's accessible name. */
  readonly addNodeAriaLabel?: string
}

/** The surface options every edge mapping reads. */
export interface CanvasEdgeOptions {
  readonly readOnly: boolean
  readonly selectedEdgeId: string | null
  /** Opens the caller's node picker to insert between two nodes. */
  readonly onInsertBetween?: (from: string, to: string) => void
  /** The insert button's accessible name. */
  readonly insertBetweenAriaLabel?: string
}

/**
 * Project a flow graph onto React Flow's node array: one custom node per flow
 * node, positioned and selected from the surface's current state, with the
 * render/gesture hooks carried on the node data.
 * @param graph - the flow graph being edited, or null while none is loaded.
 * @param renderNode - the caller's card renderer for one node.
 * @param options - the canvas state the mapping reads (selection, read-only, hooks).
 * @returns React Flow nodes; empty for a null graph.
 */
export function graphToRfNodes(
  graph: FlowGraph | null,
  renderNode: (node: FlowNode) => ReactNode,
  options: CanvasNodeOptions,
): CanvasNodeModel[] {
  if (graph === null) return []
  return graph.nodes.map(node => ({
    id: node.id,
    type: CANVAS_NODE_TYPE,
    position: { x: node.position.x, y: node.position.y },
    selected: node.id === options.selectedNodeId,
    data: {
      node,
      renderNode,
      readOnly: options.readOnly,
      // exactOptionalPropertyTypes: an absent optional field must be omitted,
      // not spelled as `undefined`.
      ...(options.nodeClass === undefined ? {} : { nodeClass: options.nodeClass }),
      ...(options.connectAriaLabel === undefined ? {} : { connectAriaLabel: options.connectAriaLabel }),
      ...(options.onAddNode === undefined ? {} : { onAddNode: options.onAddNode }),
      ...(options.addNodeAriaLabel === undefined ? {} : { addNodeAriaLabel: options.addNodeAriaLabel }),
    },
  }))
}

/**
 * Project a flow graph onto React Flow's edge array: one insertable edge per
 * flow edge, selected from the surface's current state, with the branch label
 * and insert hook on the edge data.
 * @param graph - the flow graph being edited, or null while none is loaded.
 * @param options - the canvas state the mapping reads (selection, read-only, hook).
 * @returns React Flow edges; empty for a null graph.
 */
export function graphToRfEdges(
  graph: FlowGraph | null,
  options: CanvasEdgeOptions,
): InsertableEdgeModel[] {
  if (graph === null) return []
  return graph.edges.map(edge => ({
    id: edge.id,
    type: INSERTABLE_EDGE_TYPE,
    source: edge.from,
    target: edge.to,
    selected: edge.id === options.selectedEdgeId,
    data: {
      readOnly: options.readOnly,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      ...(options.onInsertBetween === undefined ? {} : { onInsertBetween: options.onInsertBetween }),
      ...(options.insertBetweenAriaLabel === undefined ? {} : { insertBetweenAriaLabel: options.insertBetweenAriaLabel }),
    },
  }))
}

/**
 * Reduce React Flow's selection-change report to the surface's single
 * selection: the first selected node and the first selected edge. React Flow
 * reports selection arrays (multi-select support), while the surface owns
 * exactly one selected node and one selected edge.
 * @param nodes - nodes selected in React Flow.
 * @param edges - edges selected in React Flow.
 * @returns the single selected ids, null when nothing is selected.
 */
export function selectionFrom(
  nodes: readonly Node[],
  edges: readonly Edge[],
): { readonly nodeId: string | null; readonly edgeId: string | null } {
  return { nodeId: nodes[0]?.id ?? null, edgeId: edges[0]?.id ?? null }
}

/**
 * Route a completed React Flow connection to the surface. The connection's
 * endpoints are already validated by React Flow (a real handle-to-handle
 * drag), so no further guard is needed.
 * @param connection - the completed connection.
 * @param surface - the graph owner to route the new edge to.
 */
export function applyConnect(connection: Connection, surface: FlowCanvasSurface): void {
  surface.addEdge(connection.source, connection.target)
}

/**
 * Clamp a graph position at the canvas origin. Node drags are clamped by React
 * Flow's `nodeExtent`, so this guards the palette drop, whose raw
 * `screenToFlowPosition` point can land up-left of the origin.
 * @param position - the raw graph position.
 * @returns the position with both coordinates clamped to zero.
 */
export function clampPosition(position: { readonly x: number; readonly y: number }): {
  readonly x: number
  readonly y: number
} {
  return { x: Math.max(0, position.x), y: Math.max(0, position.y) }
}
