/**
 * The agent composer: an agent as a chain on a flow canvas. The palette on
 * the left offers the deployment's installed plugins, annotated with display
 * name, category, and description; the canvas in the middle is the composition
 * as a graph from Start through one node per plugin row to End — chain order
 * is the row order written to the host; and the inspector on the right shows
 * the selected node's details. Nodes drag to rearrange the layout, connect by
 * dragging from a port onto another node to reorder the chain after it, and a
 * palette module drops onto the canvas to append. Saving writes the GRAPH to
 * the host — the browser still never composes YAML text, and the host
 * re-checks the derived rows against its own inventory before the file is
 * touched.
 *
 * The footer also offers Creator mode: the handoff saves the composition and
 * stages a session on the self-referential preset so the agent can build or
 * refine the preset in conversation. An untouched preset skips the save — it
 * is already on disk — and hands off directly.
 *
 * The gestures are the shared flow canvas's: drag moves a node, the port
 * connects (a preset-chain reorder), and Delete removes the selection.
 * Selection lives here as local state, so the same component renders the
 * shipped compositions read-only (a preset's design page) with selection and
 * the inspector still live.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelKind } from '@deepseek-ai/dsh-api-remotes/client'
import type { FlowNode } from '@deepseek-ai/dsh-flow/types'
import { FlowCanvas } from '@deepseek-ai/dsh-client-ui-flow-editor/client'
import {
  composeBlocker, handoffBlocker,
  type ComposeDraft, type ComposePalette, type ModelCatalog, type PaletteModule, type PresetRow,
} from './section-store.ts'
import { chainAgents, compositionToRow, insertSlot } from './preset-graph.ts'
import { presetFlowSurface, type PresetSurfaceActions } from './preset-flow-controller.ts'
import type { AgentPresetSettingsKey } from './locales.ts'
import { ComposerPalette, categoryColor, glyphLetter } from './ComposerPalette.tsx'
import { NodeInspector } from './NodeInspector.tsx'
import { NodePickerModal } from './NodePickerModal.tsx'
import css from './AgentPresetComposer.module.css'

/** Composer actions the section forwards from the controller. */
export interface AgentPresetComposerActions {
  closeComposer: () => void
  setComposerId: (id: string) => void
  setComposerName: (name: string) => void
  /**
   * Append a module to the composition (the palette's click path). Returns the
   * new node's canvas id, or undefined when the module is already composed.
   */
  addRow: (moduleName: string) => string | undefined
  /**
   * Add a module at a graph position (the palette's drop path). Returns the new
   * node's canvas id, or undefined when the module is already composed.
   */
  addNodeAt: (moduleName: string, position: { x: number; y: number }) => string | undefined
  /** Remove one row, by its row id (falling back to the module name). */
  removeRow: (rowId: string) => void
  /** Remove one node by its canvas id (the delete key). */
  removeNode: (nodeId: string) => void
  /** Reorder the composition by chain index (the inspector's move buttons). */
  moveRow: (from: number, to: number) => void
  /** Move one node's canvas position (the drag gesture). */
  moveNode: (nodeId: string, position: { x: number; y: number }) => void
  /** Reorder the composition so `to` runs right after `from` (the connect gesture). */
  reorderNode: (fromNodeId: string, toNodeId: string) => void
  /**
   * Bind one model kind's route on one composition node — the inspector's
   * model-kind picker. The route is part of the draft, so an edit wakes Save.
   */
  updateAgentModelKind: (nodeId: string, kind: ModelKind, field: 'provider' | 'model', value: string) => void
  confirmCompose: () => Promise<boolean>
  /** Stage the self-referential preset and start a session on it. */
  startCreatorDraft?: () => void
  /** Begin a copy of a shipped read-only preset (the design page's edit way in). */
  onEdit?: () => void
}

