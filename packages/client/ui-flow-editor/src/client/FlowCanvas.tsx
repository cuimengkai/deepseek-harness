/**
 * The shared flow canvas: a 2D dot-grid viewport over a {@link FlowGraph} with
 * pan/zoom, node drag, edge drawing, palette drop, and delete-key gestures.
 * The {@link FlowCanvasSurface} face decouples the gestures from any specific
 * graph owner — the session flow editor's per-session controller and the
 * agent-preset composer's graph-backed rows both drive it — and node content
 * is a caller-provided render slot, so card styling stays with the caller
 * while the canvas owns the geometry.
 */

import {
  useCallback, useEffect, useRef, useState,
  type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import type { FlowGraph, FlowNode } from '@deepseek-ai/dsh-flow/types'
import { clientToGraph, panView, zoomAt, type ViewState } from './view.ts'
import css from './FlowCanvas.module.css'

/** Node card dimensions (px) the edge geometry assumes, unless a caller overrides them. */
export const NODE_W = 168
export const NODE_H = 64
/** Horizontal spring of the cubic bezier edges. */
const EDGE_SPRING = 40
/** Padding around the node extent the canvas content reserves. */
const CANVAS_PAD = 32
/** The wheel zoom change per notch (1.2 in, 1/1.2 out). */
const ZOOM_STEP = 1.2
/** Client-pixel movement that separates a background pan from a click. */
const PAN_THRESHOLD = 3
/** The data-transfer key a palette drop carries the payload under by default. */
const DEFAULT_MIME = 'application/x-flow-node'

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
  /** Node card width the edge geometry assumes. */
  nodeWidth?: number
  /** Node card height the edge geometry assumes. */
  nodeHeight?: number
}

/** The bezier path between two nodes plus the label anchor at its midpoint. */
function edgeGeometry(
  from: FlowNode,
  to: FlowNode,
  nodeWidth: number,
  nodeHeight: number,
): { d: string; labelX: number; labelY: number } {
  const sx = from.position.x + nodeWidth
  const sy = from.position.y + nodeHeight / 2
  const tx = to.position.x
  const ty = to.position.y + nodeHeight / 2
  const d = `M ${sx} ${sy} C ${sx + EDGE_SPRING} ${sy}, ${tx - EDGE_SPRING} ${ty}, ${tx} ${ty}`
  const labelX = (sx + 3 * (sx + EDGE_SPRING) + 3 * (tx - EDGE_SPRING) + tx) / 8
  const labelY = (sy + ty) / 2
  return { d, labelX, labelY }
}

/** The extent the canvas content reserves so nothing clips at the scroll edge. */
function canvasExtent(
  nodes: readonly FlowNode[],
  nodeWidth: number,
  nodeHeight: number,
): { width: number; height: number } {
  let right = 0
  let bottom = 0
  for (const node of nodes) {
    right = Math.max(right, node.position.x + nodeWidth)
    bottom = Math.max(bottom, node.position.y + nodeHeight)
  }
  return { width: right + CANVAS_PAD, height: bottom + CANVAS_PAD }
}

