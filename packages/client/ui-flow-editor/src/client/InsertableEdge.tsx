/**
 * Custom edge for the shared canvas. Follows React Flow's documented
 * SmoothStepEdge / ButtonEdge pattern: pass sourcePosition and targetPosition
 * into {@link getSmoothStepPath}, forward markerEnd/style into {@link BaseEdge},
 * and put HTML labels in {@link EdgeLabelRenderer} (not SVG Edge.label — that
 * path calls getBBox and is fragile under incomplete layout).
 */

import { memo, type CSSProperties, type ReactNode } from 'react'
import {
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps,
} from '@xyflow/react'
import type { InsertableEdgeModel } from './rf-map.ts'
import css from './FlowCanvas.module.css'

/** The fallback insert-button label, when the caller omits its own. */
const DEFAULT_INSERT_LABEL = 'Insert a node between'

/** Concrete stroke so a missing design token cannot blank the path. */
const EDGE_STROKE = '#475569'

/**
 * One custom canvas edge.
 * @param props - React Flow edge props (geometry + our data payload).
 * @returns the path, optional branch chip, and optional insert control.
 */
function InsertableEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  style,
  data,
}: EdgeProps<InsertableEdgeModel>): ReactNode {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  })
  const { label, readOnly, onInsertBetween, insertBetweenAriaLabel } = data ?? {}
  const pathStyle: CSSProperties = {
    ...style,
    stroke: EDGE_STROKE,
    strokeWidth: selected ? 3 : 2,
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        interactionWidth={20}
        style={pathStyle}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        {...(selected ? { className: css.edgeSelected } : {})}
      />
      {label === undefined && (readOnly || onInsertBetween === undefined)
        ? null
        : (
          <EdgeLabelRenderer>
            <div
              className={`nodrag nopan ${css.edgeLabel}`}
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${String(labelX)}px,${String(labelY)}px)`,
                pointerEvents: 'all',
              }}
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
        )}
    </>
  )
}

/** Memoized custom edge: data identity is stable across viewport moves. */
export const InsertableEdge = memo(InsertableEdgeComponent)
