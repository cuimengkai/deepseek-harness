/**
 * The preset canvas's flow-canvas surface: the `FlowCanvasSurface` face the
 * shared canvas gestures against, adapted to the graph-backed composer.
 *
 * The session flow editor and the preset composer share the canvas gestures
 * (drag, connect, palette drop, delete key) through the surface, and this
 * factory is the preset side of that seam. Selection lives in the composer
 * component as local state (the read-only design page needs it too), so the
 * factory takes the current selection and the mutation actions as values and
 * routes every canvas mutation through them. Adding a dropped module selects
 * the new node; removing one clears the selection, so a stale inspector never
 * outlives its node.
 */

import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import type { FlowCanvasSurface } from '@deepseek-ai/dsh-client-ui-flow-editor/client'

/** The preset-side mutations the surface routes to. */
export interface PresetSurfaceActions {
  selectNode: (id: string | null) => void
  selectEdge: (id: string | null) => void
  /** Move one node's canvas position (the drag gesture). */
  moveNode: (id: string, position: { x: number; y: number }) => void
  /** Remove one node by canvas id (the delete key). */
  removeNode: (id: string) => void
  /** Remove one edge; a no-op for preset chains, whose edges are implicit. */
  removeEdge: (id: string) => void
  /**
   * Add a module at a graph position (the palette drop). Returns the new node
   * id, or undefined when the module is already composed.
   */
  addNodeAt: (moduleName: string, position: { x: number; y: number }) => string | undefined
  /** Reorder the chain so `to` runs right after `from` (the connect gesture). */
  addEdge: (from: string, to: string) => void
}

/**
 * Build the preset composer's canvas surface over a draft graph and the
 * component's selection state and actions.
 * @param graph - the draft graph being edited, or null when none is open.
 * @param selectedNodeId - the selected node id, or null.
 * @param selectedEdgeId - the selected edge id, or null.
 * @param readOnly - whether the canvas accepts edits (selection stays live).
 * @param actions - the mutation actions.
 * @returns the surface the shared canvas gestures against.
 */
export function presetFlowSurface(
  graph: FlowGraph | null,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
  readOnly: boolean,
  actions: PresetSurfaceActions,
): FlowCanvasSurface {
  return {
    graph,
    selectedNodeId,
    selectedEdgeId,
    readOnly,
    selectNode: actions.selectNode,
    selectEdge: actions.selectEdge,
    moveNode: actions.moveNode,
    addEdge: actions.addEdge,
    removeNode: (id) => { actions.removeNode(id); actions.selectNode(null) },
    removeEdge: (id) => { actions.removeEdge(id); actions.selectEdge(null) },
    addNodeAt: (data, position) => {
      const nodeId = actions.addNodeAt(data, position)
      if (nodeId !== undefined) actions.selectNode(nodeId)
    },
  }
}