/** Full composer props. */
export interface AgentPresetComposerProps {
  /** The open composition being edited. */
  draft: ComposeDraft
  /** The palette's last load; null only before the composer opened. */
  palette: ComposePalette | null
  /** The model catalog for the inspector's model-kind picker. */
  modelCatalog: ModelCatalog | null
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
  const { draft, palette, modelCatalog, roster, t, actions, readOnly = false } = props
  /** The selected node's canvas id, null when none is selected. */
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  /** The selected edge's id, null when none is selected. */
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  /** Whether the palette floats over the canvas, or hides behind its tab. */
  const [paletteOpen, setPaletteOpen] = useState(true)
  /** The node picker's anchor — which node the picked module follows. */
  const [picker, setPicker] = useState<{ after: string } | null>(null)

  const blocker = composeBlocker(draft, roster)
  const message = draft.error ?? (blocker === undefined ? null : t(blocker))
  const overwriting = roster.some(row => row.id === draft.id)
  const agents = chainAgents(draft.graph)
  const inComposition = new Set(agents.flatMap(node => node.composition === undefined ? [] : [node.composition.module]))
  /** The palette's annotation for a module, when the ready inventory knows it. */
  const moduleFor = (moduleName: string): PaletteModule | undefined =>
    palette === null || palette.status !== 'ready'
      ? undefined
      : palette.modules.find(module => module.moduleName === moduleName)

  const selectedAgent = selectedNodeId === null
    ? undefined
    : agents.find(node => node.id === selectedNodeId)
  const selectedIndex = selectedAgent === undefined ? -1 : agents.indexOf(selectedAgent)
  const selectedRow = selectedAgent?.composition === undefined
    ? undefined
    : compositionToRow(selectedAgent.composition)

  const handoffAvailable = actions.startCreatorDraft !== undefined
    && roster.some(row => row.id === 'cordis')
  const handoffBlocked = handoffBlocker(draft, roster)

  // A selection outlives its node only by accident: a save closes the composer,
  // a remove deletes the node, and a reorder relinks the edges, so drop the
  // stale id rather than render an inspector over nothing.
  useEffect(() => {
    if (selectedNodeId !== null && !draft.graph.nodes.some(node => node.id === selectedNodeId)) {
      setSelectedNodeId(null)
    }
    if (selectedEdgeId !== null && !draft.graph.edges.some(edge => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null)
    }
  }, [draft.graph.edges, draft.graph.nodes, selectedEdgeId, selectedNodeId])

  /** Move the selected node one slot, for the inspector's move buttons. */
  function handleMove(delta: -1 | 1): void {
    /* v8 ignore next -- the inspector mounts only with a selection, so this never fires */
    if (selectedIndex === -1) return
    actions.moveRow(selectedIndex, selectedIndex + delta)
  }

  /**
   * Insert a picked module after the anchor the picker opened for. The add
   * appends the new node at the chain tail (its index is the pre-add length),
   * then moves it to the anchor's slot — start lands first, an agent follows
   * it, the end terminal keeps the tail.
   */
  function handlePick(moduleName: string): void {
    const at = picker?.after
    /* v8 ignore next -- the picker is mounted only while `picker` is set, so its onPick can never fire for a closed picker. */
    if (at === undefined) return
    const index = agents.length
    const id = actions.addRow(moduleName)
    /* v8 ignore next -- the picker disables spent modules, so a pick always appends */
    if (id === undefined) return
    const slot = insertSlot(at, agents)
    if (slot !== null && slot !== index) actions.moveRow(index, slot)
    setSelectedNodeId(id)
    setPicker(null)
  }

  // The surface the shared canvas gestures against: selection is this
  // component's state, and every mutation routes through the store actions.
  // Removing the chain terminals is refused — they are the composition's
  // frame, not a row — and the connect gesture (a reorder) clears the edge
  // selection, because the chain edges relink under the same ids.
  const surfaceActions: PresetSurfaceActions = {
    selectNode: setSelectedNodeId,
    selectEdge: setSelectedEdgeId,
    moveNode: actions.moveNode,
    removeNode: (id) => { if (id !== 'start' && id !== 'end') actions.removeNode(id) },
    removeEdge: () => {},
    addNodeAt: actions.addNodeAt,
    addEdge: (from, to) => { actions.reorderNode(from, to); setSelectedEdgeId(null) },
  }
  const surface = presetFlowSurface(draft.graph, selectedNodeId, selectedEdgeId, readOnly, surfaceActions)

