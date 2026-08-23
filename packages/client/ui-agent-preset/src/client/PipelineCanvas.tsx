/**
 * The composer's pipeline canvas: the composition as a horizontal chain from
 * Start through one node per plugin row to End. Chain order is the row order
 * written to `agent.cordis.yml`; nodes reorder by dragging within the track,
 * and a palette module drops into the slot under the pointer. There is no
 * branching or edge-dragging — the composition is an ordered list, and the
 * canvas makes that order visible rather than inventing execution flow.
 * Read-only (a shipped preset's view), the chain renders without drag or
 * remove affordances while nodes stay selectable for the inspector.
 */

import { Fragment, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ComposeRow } from '@deepseek-ai/dsh-api-remotes/client'
import { insertionIndexFor, type PaletteModule } from './section-store.ts'
import { categoryColor, glyphLetter } from './ComposerPalette.tsx'
import type { AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetComposer.module.css'

/** Canvas props. */
export interface PipelineCanvasProps {
  /** The composition's rows, in display order. */
  rows: readonly ComposeRow[]
  /** The composition row being dragged, null for a palette drag. */
  dragging: number | null
  /** The selected node's row id, undefined when none is selected. */
  selectedRowId: string | undefined
  /** Resolve a row's palette annotation for its badge and description. */
  moduleFor: (moduleName: string) => PaletteModule | undefined
  /** Select or deselect a node. */
  onSelect: (id: string | undefined) => void
  /** Announce the composition row being dragged. */
  onDragNode: (index: number) => void
  /** Clear the drag state when a drag ends. */
  onDragEnd: () => void
  /** Reorder the composition (a node dropped on the track). */
  onMoveRow: (from: number, to: number) => void
  /** Insert a palette module at a slot. */
  onInsert: (moduleName: string, slot: number) => void
  /** Remove one row. */
  onRemove: (id: string) => void
  /** Active Web locale lookup. */
  t: (key: AgentPresetSettingsKey) => string
  /** Render the canvas read-only: nodes stay selectable (so the inspector can
   * explain them) but are not draggable and offer no remove control. */
  readOnly?: boolean
}

/**
 * Render the pipeline canvas: Start, the node chain, End, and the drop slot.
 * @param props - rows, drag state, and the store-backed callbacks.
 * @returns the canvas panel.
 */
export function PipelineCanvas(props: PipelineCanvasProps): ReactNode {
  const {
    rows, dragging, selectedRowId, moduleFor, onSelect,
    onDragNode, onDragEnd, onMoveRow, onInsert, onRemove, t, readOnly = false,
  } = props
  const canvasRef = useRef<HTMLDivElement | null>(null)
  /** The slot under the pointer while a drag hovers the canvas. */
  const [dragSlot, setDragSlot] = useState<number | null>(null)

  /** Each node's horizontal midpoint, for drop-slot resolution. */
  function midpoints(): number[] {
    const el = canvasRef.current
    if (el === null) return []
    return Array.from(el.querySelectorAll<HTMLElement>('[data-row-index]'))
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left + rect.width / 2
      })
  }

  /**
   * Each slot's left edge, relative to the track. The insertion indicator is
   * positioned absolutely so showing it never reflows the chain: a reflow
   * detaches the dragged node mid-drag and cancels the native drag.
   */
  function slotBoundaries(): number[] {
    const el = canvasRef.current
    const track = el?.querySelector<HTMLElement>('[data-canvas-track]')
    const nodes = Array.from(el?.querySelectorAll<HTMLElement>('[data-row-index]') ?? [])
    if (track === null || track === undefined || nodes.length === 0) return []
    const trackLeft = track.getBoundingClientRect().left
    const heads = nodes.map(node => node.getBoundingClientRect().left - trackLeft)
    const lastNode = nodes[nodes.length - 1]
    if (lastNode === undefined) return []
    const tail = lastNode.getBoundingClientRect().right - trackLeft
    return [...heads, tail]
  }

  /** Resolve a drop: a row drag reorders, a palette drag inserts at the slot. */
  function handleDrop(event: { clientX: number; dataTransfer: { getData(format: string): string } | null }): void {
    const slot = insertionIndexFor(event.clientX, midpoints())
    setDragSlot(null)
    if (dragging !== null) {
      onMoveRow(dragging, slot)
    } else {
      const moduleName = event.dataTransfer?.getData('text/plain')
      if (moduleName !== undefined && moduleName !== '') onInsert(moduleName, slot)
    }
    onDragEnd()
  }

  return (
    <div className={css.canvasZone} data-composition>
      <div
        ref={canvasRef}
        className={css.canvas}
        data-canvas
        onClick={(event) => {
          // A click on the canvas background is an explicit deselect.
          if (event.target === event.currentTarget) onSelect(undefined)
        }}
        onDragOver={readOnly ? undefined : (event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = dragging === null ? 'copy' : 'move'
          setDragSlot(insertionIndexFor(event.clientX, midpoints()))
        }}
        onDragLeave={readOnly ? undefined : (event) => {
          // Only clear when the pointer actually leaves the canvas.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragSlot(null)
        }}
        onDrop={readOnly ? undefined : (event) => {
          event.preventDefault()
          handleDrop(event)
        }}
      >
        {rows.length === 0
          ? readOnly
            ? null
            : (
              <div className={css.dropSlot}>
                <p className={css.dropHint}>{t('compositionEmpty')}</p>
              </div>
            )
          : (
            <div className={css.canvasTrack} data-canvas-track>
              <div className={`${css.canvasEnd} ${css.canvasStart}`}>
                <span className={css.nodeGlyph} aria-hidden="true">›</span>
                <span className={css.nodeName}>{t('canvasStart')}</span>
              </div>
              <span className={css.nodeConnector} aria-hidden="true" />
              {rows.map((row, index) => {
                const module = moduleFor(row.name)
                return (
                  <Fragment key={row.id}>
                    <div
                      className={dragging === index
                        ? `${css.node} ${css.nodeDragging}`
                        : selectedRowId === row.id ? `${css.node} ${css.nodeSelected}` : css.node}
                      data-row-index={index}
                      data-row-id={row.id}
                      draggable={!readOnly}
                      title={readOnly ? undefined : t('reorderHint')}
                      onClick={() => { onSelect(row.id) }}
                      onDragStart={readOnly ? undefined : (event) => {
                        onDragNode(index)
                        event.dataTransfer.setData('text/plain', row.name)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={readOnly ? undefined : () => { onDragEnd() }}
                    >
                      <span
                        className={css.nodeGlyph}
                        aria-hidden="true"
                        style={{ backgroundColor: categoryColor(module?.category) }}
                      >
                        {glyphLetter(module?.displayName ?? row.name)}
                      </span>
                      <span className={css.nodeBody}>
                        <span className={css.nodeName}>{module?.displayName ?? row.name}</span>
                        <code className={css.nodeModule}>{row.name}</code>
                        {module?.description === undefined
                          ? null
                          : <span className={css.nodeDesc}>{module.description}</span>}
                      </span>
                      {readOnly
                        ? null
                        : (
                          <button
                            type="button"
                            className={css.nodeRemove}
                            aria-label={`${t('removeRow')}: ${row.name}`}
                            title={t('removeRow')}
                            onClick={(event) => {
                              event.stopPropagation()
                              if (row.id !== undefined) onRemove(row.id)
                              onSelect(undefined)
                            }}
                          >
                            ×
                          </button>
                        )}
                    </div>
                    <span className={css.nodeConnector} aria-hidden="true" />
                  </Fragment>
                )
              })}
              <div className={css.canvasEnd}>
                <span className={css.nodeGlyph} aria-hidden="true">■</span>
                <span className={css.nodeName}>{t('canvasEnd')}</span>
              </div>
              {dragSlot !== null && rows.length > 0
                ? (
                  <span
                    className={css.insertionLine}
                    aria-hidden="true"
                    style={{ left: `${(slotBoundaries()[dragSlot] ?? 0) - 1.5}px` }}
                  />
                )
                : null}
            </div>
          )}
      </div>
    </div>
  )
}
