/**
 * The develop-mode dependency topology on React Flow. Positions come from the
 * pure dagre layout (layout.ts) as natural flow coordinates; once measured, the
 * view fits to the layout's bounding box and re-fits when the graph or the
 * container changes size, so the whole graph always stays in view. A selection
 * (a list click or a node tap) overrides the fit: the canvas centers on the
 * selected node and lifts the zoom so the node reads at focus size, with the
 * node's edges accented; clearing the selection re-fits the whole graph. Nodes
 * are static (no drag, no connect); node tap selects, pane tap clears, and each
 * node reports its own hover (React Flow v12 has no canvas hover events). The
 * caller's hover/selection props drive the accent classes through the node
 * data, and a minimap plus zoom controls ship for free.
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent, type ReactNode,
} from 'react'
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, Position, ReactFlow,
  ReactFlowProvider, useEdgesState, useNodesInitialized, useNodesState, useReactFlow,
  type Edge, type Node as RfNode, type NodeTypes,
} from '@xyflow/react'
import type { GraphEdge, GraphNode } from './graph.ts'
import { NODE_HEIGHT, NODE_WIDTH, layoutDagre, type LayoutPoint } from './layout.ts'
import { TOPOLOGY_NODE_TYPE, TopologyNode, type TopologyNodeModel } from './TopologyNode.tsx'
import './xyflow-base.css'
import './flow-overrides.css'
import css from './insight.module.css'

/** The zoom a selection lifts the view to; a manual zoom above it is kept. */
const FOCUS_ZOOM = 1
/** The centering animation length, matching a short viewport move. */
const FOCUS_DURATION_MS = 320

/** The topology's node renderer, registered once per module load. */
const NODE_TYPES: NodeTypes = { [TOPOLOGY_NODE_TYPE]: TopologyNode }

export interface TopologyGraphProps {
  /** Bounded node set derived from the committed section. */
  nodes: readonly GraphNode[]
  /** Bounded edge set derived from the committed section. */
  edges: readonly GraphEdge[]
  /** Node ids rendered in the cycle-highlight style. */
  cycleNodeIds?: ReadonlySet<string>
  /** Node id under the mouse, rendered with the hover ring; null clears it. */
  hoverNodeId?: string | null
  /** Node id selected from the list or a node tap; centered and emphasized. */
  selectedNodeId?: string | null
  /** A node was tapped. */
  onSelectNode?: (id: string) => void
  /** A node gained or lost mouse hover. */
  onHoverNode?: (id: string | null) => void
  /** The canvas background was tapped, clearing the selection. */
  onTapBackground?: () => void
}

/** One topology edge: a smoothstep dependency arc with a right/left flow. */
export type TopologyEdgeModel = Edge

/** Render a directed dependency graph that fills its container. */
export function TopologyGraph(props: TopologyGraphProps): ReactNode {
  if (props.nodes.length === 0) return null
  return (
    <ReactFlowProvider>
      <TopologyGraphInner {...props} />
    </ReactFlowProvider>
  )
}