  /** The node card content: a chain terminal, or a plugin's module card. */
  const renderNode = (node: FlowNode): ReactNode => {
    if (node.type === 'start' || node.type === 'end') {
      const isStart = node.type === 'start'
      return (
        <div className={`${css.canvasEnd}${isStart ? ` ${css.canvasStart}` : ''}`}>
          <span className={css.nodeGlyph} aria-hidden="true">{isStart ? '›' : '■'}</span>
          <span className={css.nodeName}>{isStart ? t('canvasStart') : t('canvasEnd')}</span>
        </div>
      )
    }
    // A preset composition is a chain of plugin agents; the flow canvas also
    // knows condition/loop nodes, which this domain never composes.
    if (node.type !== 'agent') return null
    const composition = node.composition
    if (composition === undefined) return null
    const module = moduleFor(composition.module)
    return (
      <div className={css.nodeCard}>
        <span
          className={css.nodeGlyph}
          aria-hidden="true"
          style={{ backgroundColor: categoryColor(module?.category) }}
        >
          {glyphLetter(module?.displayName ?? composition.module)}
        </span>
        <span className={css.nodeBody}>
          <span className={css.nodeName}>{module?.displayName ?? composition.module}</span>
          {module?.description === undefined
            ? null
            : <span className={css.nodeDesc}>{module.description}</span>}
          <code className={css.nodeModule}>{composition.module}</code>
        </span>
      </div>
    )
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
        {/* A shipped preset's design page is read-only by contract, so its edit
            affordance is to copy: close the view and open the copy dialog over
            the preset, where the copy can diverge. */}
        {readOnly && actions.onEdit !== undefined
          ? (
            <button
              type="button"
              className={css.editCopyButton}
              onClick={actions.onEdit}
            >
              {t('editCopy')}
            </button>
          )
          : null}
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
                  onAdd={(moduleName) => {
                    const id = actions.addRow(moduleName)
                    if (id !== undefined) setSelectedNodeId(id)
                  }}
                  // The palette's drag is announced to nothing: the shared
                  // canvas owns the drop, reading the module name straight from
                  // the data-transfer payload.
                  onDragModule={() => {}}
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
          <FlowCanvas
            surface={surface}
            renderNode={renderNode}
            dropMime="text/plain"
            connectAriaLabel={t('connectLabel')}
            {...(readOnly ? {} : { canvasHint: t('canvasHint') })}
            // The node add and edge insert buttons open the same picker, whose
            // anchor is the node the new one will follow. Read-only omits the
            // hooks (exactOptionalPropertyTypes: absent, not undefined).
            {...(readOnly ? {} : {
              onAddNode: (id: string) => { setPicker({ after: id }) },
              addNodeAriaLabel: t('nodeAddLabel'),
              onInsertBetween: (from: string) => { setPicker({ after: from }) },
              insertBetweenAriaLabel: t('nodeInsertLabel'),
            })}
          />
          {selectedRow === undefined || selectedAgent === undefined
            ? null
            : (
              <NodeInspector
                readOnly={readOnly}
                row={selectedRow}
                module={moduleFor(selectedRow.name)}
                modelKinds={selectedAgent.agentOptions?.modelKinds}
                catalog={modelCatalog}
                onModelBinding={(kind, field, value) => {
                  actions.updateAgentModelKind(selectedAgent.id, kind, field, value)
                }}
                canMoveUp={selectedIndex > 0}
                canMoveDown={selectedIndex !== -1 && selectedIndex < agents.length - 1}
                onRemove={actions.removeRow}
                onMove={handleMove}
                t={t}
              />
            )}
        </div>
      </div>
      {readOnly ? null : (
        <>
          {agents.length === 0 && handoffAvailable
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
      {picker === null
        ? null
        : (
          <NodePickerModal
            after={picker.after}
            palette={palette}
            inComposition={inComposition}
            onPick={handlePick}
            onClose={() => { setPicker(null) }}
            t={t}
          />
        )}
    </div>
  )
}
