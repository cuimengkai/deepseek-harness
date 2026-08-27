/**
 * The topology graph's custom node: a small path card whose border and
 * background carry the file-type category color (TypeScript, JavaScript,
 * component, style, or neutral), plus the cycle, hover, and selected accents
 * driven by the caller's props — the selected card keeps the strongest ring
 * so the focus reads at a glance. React Flow v12 removed the canvas-level
 * `onNodeMouseEnter/Leave` events, so the node reports its own mouse hover
 * through the `onHover` data hook. The node also carries hidden left/right
 * handles: React Flow anchors every edge to a handle, so a static graph still
 * needs them for the edge pipeline to run — they are invisible and inert
 * because the canvas is not connectable.
 */

import { memo, type ReactNode } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { fileTypeCategoryOf } from './fileType.ts'
import css from './insight.module.css'

/** The custom node type id the topology graph registers. */
export const TOPOLOGY_NODE_TYPE = 'topology'

/** The data one topology node carries: the path label, accents, and hover hook. */
export type TopologyNodeData = {
  /** The alias-relative path rendered on the node. */
  readonly label: string
  /** Whether the node participates in a dependency cycle. */
  readonly cycle: boolean
  /** Whether the caller is hovering the node (a list row or a node hover). */
  readonly hovered: boolean
  /** Whether the node is currently selected. */
  readonly selected: boolean
  /** Reports mouse hover over this node; absent when the caller opts out. */
  readonly onHover?: ((id: string | null) => void) | undefined
}

/** The React Flow node model the topology graph renders. */
export type TopologyNodeModel = Node<TopologyNodeData, typeof TOPOLOGY_NODE_TYPE>

/** One custom topology node. */
function TopologyNodeComponent({ id, data }: NodeProps<TopologyNodeModel>): ReactNode {
  const { label, cycle, hovered, selected, onHover } = data
  const className = [
    css.topologyNode,
    typeClassOf(id),
    cycle ? css.topologyCycle : '',
    hovered ? css.topologyHover : '',
    selected ? css.topologySelected : '',
  ].join(' ')
  return (
    <div
      className={className}
      data-node-id={id}
      onMouseEnter={() => { if (onHover !== undefined) onHover(id) }}
      onMouseLeave={() => { if (onHover !== undefined) onHover(null) }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className={css.topologyNodeLabel}>{label}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

/** The card-coloring class for a path's file-type category. */
function typeClassOf(path: string) {
  return {
    ts: css.typeTs,
    js: css.typeJs,
    component: css.typeComponent,
    style: css.typeStyle,
    other: css.typeOther,
  }[fileTypeCategoryOf(path)]
}

/** Memoized custom node: data identity is stable across viewport moves. */
export const TopologyNode = memo(TopologyNodeComponent)