/** The graph body, inside the React Flow provider so the store is available. */
function TopologyGraphInner({
  nodes, edges, cycleNodeIds, hoverNodeId, selectedNodeId,
  onSelectNode, onHoverNode, onTapBackground,
}: TopologyGraphProps): ReactNode {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const { fitView, setCenter, getZoom } = useReactFlow()
  const initialized = useNodesInitialized()
  // The measured container size, zero until the first measurement. The layout
  // itself never depends on it — positions are natural flow coordinates — but
  // the fit needs a real size, and a resize re-fits the view.
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (wrapper === null) return
    const applySize = (): void => {
      const rect = wrapper.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      setSize(current =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      )
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(wrapper)
    return () => { observer.disconnect() }
  }, [])

  const { positions } = useMemo(() => layoutDagre(nodes, edges), [nodes, edges])

  const initialNodes = useMemo(
    () => toTopologyNodes(nodes, positions, cycleNodeIds, hoverNodeId, selectedNodeId, onHoverNode),
    [nodes, positions, cycleNodeIds, hoverNodeId, selectedNodeId, onHoverNode],
  )
  const initialEdges = useMemo(() => toTopologyEdges(edges, selectedNodeId), [edges, selectedNodeId])

  // The controlled store state: React Flow applies node measurements through
  // onNodesChange, and the sync effect below re-derives whenever the graph or
  // an accent prop changes (preserving measured nodes by id).
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<TopologyNodeModel>(initialNodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<TopologyEdgeModel>(initialEdges)

  useLayoutEffect(() => {
    setRfNodes(initialNodes)
    setRfEdges(initialEdges)
  }, [initialNodes, initialEdges])

  // Fit the view to the natural layout once measured: the initial view anchors
  // the origin, and re-anchoring on a later layout or container change keeps
  // the whole graph in view (the read-only topology has no editing gestures to
  // fight). `positions` is a fresh map per layout, so the fit re-runs exactly
  // when the graph or the container changes. A selection owns the viewport
  // instead (the focus effect below); the fit returns once it clears.
  const selectedCorner = selectedNodeId == null ? null : positions.get(selectedNodeId) ?? null
  useLayoutEffect(() => {
    if (selectedCorner !== null) return
    if (positions.size === 0) return
    if (!initialized) return
    if (size.width <= 0 || size.height <= 0) return
    void fitView({ padding: 0.2, duration: 0 })
  }, [fitView, initialized, positions, selectedCorner, size])

  // A selection arriving from the list or a node tap centers the canvas on the
  // selected node (its layout corner plus half the planned node box) and lifts
  // the zoom to focus size — a manual zoom above focus size is kept, so a
  // zoomed-in reading session is never zoomed out by selecting. An id the
  // layout has no position for cannot center, so the whole-graph fit owns the
  // viewport instead.
  useLayoutEffect(() => {
    if (selectedCorner === null) return
    if (!initialized) return
    if (size.width <= 0 || size.height <= 0) return
    void setCenter(selectedCorner.x + NODE_WIDTH / 2, selectedCorner.y + NODE_HEIGHT / 2, {
      zoom: Math.max(getZoom(), FOCUS_ZOOM),
      duration: FOCUS_DURATION_MS,
    })
  }, [getZoom, initialized, selectedCorner, setCenter, size])

  const onNodeClick = useCallback((_: ReactMouseEvent, node: RfNode): void => {
    onSelectNode?.(node.id)
  }, [onSelectNode])

  const onPaneClick = useCallback((): void => {
    onTapBackground?.()
  }, [onTapBackground])

  return (
    <div ref={wrapperRef} className={css.graph} role="img" aria-label="dependency graph">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}

/**
 * Project the bounded node set onto React Flow nodes: one custom node per
 * graph node at its fitted dagre position, with the caller's accent props
 * folded into the node data.
 */
function toTopologyNodes(
  nodes: readonly GraphNode[],
  positions: ReadonlyMap<string, LayoutPoint>,
  cycleNodeIds: ReadonlySet<string> | undefined,
  hoverNodeId: string | null | undefined,
  selectedNodeId: string | null | undefined,
  onHoverNode: ((id: string | null) => void) | undefined,
): TopologyNodeModel[] {
  return nodes.map(node => ({
    id: node.id,
    type: TOPOLOGY_NODE_TYPE,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: {
      label: node.label,
      cycle: cycleNodeIds?.has(node.id) ?? false,
      hovered: hoverNodeId === node.id,
      selected: selectedNodeId === node.id,
      // exactOptionalPropertyTypes: an absent optional hook must be omitted.
      ...(onHoverNode === undefined ? {} : { onHover: onHoverNode }),
    },
  }))
}

/** Project the bounded edge set onto smoothstep dependency arcs. */
function toTopologyEdges(
  edges: readonly GraphEdge[],
  selectedNodeId: string | null | undefined,
): TopologyEdgeModel[] {
  return edges.map((edge, index) => {
    const selected = selectedNodeId !== undefined && selectedNodeId !== null
      && (edge.source === selectedNodeId || edge.target === selectedNodeId)
    return {
      id: `${edge.source}>${edge.target}#${index}`,
      type: 'smoothstep',
      source: edge.source,
      target: edge.target,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      // An edge touching the selected node carries the selected accent class
      // (flow-overrides.css) and its arrowhead the brand color, so the focus
      // reads through the arcs, not just the node card.
      markerEnd: selected
        ? { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--dsw-alias-brand)' }
        : { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      ...(selected ? { className: 'topologyEdgeSelected', animated: true } : {}),
    }
  })
}
