/**
 * Agent-mode settings section: roster cards and an orchestration canvas over
 * each mode's entry flow.
 */

import { useEffect, type ReactNode } from 'react'
import {
  Button,
  IconBrowseOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentModeSectionState, PresetOption } from './section-store.ts'
import { copyBlocker, createBlocker } from './section-store.ts'
import type { PlaceableNodeType } from './mode-graph.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { AgentModeSettingsKey } from './locales.ts'
import { modeDisplayText } from './locales.ts'
import { ModeComposer } from './ModeComposer.tsx'
import css from './AgentModeSection.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent-mode settings section copy. */
    'settings.agentMode': AgentModeSettingsKey
  }
}

/** Registration-side business face for the management section. */
export interface AgentModeSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useAgentModeSection. */
    agentModeSection: SnapshotStore<AgentModeSectionState>
  }
  /** Read the roster; called once when the section first renders. */
  load: () => Promise<void>
  beginCreate: () => void
  cancelCreate: () => void
  setCreateField: (field: 'id' | 'name' | 'description' | 'preset', value: string) => void
  confirmCreate: () => Promise<void>
  beginCopy: (from: string) => void
  cancelCopy: () => void
  setCopyId: (id: string) => void
  setCopyName: (name: string) => void
  confirmCopy: () => Promise<void>
  confirmDelete: (id: string | null) => void
  remove: () => Promise<void>
  beginCompose: (id: string) => Promise<void>
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
  tryRun: (seed?: Record<string, JsonValue>) => Promise<void>
  /** Save-then-handoff into Creator mode when the cordis preset is available. */
  startCreatorDraft?: () => void
  /** Jump to the Agent hub presets tab and open the bound preset. */
  openBoundPreset: (presetId: string) => void
  /** Stage this scenario on a new session and leave settings. */
  useForSession?: (modeId: string) => void
  /** Persist bind and/or flow when either side is dirty. */
  saveAll: () => Promise<boolean>
}

/** Component props. */
export type AgentModeSectionProps =
  & PropsRuntime<'settings.agent.tab'>
  & PropsLocale<'settings.agentMode'>
  & InjectFace<AgentModeSectionInjected>

/**
 * Label for a preset option in a select.
 * @param preset - roster row or a synthetic stale id.
 * @returns display text.
 */
function presetOptionLabel(preset: Pick<PresetOption, 'id' | 'name' | 'trust' | 'broken'>): string {
  const title = preset.name ?? preset.id
  if (preset.broken !== undefined) return `${title} (${preset.id}) · broken`
  if (preset.name !== undefined && preset.name !== preset.id) return `${title} (${preset.id})`
  return title
}

/**
 * Healthy presets plus the current value when it is missing from the roster.
 * @param presets - loaded picker options.
 * @param value - currently selected id.
 * @returns options for a bind select.
 */
function presetSelectOptions(
  presets: readonly PresetOption[],
  value: string,
): Array<Pick<PresetOption, 'id' | 'name' | 'trust' | 'broken'>> {
  const healthy = presets.filter(preset => preset.broken === undefined)
  if (value === '' || healthy.some(preset => preset.id === value)) return healthy
  const stale = presets.find(preset => preset.id === value)
  return [
    {
      id: value,
      trust: stale?.trust ?? 'user',
      ...stale?.name === undefined ? {} : { name: stale.name },
      broken: stale?.broken ?? 'missing',
    },
    ...healthy,
  ]
}

/** Preset picker shared by create / bind / child-preset fields. */
function PresetSelect(props: {
  id: string
  value: string
  presets: readonly PresetOption[]
  disabled?: boolean
  allowEmpty?: boolean
  emptyLabel?: string
  emptyRosterLabel: string
  onChange: (value: string) => void
}): ReactNode {
  const options = presetSelectOptions(props.presets, props.value)
  return (
    <select
      id={props.id}
      className={css.select}
      value={props.value}
      disabled={props.disabled === true || (options.length === 0 && props.allowEmpty !== true)}
      onChange={(event) =>{  props.onChange(event.target.value) }}
    >
      {props.allowEmpty === true
        ? <option value="">{props.emptyLabel ?? ''}</option>
        : null}
      {options.length === 0 && props.allowEmpty !== true
        ? <option value="">{props.emptyRosterLabel}</option>
        : null}
      {options.map(preset => (
        <option key={preset.id} value={preset.id}>
          {presetOptionLabel(preset)}
        </option>
      ))}
    </select>
  )
}

