/**
 * Mode orchestration composer: Dify-style palette + canvas + inspector, with
 * an onboarding guide for how a mode is designed.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { FlowCanvas, type FlowCanvasSurface } from '@deepseek-ai/dsh-client-ui-flow-editor/client'
import type { FlowNode } from '@deepseek-ai/dsh-flow/types'
import type { AgentModeSectionState, ComposeDraft, PresetOption } from './section-store.ts'
import { formatAggregateItems, formatClassifyClasses, formatExtractParams, seedForRerun, type PlaceableNodeType } from './mode-graph.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { AgentModeSettingsKey } from './locales.ts'
import css from './AgentModeSection.module.css'
import composerCss from './ModeComposer.module.css'

const DROP_MIME = 'application/x-flow-node'

/** Actions the section injects into the composer. */
export interface ModeComposerActions {
  closeCompose: () => void
  setComposePreset: (preset: string) => void
  setComposeName: (name: string) => void
  setComposeDescription: (description: string) => void
  saveBind: () => Promise<boolean>
  selectNode: (id: string | null) => void
  selectEdge: (id: string | null) => void
  moveNode: (id: string, position: { x: number; y: number }) => void
  addNodeAt: (data: string, position: { x: number; y: number }) => string | undefined
  addEdge: (from: string, to: string) => void
  removeNode: (id: string) => void
  removeEdge: (id: string) => void
  addAfter: (afterId: string, type: PlaceableNodeType) => string | undefined
  insertBetween: (from: string, to: string, type: PlaceableNodeType) => string | undefined
  setSelectedPrompt: (prompt: string) => void
  setSelectedSystemPrompt: (systemPrompt: string) => void
  setSelectedModel: (model: string) => void
  setSelectedProvider: (provider: string) => void
  setSelectedChildPresetId: (id: string) => void
  setSelectedExpression: (expression: string) => void
  setSelectedIterable: (iterable: string) => void
  setSelectedVariable: (variable: string) => void
  setSelectedUrl: (url: string) => void
  setSelectedTemplate: (template: string) => void
  setSelectedSource: (source: string) => void
  setSelectedAggregateItems: (text: string) => void
  setSelectedAggregateMode: (mode: string) => void
  setSelectedListSource: (source: string) => void
  setSelectedListOp: (op: string) => void
  setSelectedClassifyQuery: (query: string) => void
  setSelectedClassifyClasses: (text: string) => void
  setSelectedExtractQuery: (query: string) => void
  setSelectedExtractParams: (text: string) => void
  saveCompose: () => Promise<boolean>
  saveAll: () => Promise<boolean>
  tryRun: (seed?: Record<string, JsonValue>) => Promise<void>
  startCreatorDraft?: () => void
  openBoundPreset: (presetId: string) => void
  useForSession?: (modeId: string) => void
}

/** Composer props. */
export interface ModeComposerProps {
  draft: ComposeDraft
  presets: readonly PresetOption[]
  t: (key: AgentModeSettingsKey) => string
  actions: ModeComposerActions
  /** Preset select control shared with the section. */
  renderPresetSelect: (props: {
    id: string
    value: string
    disabled?: boolean
    allowEmpty?: boolean
    emptyLabel?: string
    onChange: (value: string) => void
  }) => ReactNode
}

interface PaletteItem {
  type: PlaceableNodeType
  titleKey: AgentModeSettingsKey
  hintKey: AgentModeSettingsKey
}

const PALETTE_GROUPS: ReadonlyArray<{
  groupKey: AgentModeSettingsKey
  items: ReadonlyArray<PaletteItem>
}> = [
  {
    groupKey: 'compose.paletteBasic',
    items: [
      { type: 'agent', titleKey: 'compose.paletteAgent', hintKey: 'compose.paletteAgentHint' },
    ],
  },
  {
    groupKey: 'compose.paletteLogic',
    items: [
      { type: 'condition', titleKey: 'compose.paletteCondition', hintKey: 'compose.paletteConditionHint' },
      { type: 'loop', titleKey: 'compose.paletteLoop', hintKey: 'compose.paletteLoopHint' },
      { type: 'classify', titleKey: 'compose.paletteClassify', hintKey: 'compose.paletteClassifyHint' },
      { type: 'join', titleKey: 'compose.paletteJoin', hintKey: 'compose.paletteJoinHint' },
    ],
  },
  {
    groupKey: 'compose.paletteIntegration',
    items: [
      { type: 'http', titleKey: 'compose.paletteHttp', hintKey: 'compose.paletteHttpHint' },
    ],
  },
  {
    groupKey: 'compose.paletteTransform',
    items: [
      { type: 'template', titleKey: 'compose.paletteTemplate', hintKey: 'compose.paletteTemplateHint' },
      { type: 'code', titleKey: 'compose.paletteCode', hintKey: 'compose.paletteCodeHint' },
      { type: 'aggregate', titleKey: 'compose.paletteAggregate', hintKey: 'compose.paletteAggregateHint' },
      { type: 'list', titleKey: 'compose.paletteList', hintKey: 'compose.paletteListHint' },
      { type: 'extract', titleKey: 'compose.paletteExtract', hintKey: 'compose.paletteExtractHint' },
    ],
  },
]

