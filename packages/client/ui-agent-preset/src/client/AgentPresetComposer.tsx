/**
 * The agent composer: an agent as a horizontal pipeline. The palette on the
 * left offers the deployment's installed plugins, annotated with display
 * name, category, and description; the canvas in the middle is the
 * composition as a chain from Start through one node per plugin row to End —
 * chain order is the row order written to the host; and the inspector on the
 * right shows the selected node's details. Saving writes the ROW LIST to the
 * host — the browser still never composes YAML text, and the host re-checks
 * every row against its own inventory before the file is touched.
 *
 * The footer also offers Creator mode: the handoff saves the composition and
 * stages a session on the self-referential preset so the agent can build or
 * refine the preset in conversation. An untouched preset skips the save — it
 * is already on disk — and hands off directly.
 *
 * Dragging is HTML5 native DnD: no dependency, and jsdom tests assert the
 * handlers reach the store actions rather than simulating the drag.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  composeBlocker, handoffBlocker,
  type ComposeDraft, type ComposePalette, type PaletteModule, type PresetRow,
} from './section-store.ts'
import type { AgentPresetSettingsKey } from './locales.ts'
import { ComposerPalette } from './ComposerPalette.tsx'
import { PipelineCanvas } from './PipelineCanvas.tsx'
import { NodeInspector } from './NodeInspector.tsx'
import css from './AgentPresetComposer.module.css'

/** Composer actions the section forwards from the controller. */
export interface AgentPresetComposerActions {
  closeComposer: () => void
  setComposerId: (id: string) => void
  setComposerName: (name: string) => void
  addRow: (moduleName: string) => void
  insertRowAt: (moduleName: string, index: number) => void
  removeRow: (rowId: string) => void
  moveRow: (from: number, to: number) => void
  confirmCompose: () => Promise<boolean>
  /** Stage the self-referential preset and start a session on it. */
  startCreatorDraft?: () => void
}

/** Full composer props. */
export interface AgentPresetComposerProps {
  /** The open composition being edited. */
  draft: ComposeDraft
  /** The palette's last load; null only before the composer opened. */
  palette: ComposePalette | null
  /** The roster, for the create/id-collision and overwrite checks. */
  roster: readonly PresetRow[]
  /** Active Web locale lookup. */
  t: (key: AgentPresetSettingsKey) => string
  /** Store-backed actions. */
  actions: AgentPresetComposerActions
  /**
   * Render the composition read-only, as a shipped preset's design-page view:
   * no palette, no id/name fields, no footer, and the canvas accepts no edits
   * (nodes stay selectable so the inspector still explains them).
   */
  readOnly?: boolean
}

/**
 * Render the composer: header, id/name fields, the palette / canvas /
 * inspector body, and a footer with the Creator-mode handoff and save.
 * @param props - draft, palette, roster, locale, and actions.
 * @returns the composer view.
 */