/** The shared 2D flow canvas viewport. */
export function FlowCanvas({
  surface, renderNode, nodeClass, dropMime = DEFAULT_MIME, canvasHint, connectAriaLabel,
  nodeWidth = NODE_W, nodeHeight = NODE_H,
}: FlowCanvasProps): ReactNode {
  const { graph, selectedNodeId, selectedEdgeId, readOnly } = surface
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [connectPoint, setConnectPoint] = useState<{ x: number; y: number } | null>(null)
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef<{
    nodeId: string
    originX: number
    originY: number
    startX: number
    startY: number
  } | null>(null)
  const canvasPressRef = useRef(false)
  const panRef = useRef<{ startX: number; startY: number; origin: ViewState; moved: boolean } | null>(null)
  // The latest surface, read by the window and wheel handlers without
  // re-registering them every render.
  const surfaceRef = useRef(surface)
  useEffect(() => { surfaceRef.current = surface })

  // Native non-passive wheel listener: React registers wheel as passive, where
  // preventDefault is ignored, so the canvas owns the wheel to keep the page
  // from scrolling while zooming.
  useEffect(() => {
    const el = canvasRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent) => {
      if (surfaceRef.current.readOnly) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const point = { x: event.clientX, y: event.clientY }
      setView(prev => zoomAt(
        prev,
        point,
        { left: rect.left, top: rect.top },
        event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
      ))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [])

  // Delete/Backspace removes the selected node or edge; focus inside an input
  // never triggers it, so typing in the inspector or run input is safe.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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

  const canvasPoint = useCallback((e: ReactPointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return clientToGraph({ x: e.clientX, y: e.clientY }, { left: rect?.left ?? 0, top: rect?.top ?? 0 }, view)
  }, [view])

  /** The client point relative to the canvas origin (screen deltas for pan). */
  const screenPoint = useCallback((e: ReactPointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }, [])

  const beginConnect = useCallback((e: ReactPointerEvent, nodeId: string) => {
    e.stopPropagation()
    dragRef.current = null
    setConnectFrom(nodeId)
    setConnectPoint(canvasPoint(e))
  }, [canvasPoint])

  const onNodePointerDown = useCallback((e: ReactPointerEvent, node: FlowNode) => {
    e.stopPropagation()
    const current = surfaceRef.current
    if (connectFrom !== null) return
    // Selection works in read-only too: the preset design page shows a shipped
    // composition read-only but still selects nodes so the inspector explains
    // them. Only the drag-start (and its pointer capture) is gated on edits.
    current.selectNode(node.id)
    if (current.readOnly) return
    const point = canvasPoint(e)
    dragRef.current = {
      nodeId: node.id, originX: node.position.x, originY: node.position.y,
      startX: point.x, startY: point.y,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [canvasPoint, connectFrom])

  const onNodePointerMove = useCallback((e: ReactPointerEvent, node: FlowNode) => {
    const drag = dragRef.current
    if (drag === null || drag.nodeId !== node.id) return
    const point = canvasPoint(e)
    surfaceRef.current.moveNode(node.id, {
      x: Math.max(0, drag.originX + (point.x - drag.startX)),
      y: Math.max(0, drag.originY + (point.y - drag.startY)),
    })
  }, [canvasPoint])

  const onNodePointerUp = useCallback((e: ReactPointerEvent, node: FlowNode) => {
    const drag = dragRef.current
    if (drag !== null && drag.nodeId === node.id) {
      dragRef.current = null
      e.stopPropagation()
      return
    }
    if (connectFrom !== null && connectFrom !== node.id) {
      e.stopPropagation()
      surfaceRef.current.addEdge(connectFrom, node.id)
      setConnectFrom(null)
      setConnectPoint(null)
    }
  }, [connectFrom])

  const onCanvasPointerMove = useCallback((e: ReactPointerEvent) => {
    if (connectFrom !== null) {
      setConnectPoint(canvasPoint(e))
      return
    }
    const pan = panRef.current
    if (pan === null) return
    const point = screenPoint(e)
    const dx = point.x - pan.startX
    const dy = point.y - pan.startY
    if (Math.hypot(dx, dy) > PAN_THRESHOLD) pan.moved = true
    // The view only tracks once the gesture is committed as a pan, so a
    // slightly-dragged click keeps the canvas still and still deselects.
    if (pan.moved) {
      setView(panView(pan.origin, dx, dy))
    }
  }, [canvasPoint, connectFrom, screenPoint])

  const onCanvasPointerUp = useCallback((e: ReactPointerEvent) => {
    if (connectFrom !== null) {
      e.stopPropagation()
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node-id]')
      const targetId = target?.getAttribute('data-node-id')
      if (targetId !== null && targetId !== undefined && targetId !== connectFrom) {
        surfaceRef.current.addEdge(connectFrom, targetId)
      }
      setConnectFrom(null)
      setConnectPoint(null)
      dragRef.current = null
      return
    }
    if (dragRef.current !== null) {
      dragRef.current = null
      return
    }
    const pan = panRef.current
    if (pan !== null) {
      panRef.current = null
      if (pan.moved) return
    }
    if (canvasPressRef.current) {
      canvasPressRef.current = false
      surfaceRef.current.selectNode(null)
      surfaceRef.current.selectEdge(null)
    }
  }, [connectFrom])

  const onCanvasPointerDown = useCallback((e: ReactPointerEvent) => {
    canvasPressRef.current = true
    if (surfaceRef.current.readOnly) return
    const point = screenPoint(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    panRef.current = {
      startX: point.x, startY: point.y,
      origin: view,
      moved: false,
    }
  }, [screenPoint, view])

  const onCanvasDrop = useCallback((e: ReactDragEvent) => {
    const current = surfaceRef.current
    if (current.readOnly) return
    const data = e.dataTransfer.getData(dropMime)
    if (data.length === 0) return
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    const position = clientToGraph(
      { x: e.clientX, y: e.clientY },
      { left: rect?.left ?? 0, top: rect?.top ?? 0 },
      view,
    )
    current.addNodeAt(data, position)
  }, [dropMime, view])

  if (graph === null) return null

  const extent = canvasExtent(graph.nodes, nodeWidth, nodeHeight)
  return (
    <div
      className={css.canvas}
      ref={canvasRef}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onDragOver={(e) => { if (!surfaceRef.current.readOnly) e.preventDefault() }}
      onDrop={onCanvasDrop}
    >
      <div
        className={css.content}
        data-view-x={view.x}
        data-view-y={view.y}
        data-view-scale={view.scale}
        style={{
          width: extent.width,
          height: extent.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        <svg className={css.edges} width={extent.width} height={extent.height}>
          {graph.edges.map((edge) => {
            const from = graph.nodes.find(node => node.id === edge.from)
            const to = graph.nodes.find(node => node.id === edge.to)
            if (from === undefined || to === undefined) return null
            const { d, labelX, labelY } = edgeGeometry(from, to, nodeWidth, nodeHeight)
            const selected = edge.id === selectedEdgeId
            return (
              <g
                key={edge.id}
                className={`${css.edgeGroup}${selected ? ` ${css.edgeSelected}` : ''}`}
                onClick={(e) => { e.stopPropagation(); surfaceRef.current.selectEdge(edge.id) }}
              >
                <path className={css.edgeHit} d={d} />
                <path className={css.edgeStroke} d={d} />
                {edge.label !== undefined && (
                  <text className={css.edgeLabel} x={labelX} y={labelY}>{edge.label}</text>
                )}
              </g>
            )
          })}
          {connectFrom !== null && connectPoint !== null && (() => {
            const from = graph.nodes.find(node => node.id === connectFrom)
            if (from === undefined) return null
            const sx = from.position.x + nodeWidth
            const sy = from.position.y + nodeHeight / 2
            const { x, y } = connectPoint
            return (
              <path
                className={css.connectLine}
                d={`M ${sx} ${sy} C ${sx + EDGE_SPRING} ${sy}, ${x - EDGE_SPRING} ${y}, ${x} ${y}`}
              />
            )
          })()}
        </svg>
        {graph.nodes.map((node) => {
          const extra = nodeClass?.(node)
          const selected = node.id === selectedNodeId
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              className={`${css.node}${selected ? ` ${css.nodeSelected}` : ''}${extra === undefined ? '' : ` ${extra}`}`}
              style={{
                transform: `translate(${node.position.x}px, ${node.position.y}px)`,
                width: nodeWidth,
                minHeight: nodeHeight,
              }}
              onPointerDown={(e) => { onNodePointerDown(e, node) }}
              onPointerMove={(e) => { onNodePointerMove(e, node) }}
              onPointerUp={(e) => { onNodePointerUp(e, node) }}
            >
              {renderNode(node)}
              {!readOnly && (
                <div
                  className={css.port}
                  role="button"
                  aria-label={connectAriaLabel}
                  onPointerDown={(e) => { e.stopPropagation(); beginConnect(e, node.id) }}
                />
              )}
            </div>
          )
        })}
      </div>
      {canvasHint === undefined ? null : <div className={css.canvasHint}>{canvasHint}</div>}
    </div>
  )
}