/**
 * Settings section for agent modes.
 * @param props - locale, runtime, and inject face.
 * @returns the section tree.
 */
export function AgentModeSection(props: AgentModeSectionProps): ReactNode {
  const { t, useAgentModeSection, load, beginCreate, cancelCreate, setCreateField, confirmCreate,
    beginCopy, cancelCopy, setCopyId, setCopyName,
    confirmCopy, confirmDelete, remove, beginCompose, closeCompose,
    setComposePreset, setComposeName, setComposeDescription, saveBind,
    selectNode, selectEdge, moveNode, addNodeAt, addEdge, removeNode, removeEdge,
    addAfter, insertBetween,
    setSelectedPrompt, setSelectedSystemPrompt, setSelectedModel, setSelectedProvider,
    setSelectedChildPresetId, setSelectedExpression, setSelectedIterable, setSelectedVariable, setSelectedUrl,
    setSelectedTemplate, setSelectedSource,
    setSelectedAggregateItems, setSelectedAggregateMode, setSelectedListSource, setSelectedListOp,
    setSelectedClassifyQuery, setSelectedClassifyClasses, setSelectedExtractQuery, setSelectedExtractParams,
    saveCompose, saveAll, tryRun, startCreatorDraft, openBoundPreset, useForSession } = props
  const state = useAgentModeSection(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  const pendingDelete = state.pendingDelete === undefined
    ? undefined
    : state.modes.find(mode => mode.id === state.pendingDelete)
  const createBlock = state.create === undefined
    ? undefined
    : createBlocker(state.create, state.modes)
  const copyBlock = state.copy === undefined
    ? undefined
    : copyBlocker(state.copy, state.modes)

  if (state.compose !== undefined) {
    return (
      <ModeComposer
        draft={state.compose}
        presets={state.presets}
        t={t}
        renderPresetSelect={selectProps => (
          <PresetSelect
            {...selectProps}
            presets={state.presets}
            emptyRosterLabel={t('section.createPresetEmpty')}
          />
        )}
        actions={{
          closeCompose,
          setComposePreset,
          setComposeName,
          setComposeDescription,
          saveBind,
          selectNode,
          selectEdge,
          moveNode,
          addNodeAt,
          addEdge,
          removeNode,
          removeEdge,
          addAfter,
          insertBetween,
          setSelectedPrompt,
          setSelectedSystemPrompt,
          setSelectedModel,
          setSelectedProvider,
          setSelectedChildPresetId,
          setSelectedExpression,
          setSelectedIterable,
          setSelectedVariable,
          setSelectedUrl,
          setSelectedTemplate,
          setSelectedSource,
          setSelectedAggregateItems,
          setSelectedAggregateMode,
          setSelectedListSource,
          setSelectedListOp,
          setSelectedClassifyQuery,
          setSelectedClassifyClasses,
          setSelectedExtractQuery,
          setSelectedExtractParams,
          saveCompose,
          saveAll,
          tryRun,
          openBoundPreset,
          ...useForSession === undefined ? {} : { useForSession },
          ...startCreatorDraft === undefined ? {} : { startCreatorDraft },
        }}
      />
    )
  }

  const creatorEntry = state.authorable
    ? (
      <div className={css.createRow}>
        <button type="button" className={css.creatorButton} onClick={beginCreate}>
          <IconPlusOutline16 size={14} />
          {t('section.create')}
        </button>
      </div>
    )
    : null

  return (
    <div className={css.section}>
      <p className={css.intro}>{t('section.description')}</p>
      {state.error !== undefined ? <p className={css.error} role="alert">{state.error}</p> : null}
      {state.loading ? <p className={css.empty}>{t('seat.loading')}</p> : null}
      {([['system', t('section.builtInGroup')], ['user', t('section.customGroup')]] as const).map(([trust, heading]) => {
        const group = state.modes.filter(mode => mode.trust === trust)
        const tail = trust === 'user' ? creatorEntry : null
        if (!state.loading && group.length === 0 && tail === null) return null
        if (!state.loading && group.length === 0 && trust === 'user') {
          return (
            <section key={trust} className={css.group}>
              <h3 className={css.groupHead}>{heading}</h3>
              <p className={css.empty}>{t('section.empty')}</p>
              {tail}
            </section>
          )
        }
        if (group.length === 0 && tail === null) return null
        return (
          <section key={trust} className={css.group}>
            <h3 className={css.groupHead}>{heading}</h3>
            {trust === 'system' && group.length > 0
              ? <p className={css.groupHint}>{t('section.builtInHint')}</p>
              : null}
            {group.length === 0 ? null : (
              <ul className={css.cards}>
                {group.map((mode) => {
                  const text = modeDisplayText(mode, t)
                  return (
                    <li
                      key={mode.id}
                      className={mode.broken !== undefined ? `${css.card} ${css.cardBroken}` : css.card}
                    >
                      <div className={css.cardBody}>
                        <div className={css.cardHead}>
                          <span className={css.cardName}>{text.name}</span>
                          <span className={css.badge}>
                            {mode.trust === 'system' ? t('section.system') : t('section.user')}
                          </span>
                          {mode.broken !== undefined
                            ? <span className={css.brokenBadge}>{t('section.broken')}</span>
                            : null}
                        </div>
                        <span className={css.cardDesc}>
                          {text.description ?? t('section.noDescription')}
                        </span>
                        <div className={css.cardMeta}>
                          <code className={css.cardId}>{mode.id}</code>
                          {mode.preset === undefined ? null : (() => {
                            const preset = mode.preset
                            return (
                              <button
                                type="button"
                                className={css.cardBindLink}
                                onClick={() => { openBoundPreset(preset) }}
                              >
                                {t('section.preset')}: {preset}
                              </button>
                            )
                          })()}
                        </div>
                      </div>
                      <div className={css.cardFoot}>
                        <button
                          type="button"
                          className={css.iconButton}
                          data-tip={mode.trust === 'system' ? t('section.view') : t('section.compose')}
                          aria-label={mode.trust === 'system' ? t('section.view') : t('section.compose')}
                          onClick={() => { void beginCompose(mode.id) }}
                        >
                          {mode.trust === 'system'
                            ? <IconBrowseOutline16 size={16} />
                            : <IconEditOutline16 size={16} />}
                        </button>
                        {state.authorable ? (
                          <button
                            type="button"
                            className={css.iconButton}
                            data-tip={t('section.copy')}
                            aria-label={t('section.copy')}
                            onClick={() =>{  beginCopy(mode.id) }}
                          >
                            <IconCopyOutline16 size={16} />
                          </button>
                        ) : null}
                        {mode.trust === 'user' ? (
                          <button
                            type="button"
                            className={`${css.iconButton} ${css.iconDanger}`}
                            data-tip={t('section.delete')}
                            aria-label={t('section.delete')}
                            onClick={() =>{  confirmDelete(mode.id) }}
                          >
                            <IconTrashOutline16 size={16} />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {tail}
          </section>
        )
      })}

      <Modal
        open={state.create !== undefined}
        title={t('section.createTitle')}
        description={t('section.createIntro')}
        closeLabel={t('section.createCancel')}
        onClose={cancelCreate}
        className={css.dialog as string}
        footer={(
          <>
            <Button variant="outline" disabled={state.create?.busy === true} onClick={cancelCreate}>
              {t('section.createCancel')}
            </Button>
            <Button
              variant="primary"
              disabled={
                state.create === undefined
                || state.create.busy
                || createBlock !== undefined
              }
              onClick={() => { void confirmCreate() }}
            >
              {t('section.createConfirm')}
            </Button>
          </>
        )}
      >
        {state.create === undefined ? null : (
          <div className={css.dialogFields}>
            <label className={css.field} htmlFor="agent-mode-create-id">
              <span className={css.fieldLabel}>{t('section.createId')}</span>
              <input
                id="agent-mode-create-id"
                className={css.input}
                value={state.create.id}
                autoFocus
                spellCheck={false}
                placeholder={t('section.createIdPlaceholder')}
                onChange={(event) =>{  setCreateField('id', event.target.value) }}
              />
              <p className={css.fieldHint}>{t('section.createIdHint')}</p>
            </label>
            <label className={css.field} htmlFor="agent-mode-create-name">
              <span className={css.fieldLabel}>{t('section.createName')}</span>
              <input
                id="agent-mode-create-name"
                className={css.input}
                value={state.create.name}
                spellCheck={false}
                placeholder={t('section.createNamePlaceholder')}
                onChange={(event) =>{  setCreateField('name', event.target.value) }}
              />
            </label>
            <label className={css.field} htmlFor="agent-mode-create-description">
              <span className={css.fieldLabel}>{t('section.createDescription')}</span>
              <textarea
                id="agent-mode-create-description"
                className={css.textarea}
                rows={2}
                value={state.create.description}
                placeholder={t('section.createDescriptionPlaceholder')}
                onChange={(event) =>{  setCreateField('description', event.target.value) }}
              />
            </label>
            <label className={css.field} htmlFor="agent-mode-create-preset">
              <span className={css.fieldLabel}>{t('section.createPreset')}</span>
              <PresetSelect
                id="agent-mode-create-preset"
                value={state.create.preset}
                presets={state.presets}
                disabled={state.create.busy}
                emptyRosterLabel={t('section.createPresetEmpty')}
                onChange={(value) =>{  setCreateField('preset', value) }}
              />
              <p className={css.fieldHint}>{t('section.bindPresetHint')}</p>
            </label>
            {createBlock !== undefined
              ? (
                <p className={css.error} role="alert">
                  {createBlock === 'idRequired' ? t('section.idRequired')
                    : createBlock === 'idInvalid' ? t('section.idInvalid')
                      : createBlock === 'idTaken' ? t('section.idTaken')
                        : t('section.presetRequired')}
                </p>
              )
              : null}
            {state.create.error !== undefined
              ? <p className={css.error} role="alert">{state.create.error}</p>
              : null}
          </div>
        )}
      </Modal>

      <Modal
        open={state.copy !== undefined}
        title={t('section.copyTitle')}
        description={t('section.copyIntro')}
        closeLabel={t('section.copyCancel')}
        onClose={cancelCopy}
        className={css.dialog as string}
        footer={(
          <>
            <Button variant="outline" disabled={state.copy?.busy === true} onClick={cancelCopy}>
              {t('section.copyCancel')}
            </Button>
            <Button
              variant="primary"
              disabled={state.copy === undefined || state.copy.busy || copyBlock !== undefined}
              onClick={() => { void confirmCopy() }}
            >
              {t('section.copyConfirm')}
            </Button>
          </>
        )}
      >
        {state.copy === undefined ? null : (
          <div className={css.dialogFields}>
            <label className={css.field} htmlFor="agent-mode-copy-id">
              <span className={css.fieldLabel}>{t('section.copyId')}</span>
              <input
                id="agent-mode-copy-id"
                className={css.input}
                value={state.copy.id}
                autoFocus
                spellCheck={false}
                placeholder={t('section.copyIdPlaceholder')}
                onChange={(event) =>{  setCopyId(event.target.value) }}
              />
              <p className={css.fieldHint}>{t('section.createIdHint')}</p>
            </label>
            <label className={css.field} htmlFor="agent-mode-copy-name">
              <span className={css.fieldLabel}>{t('section.copyName')}</span>
              <input
                id="agent-mode-copy-name"
                className={css.input}
                value={state.copy.name}
                spellCheck={false}
                placeholder={t('section.copyNamePlaceholder')}
                onChange={(event) =>{  setCopyName(event.target.value) }}
              />
            </label>
            {copyBlock !== undefined
              ? (
                <p className={css.error} role="alert">
                  {copyBlock === 'idRequired' ? t('section.idRequired')
                    : copyBlock === 'idInvalid' ? t('section.idInvalid')
                      : t('section.idTaken')}
                </p>
              )
              : null}
            {state.copy.error !== undefined
              ? <p className={css.error} role="alert">{state.copy.error}</p>
              : null}
          </div>
        )}
      </Modal>

      <Modal
        open={state.pendingDelete !== undefined}
        title={t('section.deleteTitle')}
        closeLabel={t('section.deleteCancel')}
        onClose={() =>{  confirmDelete(null) }}
        className={css.deleteDialog as string}
        footer={(
          <>
            <Button variant="outline" onClick={() =>{  confirmDelete(null) }}>
              {t('section.deleteCancel')}
            </Button>
            <Button
              variant="outline"
              className={css.deleteConfirm}
              onClick={() => { void remove() }}
            >
              {t('section.deleteAction')}
            </Button>
          </>
        )}
      >
        <p className={css.intro}>
          {t('section.deleteConfirm')}
          {pendingDelete === undefined ? null : (
            <>
              {' '}
              <strong>{pendingDelete.name ?? pendingDelete.id}</strong>
            </>
          )}
        </p>
      </Modal>
    </div>
  )
}