export function AgentPresetComposer(props: AgentPresetComposerProps): ReactNode {
  const { draft, palette, roster, t, actions, readOnly = false } = props
  /** The composition row being dragged, null for a palette drag. */
  const [dragging, setDragging] = useState<number | null>(null)
  /** The selected node's row id, undefined when none is selected. */
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined)
  /** Whether the palette floats over the canvas, or hides behind its tab. */
  const [paletteOpen, setPaletteOpen] = useState(true)

  const blocker = composeBlocker(draft, roster)
  const message = draft.error ?? (blocker === undefined ? null : t(blocker))
  const overwriting = roster.some(row => row.id === draft.id)
  const inComposition = new Set(draft.rows.map(row => row.name))
  /** The palette's annotation for a module, when the ready inventory knows it. */
  const moduleFor = (moduleName: string): PaletteModule | undefined =>
    palette === null || palette.status !== 'ready'
      ? undefined
      : palette.modules.find(module => module.moduleName === moduleName)

  const selectedIndex = draft.rows.findIndex(row => row.id === selectedRowId)
  const selectedRow = selectedIndex === -1 ? undefined : draft.rows[selectedIndex]

  const handoffAvailable = actions.startCreatorDraft !== undefined
    && roster.some(row => row.id === 'cordis')
  const handoffBlocked = handoffBlocker(draft, roster)

  // A selection outlives its row only by accident: a save closes the composer
  // and a remove deletes the row, so drop the stale id rather than render an
  // inspector over nothing.
  useEffect(() => {
    if (selectedRowId !== undefined && !draft.rows.some(row => row.id === selectedRowId)) {
      setSelectedRowId(undefined)
    }
  }, [draft.rows, selectedRowId])

  /** Move the selected node one slot, for the inspector's move buttons. */
  function handleMove(delta: -1 | 1): void {
    if (selectedIndex === -1) return
    actions.moveRow(selectedIndex, selectedIndex + delta)
  }

  /** Save-then-handoff; an untouched preset skips the save and hands off now. */
  async function handleHandoff(): Promise<void> {
    if (composeBlocker(draft, roster) === 'unchanged') {
      actions.startCreatorDraft?.()
      return
    }
    if (await actions.confirmCompose()) actions.startCreatorDraft?.()
  }

  return (
    <div className={css.composer}>
      <div className={css.composerHead}>
        <button
          type="button"
          className={css.backButton}
          aria-label={t('back')}
          title={t('back')}
          onClick={actions.closeComposer}
        >
          ‹
        </button>
        <h2 className={css.composerTitle}>
          {readOnly ? `${t('view')} · ${draft.name}` : draft.original.id === '' ? t('newAgent') : t('composeTitle')}
        </h2>
      </div>
      {readOnly ? null : (
        <>
          <p className={css.composerIntro}>{t('composeIntro')}</p>
          <div className={css.composerFields}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('presetId')}</span>
              <input
                className={css.input}
                value={draft.id}
                spellCheck={false}
                placeholder={t('presetIdPlaceholder')}
                onChange={(event) => { actions.setComposerId(event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('displayName')}</span>
              <input
                className={css.input}
                value={draft.name}
                spellCheck={false}
                placeholder={t('displayNamePlaceholder')}
                onChange={(event) => { actions.setComposerName(event.target.value) }}
              />
            </label>
          </div>
        </>
      )}
      <div className={css.composerBody}>
        <div className={css.stageHead}>
          <h3 className={css.columnHead}>{t('compositionLabel')}</h3>
        </div>
        <div className={css.stage}>
          {readOnly
            ? null
            : paletteOpen
              ? (
                <ComposerPalette
                  palette={palette}
                  inComposition={inComposition}
                  onAdd={actions.addRow}
                  onDragModule={() => { setDragging(null) }}
                  onCollapse={() => { setPaletteOpen(false) }}
                  t={t}
                />
              )
              : (
                <button
                  type="button"
                  className={css.paletteTab}
                  aria-label={t('paletteExpand')}
                  title={t('paletteExpand')}
                  onClick={() => { setPaletteOpen(true) }}
                >
                  {t('palette')}
                </button>
              )}
          <PipelineCanvas
            readOnly={readOnly}
            rows={draft.rows}
            dragging={dragging}
            selectedRowId={selectedRowId}
            moduleFor={moduleFor}
            onSelect={setSelectedRowId}
            onDragNode={setDragging}
            onDragEnd={() => { setDragging(null) }}
            onMoveRow={actions.moveRow}
            onInsert={actions.insertRowAt}
            onRemove={actions.removeRow}
            t={t}
          />
          {selectedRow === undefined
            ? null
            : (
              <NodeInspector
                readOnly={readOnly}
                row={selectedRow}
                module={moduleFor(selectedRow.name)}
                canMoveUp={selectedIndex > 0}
                canMoveDown={selectedIndex !== -1 && selectedIndex < draft.rows.length - 1}
                onRemove={actions.removeRow}
                onMove={handleMove}
                t={t}
              />
            )}
        </div>
      </div>
      {readOnly ? null : (
        <>
          {draft.rows.length === 0 && handoffAvailable
            ? <p className={css.handoffHint}>{t('handoffHint')}</p>
            : null}
          {message === null ? null : <p className={css.error} role="alert">{message}</p>}
          {overwriting
            ? <p className={css.overwriteNote}>{t('overwriteWarning')}</p>
            : null}
          <div className={css.composerFoot}>
            {handoffAvailable
              ? (
                <Button
                  variant="outline"
                  disabled={draft.saving || handoffBlocked !== undefined}
                  title={handoffBlocked === undefined ? undefined : t(handoffBlocked)}
                  onClick={() => { void handleHandoff() }}
                >
                  {t('handoff')}
                </Button>
              )
              : null}
            <Button variant="outline" disabled={draft.saving} onClick={actions.closeComposer}>
              {t('cancel')}
            </Button>
            <Button disabled={draft.saving || blocker !== undefined} onClick={() => { void actions.confirmCompose() }}>
              {draft.saving ? t('saving') : t('save')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
