/**
 * The shared flow canvas: a React Flow viewport over a {@link FlowGraph} with
 * pan/zoom, node drag, edge drawing, palette drop, and delete-key gestures.
 * The {@link FlowCanvasSurface} face decouples the gestures from any specific
 * graph owner — the session flow editor's per-session controller and the
 * agent-preset composer's graph-backed rows both drive it — and node content
 * is a caller-provided render slot, so card styling stays with the caller
 * while the canvas owns the geometry.
 *
 * The viewport is @xyflow/react (React Flow); this module only wires the
 * surface to the library's controlled store. Gesture→surface mapping is pure
 * (rf-map.ts) so it is unit-tested without a DOM; this package's jsdom spec
 * drives the real React Flow canvas for the gestures that are reliable under
 * jsdom (select, drag, drop, pane, key) and asserts the same mapping through
 * the DOM.
 */

import {
  useCallback, useEffect, useLayoutEffect, useRef,
  type DragEvent as ReactDragEvent, type ReactNode,
} from 'react'
import {
  Background, BackgroundVariant, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type EdgeTypes, type Node as RfNode,
  type NodeTypes, type OnSelectionChangeParams,
} from '@xyflow/react'
import type { FlowGraph, FlowNode } from '@deepseek-ai/dsh-flow/types'
import {
  applyConnect, CANVAS_NODE_TYPE, clampPosition, graphToRfEdges, graphToRfNodes,
  INSERTABLE_EDGE_TYPE, selectionFrom,
  type CanvasEdgeOptions, type CanvasNodeModel, type CanvasNodeOptions, type InsertableEdgeModel,
} from './rf-map.ts'
import { CanvasNode } from './CanvasNode.tsx'
import { InsertableEdge } from './InsertableEdge.tsx'
import './xyflow-base.css'
import './flow-overrides.css'
import css from './FlowCanvas.module.css'

/** The data-transfer key a palette drop carries the payload under by default. */
const DEFAULT_MIME = 'application/x-flow-node'

/** The canvas's node/edge renderers, registered once per module load. */
const NODE_TYPES: NodeTypes = { [CANVAS_NODE_TYPE]: CanvasNode }
const EDGE_TYPES: EdgeTypes = { [INSERTABLE_EDGE_TYPE]: InsertableEdge }

/**
 * The graph owner a canvas gestures against. The canvas reads the current
 * graph and selection from this face every render and routes every mutation
 * through it, so any controller can present its graph.
 */
export interface FlowCanvasSurface {
  /** The graph being edited, or null while no graph is loaded. */
  graph: FlowGraph | null
  /** The selected node's id, or null. */
  selectedNodeId: string | null
  /** The selected edge's id, or null. */
  selectedEdgeId: string | null
  /** Whether the canvas accepts edits (pan/zoom stay enabled). */
  readOnly: boolean
  /** Select one node, or deselect with null. */
  selectNode(id: string | null): void
  /** Select one edge, or deselect with null. */
  selectEdge(id: string | null): void
  /** Move one node to a graph position. */
  moveNode(id: string, position: { x: number; y: number }): void
  /** Connect two nodes; a refused gesture surfaces on the surface. */
  addEdge(from: string, to: string): void
  /** Remove one node and its edges. */
  removeNode(id: string): void
  /** Remove one edge. */
  removeEdge(id: string): void
  /**
   * Add a node from a palette drop. `data` is the drop payload the surface
   * chose to accept (a node type for the flow editor, a module name for the
   * preset composer); the surface validates and refuses what it cannot place.
   */
  addNodeAt(data: string, position: { x: number; y: number }): void
}

/** Props for the shared flow canvas. */
export interface FlowCanvasProps {
  /** The graph owner the canvas gestures against. */
  surface: FlowCanvasSurface
  /** Render one node's card content (inside the canvas's positioned wrapper). */
  renderNode: (node: FlowNode) => ReactNode
  /** A caller-side class for a node's wrapper (e.g. a run-status accent). */
  nodeClass?: (node: FlowNode) => string | undefined
  /** The data-transfer key a palette drop carries the payload under. */
  dropMime?: string
  /** A corner hint about the gestures; hidden when omitted. */
  canvasHint?: ReactNode
  /** The connect port's accessible name. */
  connectAriaLabel?: string
  /** Opens the caller's node picker for a successor of a node. */
  onAddNode?: (nodeId: string) => void
  /** The node add button's accessible name. */
  addNodeAriaLabel?: string
  /** Opens the caller's node picker to insert between two nodes. */
  onInsertBetween?: (from: string, to: string) => void
  /** The edge insert button's accessible name. */
  insertBetweenAriaLabel?: string
}

