/**
 * The canvas's custom edge: a smoothstep path with a branch-label chip and,
 * when editable and the caller wired an insert hook, a floating "+" that
 * inserts between the two nodes. The midpoint is computed from the source/target
 * handle anchors, so the button stays on the path as the nodes move.
 */

import { memo, type ReactNode } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { InsertableEdgeModel } from './rf-map.ts'
import css from './FlowCanvas.module.css'

/** The fallback insert-button label, when the caller omits its own. */
const DEFAULT_INSERT_LABEL = 'Insert a node between'

/** One custom insertable edge. */
function InsertableEdgeComponent({
  id, source, target, sourceX, sourceY, targetX, targetY, selected, markerEnd, data,
}: EdgeProps<InsertableEdgeModel>): ReactNode {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, borderRadius: 16,
  })
  // React Flow's Edge type leaves data optional, so a data-less edge (one a
  // future caller adds directly) renders the plain path without label or button.
  const { label, readOnly, onInsertBetween, insertBetweenAriaLabel } = data ?? {}
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        // exactOptionalPropertyTypes: absent optional props must be omitted.
        {...(markerEnd === undefined ? {} : { markerEnd })}
        {...(selected ? { className: css.edgeSelected } : {})}
      />
      <EdgeLabelRenderer>
        <div
          className={css.edgeLabel}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {label === undefined ? null : <span className={css.edgeBranch}>{label}</span>}
          {readOnly || onInsertBetween === undefined
            ? null
            : (
              <button
                type="button"
                className={css.edgeInsert}
                aria-label={insertBetweenAriaLabel ?? `${DEFAULT_INSERT_LABEL} ${source} and ${target}`}
                title={insertBetweenAriaLabel ?? `${DEFAULT_INSERT_LABEL} ${source} and ${target}`}
                onPointerDown={(event) => { event.stopPropagation() }}
                onClick={(event) => {
                  event.stopPropagation()
                  onInsertBetween(source, target)
                }}
              >
                +
              </button>
            )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

/** Memoized custom edge: data identity is stable across viewport moves. */
export const InsertableEdge = memo(InsertableEdgeComponent)
