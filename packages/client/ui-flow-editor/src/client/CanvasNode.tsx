/**
 * The canvas's custom node: the caller's card content wrapped for React Flow,
 * with a target/source handle pair on the flow axis and, when editable and the
 * caller wired a picker, a floating "+" that opens it for a successor. Handles
 * and the button hide in read-only, but the node stays selectable so the
 * inspector can still explain it.
 */

import { memo, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeModel } from './rf-map.ts'
import css from './FlowCanvas.module.css'

/** The fallback add-button label, when the caller omits its own. */
const DEFAULT_ADD_LABEL = 'Add a node after'

/** One custom canvas node. */
function CanvasNodeComponent({ id, data, selected }: NodeProps<CanvasNodeModel>): ReactNode {
  const { node, renderNode, readOnly, nodeClass, connectAriaLabel, onAddNode, addNodeAriaLabel } = data
  const extra = nodeClass?.(node)
  const className = `${css.node}${selected ? ` ${css.nodeSelected}` : ''}${extra === undefined ? '' : ` ${extra}`}`
  return (
    <div className={className} data-node-id={id}>
      {readOnly
        ? null
        : (
          <Handle
            type="target"
            position={Position.Left}
            className={css.port}
            aria-label={connectAriaLabel}
          />
        )}
      {renderNode(node)}
      {readOnly
        ? null
        : (
          <Handle
            type="source"
            position={Position.Right}
            className={css.port}
            aria-label={connectAriaLabel}
          />
        )}
      {readOnly || onAddNode === undefined
        ? null
        : (
          <button
            type="button"
            className={css.nodeAdd}
            aria-label={addNodeAriaLabel ?? `${DEFAULT_ADD_LABEL} ${id}`}
            title={addNodeAriaLabel ?? `${DEFAULT_ADD_LABEL} ${id}`}
            onPointerDown={(event) => { event.stopPropagation() }}
            onClick={(event) => {
              event.stopPropagation()
              onAddNode(id)
            }}
          >
            +
          </button>
        )}
    </div>
  )
}

/** Memoized custom node: data identity is stable across drag frames. */
export const CanvasNode = memo(CanvasNodeComponent)