/** The shared flow canvas viewport. */
export function FlowCanvas(props: FlowCanvasProps): ReactNode {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

/** The canvas body, inside the React Flow provider so the store is available. */
function FlowCanvasInner({
  surface, renderNode, nodeClass, dropMime = DEFAULT_MIME, canvasHint, connectAriaLabel,
  onAddNode, addNodeAriaLabel, onInsertBetween, insertBetweenAriaLabel,
}: FlowCanvasProps): ReactNode {
  const { graph, selectedNodeId, selectedEdgeId, readOnly } = surface
  // The latest surface, read by the gesture handlers without re-registering
  // them on every owner render.
  const surfaceRef = useRef(surface)
  useEffect(() => { surfaceRef.current = surface })
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const { fitView, screenToFlowPosition } = useReactFlow()
  const initialized = useNodesInitialized()

  // exactOptionalPropertyTypes: the mapping options keep absent optional hooks
  // omitted rather than spelled as `undefined`.
  const nodeOptions: CanvasNodeOptions = {
    readOnly,
    selectedNodeId,
    ...(nodeClass === undefined ? {} : { nodeClass }),
    ...(connectAriaLabel === undefined ? {} : { connectAriaLabel }),
    ...(onAddNode === undefined ? {} : { onAddNode }),
    ...(addNodeAriaLabel === undefined ? {} : { addNodeAriaLabel }),
  }
  const edgeOptions: CanvasEdgeOptions = {
    readOnly,
    selectedEdgeId,
    ...(onInsertBetween === undefined ? {} : { onInsertBetween }),
    ...(insertBetweenAriaLabel === undefined ? {} : { insertBetweenAriaLabel }),
  }

  // The controlled store state: React Flow applies drag frames live through
  // onNodesChange/onEdgesChange, and only the drag-stop commits to the surface.
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeModel>(
    graphToRfNodes(graph, renderNode, nodeOptions),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<InsertableEdgeModel>(
    graphToRfEdges(graph, edgeOptions),
  )

  // Re-derive the nodes/edges whenever the graph or a mapping input changes.
  // Selection is deliberately absent from this effect's inputs: it has its own
  // sync below, and including it here would reset a node's drag frame whenever
  // the owner re-renders mid-gesture.
  useLayoutEffect(() => {
    setNodes(graphToRfNodes(graph, renderNode, nodeOptions))
    setEdges(graphToRfEdges(graph, edgeOptions))
  }, [graph, renderNode, nodeClass, connectAriaLabel, addNodeAriaLabel, onAddNode, insertBetweenAriaLabel, onInsertBetween, readOnly])

  // Map the surface's single selection onto React Flow's per-element `selected`
  // flag. Spreading preserves positions, so a selection change never rewinds a
  // node that is mid-drag.
  useEffect(() => {
    setNodes(current => current.map(node => ({ ...node, selected: node.id === selectedNodeId })))
    setEdges(current => current.map(edge => ({ ...edge, selected: edge.id === selectedEdgeId })))
  }, [selectedEdgeId, selectedNodeId])

  const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams): void => {
    // React Flow reports selection as arrays (multi-select); the surface owns
    // exactly one of each, so route the first and only act when it differs, or
    // the mapped `selected` flag would loop back through this handler.
    const current = surfaceRef.current
    const { nodeId, edgeId } = selectionFrom(selectedNodes, selectedEdges)
    if (current.selectedNodeId !== nodeId) current.selectNode(nodeId)
    if (current.selectedEdgeId !== edgeId) current.selectEdge(edgeId)
  }, [])

  const onNodeDragStop = useCallback((_: MouseEvent | TouchEvent, node: RfNode): void => {
    surfaceRef.current.moveNode(node.id, node.position)
  }, [])

  const onConnect = useCallback((connection: Connection): void => {
    applyConnect(connection, surfaceRef.current)
  }, [])

  const onPaneClick = useCallback((): void => {
    const current = surfaceRef.current
    if (current.selectedNodeId !== null) current.selectNode(null)
    if (current.selectedEdgeId !== null) current.selectEdge(null)
  }, [])

  const onDrop = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    const current = surfaceRef.current
    if (current.readOnly) return
    const data = event.dataTransfer.getData(dropMime)
    if (data.length === 0) return
    event.preventDefault()
    current.addNodeAt(data, clampPosition(screenToFlowPosition({ x: event.clientX, y: event.clientY })))
  }, [dropMime, screenToFlowPosition])

  const onDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    // Allow the drop only when the payload matches this canvas's mime and the
    // canvas is editable; anything else lets the browser handle the drag.
    const current = surfaceRef.current
    if (current.readOnly) return
    if (event.dataTransfer.types.includes(dropMime)) event.preventDefault()
  }, [dropMime])

  // Delete/Backspace removes the selected node or edge; focus inside an input
  // never triggers it, so typing in the inspector or run input is safe.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const current = surfaceRef.current
      if (current.readOnly) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null) return
      if (current.selectedNodeId !== null) {
        event.preventDefault()
        current.removeNode(current.selectedNodeId)
      } else if (current.selectedEdgeId !== null) {
        event.preventDefault()
        current.removeEdge(current.selectedEdgeId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])

  // Center the graph once on first layout. The initial view anchors the origin
  // top-left, which makes a short chain read as a page that was never laid out.
  // The fit runs only when React Flow has measured the nodes and the canvas has
  // a real size, and only once per mount — later pans and zooms own the view.
  // Retry when the wrapper later gains size (common when a flex parent was
  // zero-height on the first paint).
  const fittedRef = useRef(false)
  const tryFitView = useCallback((): void => {
    if (fittedRef.current) return
    if (!initialized) return
    if (graph === null || graph.nodes.length === 0) return
    const wrapper = wrapperRef.current
    if (wrapper === null) return
    const rect = wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    fittedRef.current = true
    void fitView({ padding: 0.2, duration: 0 })
  }, [fitView, graph, initialized])

  useLayoutEffect(() => {
    tryFitView()
  }, [tryFitView])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (wrapper === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { tryFitView() })
    observer.observe(wrapper)
    return () => { observer.disconnect() }
  }, [tryFitView])

  if (graph === null) return null

  return (
    <div className={css.canvas} ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        defaultEdgeOptions={{
          type: INSERTABLE_EDGE_TYPE,
          style: { stroke: '#475569', strokeWidth: 2.5 },
        }}
        nodeExtent={[[0, 0], [Infinity, Infinity]]}
        deleteKeyCode={null}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
        <MiniMap />
        {canvasHint === undefined ? null : <Panel position="bottom-left">{canvasHint}</Panel>}
      </ReactFlow>
    </div>
  )
}