const PALETTE_FLAT: ReadonlyArray<PaletteItem> = PALETTE_GROUPS.flatMap(group => group.items)

type InspectorTab = 'settings' | 'lastRun'

/**
 * Place a palette node after Start, or at a fallback position.
 * @param draft - compose draft.
 * @param actions - composer mutations.
 * @param type - placeable kind.
 */
function placePaletteNode(
  draft: ComposeDraft,
  actions: ModeComposerActions,
  type: PlaceableNodeType,
): void {
  const start = draft.graph.nodes.find(node => node.type === 'start')
  if (start === undefined) {
    actions.addNodeAt(type, { x: 240, y: 120 })
    return
  }
  if (actions.addAfter(start.id, type) === undefined) {
    actions.addNodeAt(type, {
      x: start.position.x + 200,
      y: start.position.y,
    })
  }
}

/**
 * Orchestration workspace for one mode's entry flow.
 * @param props - draft, locale, and mutations.
 * @returns the composer tree.
 */
export function ModeComposer(props: ModeComposerProps): ReactNode {
  const { draft, presets, t, actions, renderPresetSelect } = props
  const editable = draft.trust === 'user'
  const [guideOpen, setGuideOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(true)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('settings')
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [editedOutput, setEditedOutput] = useState<string | undefined>(undefined)
  const [picker, setPicker] = useState<
    | { kind: 'after'; nodeId: string }
    | { kind: 'between'; from: string; to: string }
    | null
  >(null)

  const surface = useMemo((): FlowCanvasSurface => ({
    graph: draft.graph,
    selectedNodeId: draft.selectedNodeId,
    selectedEdgeId: draft.selectedEdgeId,
    readOnly: !editable,
    selectNode: actions.selectNode,
    selectEdge: actions.selectEdge,
    moveNode: actions.moveNode,
    addEdge: actions.addEdge,
    removeNode: actions.removeNode,
    removeEdge: actions.removeEdge,
    addNodeAt: (data, position) => { actions.addNodeAt(data, position) },
  }), [draft, editable, actions])

  const checklistErrors = draft.checklist ?? []
  const checklistReady = draft.checklist !== undefined
  const selected = draft.graph.nodes.find(node => node.id === draft.selectedNodeId)
  const tryRunState = draft.tryRun
  const boundPreset = presets.find(preset => preset.id === draft.preset)
  const selectedNodeStatus = selected !== undefined
    ? tryRunState?.nodeStatuses[selected.id]
    : undefined
  const lastRunPayload = tryRunState === undefined
    ? undefined
    : {
      status: tryRunState.status,
      ...tryRunState.error === undefined ? {} : { error: tryRunState.error },
      ...selected === undefined ? {} : {
        selectedNodeId: selected.id,
        ...selectedNodeStatus === undefined ? {} : { selectedNodeStatus },
        ...tryRunState.nodeOutputs?.[selected.id] === undefined
          ? {}
          : { selectedNodeOutput: tryRunState.nodeOutputs[selected.id] },
        ...tryRunState.nodeDurationsMs?.[selected.id] === undefined
          ? {}
          : { selectedNodeDurationMs: tryRunState.nodeDurationsMs[selected.id] },
      },
      nodeStatuses: tryRunState.nodeStatuses,
      ...tryRunState.nodeOutputs === undefined ? {} : { nodeOutputs: tryRunState.nodeOutputs },
      ...tryRunState.nodeInputs === undefined ? {} : { nodeInputs: tryRunState.nodeInputs },
      ...tryRunState.nodeDurationsMs === undefined
        ? {}
        : { nodeDurationsMs: tryRunState.nodeDurationsMs },
    }

  return (
    <div className={`${css.section} ${css.sectionComposer}`}>
      <div className={css.compose}>
        <div className={css.composeBar}>
          <button
            type="button"
            className={css.backButton}
            aria-label={t('section.close')}
            onClick={actions.closeCompose}
          >
            ‹
          </button>
          <div className={css.composeTitleBlock}>
            <strong className={css.composeTitle}>{draft.name || draft.agentMode}</strong>
            <code className={css.cardId}>{draft.agentMode}</code>
          </div>
          {!editable ? <span className={css.badge}>{t('section.readOnly')}</span> : null}
          {editable && (draft.bindDirty || draft.dirty)
            ? (
              <span className={css.dirtyHint}>
                {draft.bindDirty && draft.dirty
                  ? t('section.dirtyBoth')
                  : draft.bindDirty
                    ? t('section.dirtyBind')
                    : t('section.dirtyFlow')}
              </span>
            )
            : null}
          <ol className={css.progress} aria-label={t('compose.progressLabel')}>
            <li data-done={draft.preset.trim() !== '' ? 'true' : undefined}>{t('compose.stepBind')}</li>
            <li data-done={!draft.dirty && draft.graph.nodes.length > 2 ? 'true' : undefined}>{t('compose.stepFlow')}</li>
            <li data-done={tryRunState?.status === 'completed' ? 'true' : undefined}>{t('compose.stepTry')}</li>
            <li>{t('compose.stepUse')}</li>
          </ol>
          <div className={css.composeActions}>
            {editable ? (
              <button
                type="button"
                className={composerCss.checklistButton}
                data-clean={checklistReady && checklistErrors.length === 0 ? 'true' : undefined}
                aria-expanded={checklistOpen}
                onClick={() =>{  setChecklistOpen(open => !open) }}
              >
                {t('compose.checklist')}
                {checklistErrors.length > 0 ? (
                  <span className={composerCss.checklistBadge}>{checklistErrors.length}</span>
                ) : null}
              </button>
            ) : null}
            {actions.useForSession !== undefined ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={draft.busy || draft.preset.trim() === ''}
                onClick={() => {
                  void (async () => {
                    if ((draft.dirty || draft.bindDirty) && editable) {
                      if (!await actions.saveAll()) return
                    }
                    actions.useForSession?.(draft.agentMode)
                    actions.closeCompose()
                  })()
                }}
              >
                {t('section.useForSession')}
              </Button>
            ) : null}
            {editable ? (
              <Button
                type="button"
                variant={actions.useForSession === undefined ? 'primary' : 'outline'}
                size="sm"
                disabled={draft.busy || (!draft.bindDirty && !draft.dirty) || checklistErrors.length > 0}
                title={checklistErrors.length > 0 ? t('compose.checklistBlocksPublish') : undefined}
                onClick={() => { void actions.saveAll() }}
              >
                {draft.busy ? t('section.saving') : t('compose.publish')}
              </Button>
            ) : null}
            {editable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.busy || !draft.bindDirty}
                onClick={() => { void actions.saveBind() }}
              >
                {t('section.saveBind')}
              </Button>
            ) : null}
            {editable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.busy || !draft.dirty}
                onClick={() => { void actions.saveCompose() }}
              >
                {t('section.save')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.busy || tryRunState?.polling === true}
              title={t('section.tryRunHint')}
              onClick={() => { void actions.tryRun() }}
            >
              {tryRunState?.polling === true ? t('section.tryRunning') : t('section.tryRun')}
            </Button>
            {actions.startCreatorDraft !== undefined ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.busy}
                title={t('section.handoffHint')}
                onClick={() => {
                  void (async () => {
                    if ((draft.dirty || draft.bindDirty) && editable) {
                      if (!await actions.saveAll()) return
                    }
                    actions.startCreatorDraft?.()
                    actions.closeCompose()
                  })()
                }}
              >
                {t('section.handoff')}
              </Button>
            ) : null}
          </div>
        </div>

        {checklistOpen ? (
          <aside className={composerCss.checklistPanel} role="dialog" aria-label={t('compose.checklist')}>
            <div className={css.guideHead}>
              <strong>{t('compose.checklist')}</strong>
              <button
                type="button"
                className={css.guideDismiss}
                onClick={() =>{  setChecklistOpen(false) }}
              >
                {t('compose.guideDismiss')}
              </button>
            </div>
            {!checklistReady ? (
              <p className={css.fieldHint}>{t('compose.checklistChecking')}</p>
            ) : checklistErrors.length === 0 ? (
              <p className={css.fieldHint}>{t('compose.checklistEmpty')}</p>
            ) : (
              <ul className={composerCss.checklistList}>
                {checklistErrors.map(error => <li key={error}>{error}</li>)}
              </ul>
            )}
          </aside>
        ) : null}

        {guideOpen ? (
          <aside className={css.guide}>
            <div className={css.guideHead}>
              <strong>{t('compose.guideTitle')}</strong>
              <button
                type="button"
                className={css.guideDismiss}
                onClick={() =>{  setGuideOpen(false) }}
              >
                {t('compose.guideDismiss')}
              </button>
            </div>
            <ol className={css.guideSteps}>
              <li>{t('compose.guideStep1')}</li>
              <li>{t('compose.guideStep2')}</li>
              <li>{t('compose.guideStep3')}</li>
              <li>{t('compose.guideStep4')}</li>
            </ol>
            <p className={css.guideFoot}>
              {t('compose.guidePreset')}:{' '}
              <strong>{boundPreset?.name ?? draft.preset}</strong>
              {boundPreset?.description !== undefined ? ` — ${boundPreset.description}` : null}
              {draft.preset.trim() !== '' ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    className={css.openBoundPreset}
                    onClick={() => { actions.openBoundPreset(draft.preset.trim()) }}
                  >
                    {t('section.openBoundPreset')}
                  </button>
                </>
              ) : null}
            </p>
          </aside>
        ) : (
          <button type="button" className={css.guideReopen} onClick={() =>{  setGuideOpen(true) }}>
            {t('compose.guideTitle')}
          </button>
        )}

        {editable ? (
          <div className={css.bindPanel}>
            <label className={css.field} htmlFor="agent-mode-bind-preset">
              <span className={css.fieldLabel}>{t('section.bindPreset')}</span>
              {renderPresetSelect({
                id: 'agent-mode-bind-preset',
                value: draft.preset,
                disabled: draft.busy,
                onChange: actions.setComposePreset,
              })}
              <p className={css.fieldHint}>{t('section.bindPresetHint')}</p>
              {draft.preset.trim() !== '' ? (
                <button
                  type="button"
                  className={css.openBoundPreset}
                  disabled={draft.busy}
                  onClick={() => { actions.openBoundPreset(draft.preset.trim()) }}
                >
                  {t('section.openBoundPreset')}
                </button>
              ) : null}
            </label>
            <label className={css.field} htmlFor="agent-mode-bind-name">
              <span className={css.fieldLabel}>{t('section.displayName')}</span>
              <input
                id="agent-mode-bind-name"
                className={css.input}
                value={draft.name}
                disabled={draft.busy}
                onChange={(event) =>{  actions.setComposeName(event.target.value) }}
              />
            </label>
            <label className={css.field} htmlFor="agent-mode-bind-description">
              <span className={css.fieldLabel}>{t('section.displayDescription')}</span>
              <textarea
                id="agent-mode-bind-description"
                className={css.textarea}
                rows={2}
                value={draft.description}
                disabled={draft.busy}
                onChange={(event) =>{  actions.setComposeDescription(event.target.value) }}
              />
            </label>
          </div>
        ) : null}

        {tryRunState !== undefined ? (
          <p className={css.tryRunLine}>
            {t('section.tryRunStatus')}: {tryRunState.status}
            {tryRunState.error !== undefined ? ` — ${tryRunState.error}` : null}
          </p>
        ) : null}
        {draft.error !== undefined ? <p className={css.error} role="alert">{draft.error}</p> : null}

        <div className={css.composerBody}>
          <div className={css.stage}>
            {editable && paletteOpen ? (
              <aside className={css.paletteZone}>
                <div className={css.paletteHead}>
                  <h3 className={css.columnHead}>{t('compose.palette')}</h3>
                  <button
                    type="button"
                    className={css.paletteToggle}
                    onClick={() =>{  setPaletteOpen(false) }}
                  >
                    ‹
                  </button>
                </div>
                <p className={css.paletteIntro}>{t('compose.paletteIntro')}</p>
                <ul className={css.paletteList}>
                  {PALETTE_GROUPS.map(group => (
                    <li key={group.groupKey} className={composerCss.paletteGroup}>
                      <p className={composerCss.paletteGroupLabel}>{t(group.groupKey)}</p>
                      <ul className={css.paletteList}>
                        {group.items.map(item => (
                          <li key={item.type}>
                            <button
                              type="button"
                              className={css.paletteCard}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData(DROP_MIME, item.type)
                                event.dataTransfer.effectAllowed = 'copy'
                              }}
                              onClick={() => { placePaletteNode(draft, actions, item.type) }}
                            >
                              <span className={`${css.paletteGlyph} ${css[`glyph_${item.type}`]}`} aria-hidden />
                              <span className={css.paletteBody}>
                                <span className={css.paletteName}>{t(item.titleKey)}</span>
                                <span className={css.paletteHint}>{t(item.hintKey)}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className={css.paletteCard}
                      disabled={draft.preset.trim() === ''}
                      onClick={() => {
                        const presetId = draft.preset.trim()
                        if (presetId === '') return
                        actions.openBoundPreset(presetId)
                      }}
                    >
                      <span className={`${css.paletteGlyph} ${css.glyph_agent}`} aria-hidden />
                      <span className={css.paletteBody}>
                        <span className={css.paletteName}>{t('compose.paletteCapability')}</span>
                        <span className={css.paletteHint}>{t('compose.paletteCapabilityHint')}</span>
                      </span>
                    </button>
                  </li>
                </ul>
              </aside>
            ) : null}
            {editable && !paletteOpen ? (
              <button
                type="button"
                className={css.paletteTab}
                onClick={() =>{  setPaletteOpen(true) }}
              >
                {t('compose.palette')}
              </button>
            ) : null}

            <div className={css.canvasWrap}>
              <FlowCanvas
                surface={surface}
                dropMime={DROP_MIME}
                addNodeAriaLabel={t('compose.addAfter')}
                insertBetweenAriaLabel={t('compose.insertBetween')}
                {...editable ? { canvasHint: t('compose.canvasHint') } : {}}
                {...editable
                  ? {
                    onAddNode: (nodeId: string) => { setPicker({ kind: 'after', nodeId }) },
                    onInsertBetween: (from: string, to: string) => {
                      setPicker({ kind: 'between', from, to })
                    },
                  }
                  : {}}
                renderNode={(node: FlowNode) => {
                  const status = tryRunState?.nodeStatuses[node.id]
                  const route = node.type === 'agent'
                    ? [node.agentOptions?.provider, node.agentOptions?.model].filter(Boolean).join('/')
                    : ''
                  return (
                    <div className={`${css.nodeCard} ${css[`card_${node.type}`]}`}>
                      <div className={css.nodeCardHead}>
                        <span className={`${css.nodeType} ${css[`type_${node.type}`]}`}>
                          {node.type}
                        </span>
                        {status !== undefined ? <span className={css.nodeStatus}>{status}</span> : null}
                      </div>
                      <div className={css.nodeTitle}>{node.label ?? node.id}</div>
                      {node.type === 'agent' && node.prompt.trim() !== ''
                        ? <div className={css.nodePreview}>{node.prompt}</div>
                        : null}
                      {node.type === 'agent' && route !== ''
                        ? <div className={css.nodeMeta}>{route}</div>
                        : null}
                      {node.type === 'agent' && node.childPresetId !== undefined
                        ? <div className={css.nodeMeta}>preset · {node.childPresetId}</div>
                        : null}
                      {node.type === 'condition'
                        ? <div className={css.nodePreview}>{node.expression}</div>
                        : null}
                      {node.type === 'loop'
                        ? <div className={css.nodePreview}>{`${node.variable} ← ${node.iterable}`}</div>
                        : null}
                      {node.type === 'http'
                        ? <div className={css.nodePreview}>{node.url}</div>
                        : null}
                      {node.type === 'template'
                        ? <div className={css.nodePreview}>{node.template}</div>
                        : null}
                      {node.type === 'code'
                        ? <div className={css.nodePreview}>{node.source}</div>
                        : null}
                      {node.type === 'aggregate'
                        ? <div className={css.nodePreview}>{`${node.mode} · ${String(node.items.length)}`}</div>
                        : null}
                      {node.type === 'list'
                        ? <div className={css.nodePreview}>{`${node.op} ← ${node.source}`}</div>
                        : null}
                      {node.type === 'classify'
                        ? <div className={css.nodePreview}>{node.classes.map(item => item.id).join(' / ')}</div>
                        : null}
                      {node.type === 'extract'
                        ? <div className={css.nodePreview}>{node.parameters.map(item => item.name).join(', ')}</div>
                        : null}
                    </div>
                  )
                }}
              />
            </div>

            <aside className={css.inspector}>
              <h3 className={css.columnHead}>{t('compose.inspector')}</h3>
              <div className={composerCss.tabs} role="tablist" aria-label={t('compose.inspector')}>
                <button
                  type="button"
                  role="tab"
                  className={composerCss.tab}
                  aria-selected={inspectorTab === 'settings'}
                  data-active={inspectorTab === 'settings' ? 'true' : undefined}
                  onClick={() =>{  setInspectorTab('settings') }}
                >
                  {t('compose.tabSettings')}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={composerCss.tab}
                  aria-selected={inspectorTab === 'lastRun'}
                  data-active={inspectorTab === 'lastRun' ? 'true' : undefined}
                  onClick={() =>{  setInspectorTab('lastRun') }}
                >
                  {t('compose.tabLastRun')}
                </button>
              </div>

              {inspectorTab === 'settings' ? (
                selected !== undefined ? (
                  <>
                    <p className={css.fieldHint}>{selected.type} · {selected.id}</p>
                    {selected.type === 'agent' ? (
                      <>
                        <label className={css.field} htmlFor="agent-mode-node-system">
                          <span className={css.fieldLabel}>{t('section.systemPrompt')}</span>
                          <textarea
                            id="agent-mode-node-system"
                            className={css.textarea}
                            rows={3}
                            value={selected.systemPrompt ?? ''}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedSystemPrompt(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('compose.systemHint')}</p>
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-prompt">
                          <span className={css.fieldLabel}>{t('section.userPrompt')}</span>
                          <textarea
                            id="agent-mode-node-prompt"
                            className={css.textarea}
                            rows={5}
                            value={selected.prompt}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedPrompt(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('compose.userHint')}</p>
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-provider">
                          <span className={css.fieldLabel}>{t('section.provider')}</span>
                          <input
                            id="agent-mode-node-provider"
                            className={css.input}
                            value={selected.agentOptions?.provider ?? ''}
                            disabled={!editable}
                            placeholder={t('section.providerPlaceholder')}
                            onChange={(event) =>{  actions.setSelectedProvider(event.target.value) }}
                          />
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-model">
                          <span className={css.fieldLabel}>{t('section.model')}</span>
                          <input
                            id="agent-mode-node-model"
                            className={css.input}
                            value={selected.agentOptions?.model ?? ''}
                            disabled={!editable}
                            placeholder={t('section.modelPlaceholder')}
                            onChange={(event) =>{  actions.setSelectedModel(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('section.modelHint')}</p>
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-child-preset">
                          <span className={css.fieldLabel}>{t('section.childPreset')}</span>
                          {renderPresetSelect({
                            id: 'agent-mode-node-child-preset',
                            value: selected.childPresetId ?? '',
                            disabled: !editable,
                            allowEmpty: true,
                            emptyLabel: t('section.childPresetNone'),
                            onChange: actions.setSelectedChildPresetId,
                          })}
                          <p className={css.fieldHint}>{t('section.childPresetHint')}</p>
                        </label>
                      </>
                    ) : null}
                    {selected.type === 'condition' ? (
                      <label className={css.field} htmlFor="agent-mode-node-expression">
                        <span className={css.fieldLabel}>{t('section.expression')}</span>
                        <textarea
                          id="agent-mode-node-expression"
                          className={css.textarea}
                          rows={4}
                          value={selected.expression}
                          disabled={!editable}
                          onChange={(event) =>{  actions.setSelectedExpression(event.target.value) }}
                        />
                        <p className={css.fieldHint}>{t('compose.expressionHint')}</p>
                      </label>
                    ) : null}
                    {selected.type === 'loop' ? (
                      <>
                        <label className={css.field} htmlFor="agent-mode-node-iterable">
                          <span className={css.fieldLabel}>{t('section.iterable')}</span>
                          <textarea
                            id="agent-mode-node-iterable"
                            className={css.textarea}
                            rows={2}
                            value={selected.iterable}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedIterable(event.target.value) }}
                          />
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-variable">
                          <span className={css.fieldLabel}>{t('section.variable')}</span>
                          <input
                            id="agent-mode-node-variable"
                            className={css.input}
                            value={selected.variable}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedVariable(event.target.value) }}
                          />
                        </label>
                      </>
                    ) : null}
                    {selected.type === 'http' ? (
                      <label className={css.field} htmlFor="agent-mode-node-url">
                        <span className={css.fieldLabel}>{t('section.url')}</span>
                        <input
                          id="agent-mode-node-url"
                          className={css.input}
                          value={selected.url}
                          disabled={!editable}
                          placeholder={t('section.urlPlaceholder')}
                          onChange={(event) =>{  actions.setSelectedUrl(event.target.value) }}
                        />
                        <p className={css.fieldHint}>{t('compose.urlHint')}</p>
                      </label>
                    ) : null}
                    {selected.type === 'template' ? (
                      <label className={css.field} htmlFor="agent-mode-node-template">
                        <span className={css.fieldLabel}>{t('section.template')}</span>
                        <textarea
                          id="agent-mode-node-template"
                          className={css.textarea}
                          rows={5}
                          value={selected.template}
                          disabled={!editable}
                          onChange={(event) =>{  actions.setSelectedTemplate(event.target.value) }}
                        />
                        <p className={css.fieldHint}>{t('compose.templateHint')}</p>
                      </label>
                    ) : null}
                    {selected.type === 'code' ? (
                      <label className={css.field} htmlFor="agent-mode-node-source">
                        <span className={css.fieldLabel}>{t('section.source')}</span>
                        <textarea
                          id="agent-mode-node-source"
                          className={css.textarea}
                          rows={8}
                          value={selected.source}
                          disabled={!editable}
                          onChange={(event) =>{  actions.setSelectedSource(event.target.value) }}
                        />
                        <p className={css.fieldHint}>{t('compose.sourceHint')}</p>
                      </label>
                    ) : null}
                    {selected.type === 'aggregate' ? (
                      <>
                        <label className={css.field} htmlFor="agent-mode-node-aggregate-mode">
                          <span className={css.fieldLabel}>{t('section.aggregateMode')}</span>
                          <select
                            id="agent-mode-node-aggregate-mode"
                            className={css.input}
                            value={selected.mode}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedAggregateMode(event.target.value) }}
                          >
                            <option value="object">{t('section.aggregateModeObject')}</option>
                            <option value="first">{t('section.aggregateModeFirst')}</option>
                            <option value="concat">{t('section.aggregateModeConcat')}</option>
                          </select>
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-aggregate-items">
                          <span className={css.fieldLabel}>{t('section.aggregateItems')}</span>
                          <textarea
                            id="agent-mode-node-aggregate-items"
                            className={css.textarea}
                            rows={5}
                            value={formatAggregateItems(selected.items)}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedAggregateItems(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('compose.aggregateHint')}</p>
                        </label>
                      </>
                    ) : null}
                    {selected.type === 'classify' ? (
                      <>
                        <label className={css.field} htmlFor="agent-mode-node-classify-query">
                          <span className={css.fieldLabel}>{t('section.classifyQuery')}</span>
                          <textarea
                            id="agent-mode-node-classify-query"
                            className={css.textarea}
                            rows={3}
                            value={selected.query}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedClassifyQuery(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('compose.classifyQueryHint')}</p>
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-classify-classes">
                          <span className={css.fieldLabel}>{t('section.classifyClasses')}</span>
                          <textarea
                            id="agent-mode-node-classify-classes"
                            className={css.textarea}
                            rows={4}
                            value={formatClassifyClasses(selected.classes)}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedClassifyClasses(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('compose.classifyHint')}</p>
                        </label>
                      </>
                    ) : null}
                    {selected.type === 'extract' ? (
                      <>
                        <label className={css.field} htmlFor="agent-mode-node-extract-query">
                          <span className={css.fieldLabel}>{t('section.extractQuery')}</span>
                          <textarea
                            id="agent-mode-node-extract-query"
                            className={css.textarea}
                            rows={3}
                            value={selected.query}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedExtractQuery(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('compose.extractQueryHint')}</p>
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-extract-params">
                          <span className={css.fieldLabel}>{t('section.extractParams')}</span>
                          <textarea
                            id="agent-mode-node-extract-params"
                            className={css.textarea}
                            rows={4}
                            value={formatExtractParams(selected.parameters)}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedExtractParams(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('compose.extractHint')}</p>
                        </label>
                      </>
                    ) : null}
                    {selected.type === 'list' ? (
                      <>
                        <label className={css.field} htmlFor="agent-mode-node-list-op">
                          <span className={css.fieldLabel}>{t('section.listOp')}</span>
                          <select
                            id="agent-mode-node-list-op"
                            className={css.input}
                            value={selected.op}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedListOp(event.target.value) }}
                          >
                            <option value="first">{t('section.listOpFirst')}</option>
                            <option value="last">{t('section.listOpLast')}</option>
                            <option value="length">{t('section.listOpLength')}</option>
                            <option value="reverse">{t('section.listOpReverse')}</option>
                            <option value="flatten">{t('section.listOpFlatten')}</option>
                          </select>
                        </label>
                        <label className={css.field} htmlFor="agent-mode-node-list-source">
                          <span className={css.fieldLabel}>{t('section.listSource')}</span>
                          <textarea
                            id="agent-mode-node-list-source"
                            className={css.textarea}
                            rows={3}
                            value={selected.source}
                            disabled={!editable}
                            onChange={(event) =>{  actions.setSelectedListSource(event.target.value) }}
                          />
                          <p className={css.fieldHint}>{t('compose.listHint')}</p>
                        </label>
                      </>
                    ) : null}
                    {selected.type === 'start' || selected.type === 'end' ? (
                      <p className={css.fieldHint}>{t('compose.structuralNode')}</p>
                    ) : null}
                    {editable && selected.type !== 'start' && selected.type !== 'end' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>{  actions.removeNode(selected.id) }}
                      >
                        {t('compose.deleteNode')}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p className={css.fieldHint}>{t('compose.inspectorEmpty')}</p>
                )
              ) : tryRunState === undefined ? (
                <p className={css.fieldHint}>{t('compose.lastRunEmpty')}</p>
              ) : (
                <>
                  <p className={css.fieldHint}>
                    {t('compose.lastRunStatus')}: {tryRunState.status}
                    {selectedNodeStatus !== undefined
                      ? ` · ${selected?.id ?? ''}: ${selectedNodeStatus}`
                      : null}
                    {tryRunState.error !== undefined ? ` — ${tryRunState.error}` : null}
                  </p>
                  <p className={css.fieldLabel}>{t('compose.lastRunOutput')}</p>
                  <pre className={composerCss.lastRunJson}>
                    {JSON.stringify(lastRunPayload, null, 2)}
                  </pre>
                  {selected !== undefined && tryRunState.nodeInputs?.[selected.id] !== undefined ? (
                    <>
                      <p className={css.fieldLabel}>{t('compose.lastRunInput')}</p>
                      <pre className={composerCss.lastRunJson}>
                        {JSON.stringify(tryRunState.nodeInputs[selected.id], null, 2)}
                      </pre>
                    </>
                  ) : null}
                  {selected !== undefined && selected.type !== 'start' && selected.type !== 'end' ? (
                    <>
                      <label className={css.field} htmlFor="agent-mode-node-seed-output">
                        <span className={css.fieldLabel}>{t('compose.editOutput')}</span>
                        <textarea
                          id="agent-mode-node-seed-output"
                          className={css.textarea}
                          rows={6}
                          value={editedOutput ?? JSON.stringify(tryRunState.nodeOutputs?.[selected.id] ?? null, null, 2)}
                          disabled={draft.busy || tryRunState.polling}
                          onChange={(event) =>{  setEditedOutput(event.target.value) }}
                        />
                        <p className={css.fieldHint}>{t('compose.editOutputHint')}</p>
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={draft.busy || tryRunState.polling}
                        onClick={() => {
                          const text = editedOutput ?? JSON.stringify(tryRunState.nodeOutputs?.[selected.id] ?? null)
                          let edited: JsonValue | undefined
                          try {
                            edited = JSON.parse(text) as JsonValue
                          } catch {
                            edited = undefined
                          }
                          void actions.tryRun(seedForRerun(
                            tryRunState.nodeOutputs ?? {},
                            draft.graph,
                            selected.id,
                            edited,
                          ))
                          setEditedOutput(undefined)
                        }}
                      >
                        {t('compose.rerunFromHere')}
                      </Button>
                    </>
                  ) : null}
                </>
              )}
            </aside>
          </div>
        </div>
      </div>

      {picker !== null ? (
        <Modal
          open
          title={t('compose.pickerTitle')}
          description={picker.kind === 'after'
            ? `${t('compose.pickerAfter')} ${picker.nodeId}`
            : `${t('compose.pickerBetween')} ${picker.from} → ${picker.to}`}
          closeLabel={t('section.close')}
          onClose={() =>{  setPicker(null) }}
          className={css.dialog as string}
        >
          <ul className={css.pickerList}>
            {PALETTE_FLAT.map(item => (
              <li key={item.type}>
                <button
                  type="button"
                  className={css.paletteCard}
                  onClick={() => {
                    if (picker.kind === 'after') actions.addAfter(picker.nodeId, item.type)
                    else actions.insertBetween(picker.from, picker.to, item.type)
                    setPicker(null)
                  }}
                >
                  <span className={`${css.paletteGlyph} ${css[`glyph_${item.type}`]}`} aria-hidden />
                  <span className={css.paletteBody}>
                    <span className={css.paletteName}>{t(item.titleKey)}</span>
                    <span className={css.paletteHint}>{t(item.hintKey)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </div>
  )
}

/** Narrow the section snapshot's compose field for callers. */
export type ModeComposerDraft = NonNullable<AgentModeSectionState['compose']>
