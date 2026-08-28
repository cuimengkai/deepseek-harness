/**
 * The model mapping of one pi-ai provider profile: five fixed model roles —
 * Sonnet, Opus, Fable, Haiku, Subagent — plus one default fallback model,
 * cc-switch's mapping posture. Each role row edits three facts: the display
 * name the model picker shows (`name`), the model id actually requested
 * (`id`), and whether the route declares 1M-token context support
 * (`contextWindow: 1_000_000`). Haiku offers no 1M declaration (its class of
 * model never grows one), and the Subagent role never reaches the picker, so
 * its display-name column says so instead of an input; the fallback row is
 * the model itself, so it has no display name either.
 *
 * The mapping is the profile's `models` array as the card holds it: a role
 * row stores one entry carrying the role in its `role` field, the fallback
 * row stores one bare entry (no `name` — the picker then shows its id), and
 * an empty mapping means "serve this route's built-in catalog", so a row is
 * only ever filled deliberately. Entries a future schema adds, or ones
 * hand-written in `settings.yaml` under some other role, are neither shown
 * here nor dropped by an edit — the mapping manages its six rows and leaves
 * every other entry alone.
 *
 * Pulling models from the endpoint lives in the dialog the header's
 * 获取模型列表 button opens (`ManageTestDialog`); this section is the rows it
 * fills.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DiscoveredModelView } from '@deepseek-ai/dsh-api-remotes/client'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * One mapped model row. Structurally open, exactly like the DeepSeek catalog
 * editor's rows: a profile field this card does not edit — one a future
 * schema adds, or one hand-written in `settings.yaml` — has to survive being
 * edited here rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** The five model roles the mapping offers, in display and fill order. */
export const MODEL_ROLES = ['Sonnet', 'Opus', 'Fable', 'Haiku', 'Subagent'] as const

/** The roles a 1M declaration may be set on; Haiku never grows one. */
export const ONE_M_ROLES: ReadonlySet<string> = new Set(['Sonnet', 'Opus', 'Fable', 'Subagent'])

/** The roles the model picker never shows, so their rows offer no name field. */
const HIDDEN_ROLES: ReadonlySet<string> = new Set(['Subagent'])

/** What checking the 1M declaration writes on the entry. */
const ONE_M_CONTEXT_WINDOW = 1_000_000

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** Whether a mapping row's 1M declaration is on for the entry shown. */
function declaresOneM(entry: ModelDraft | undefined): boolean {
  return entry?.['contextWindow'] === ONE_M_CONTEXT_WINDOW
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
  /** Open the endpoint's 获取模型列表 dialog from the mapping header. */
  onFetch?: () => void
  /** Copy key naming why the fetch is unavailable, or undefined when it is not. */
  fetchBlocked?: keyof typeof en | undefined
  /**
   * The candidates the last interrogation returned — the pool every row's
   * pick menu lists. Absent or empty before a fetch, so the pick column
   * renders nothing until the endpoint's own listing exists.
   */
  fetched?: readonly DiscoveredModelView[] | undefined
}

/** The mapping row keys in display order: the five roles, then the fallback. */
type RowKey = typeof MODEL_ROLES[number] | 'fallback'

/**
 * The entry a row is filled from. Roles match by their `role` field, with a
 * stored display name equal to the role recognized as that role's entry too —
 * the spelling an earlier mapping wrote, kept readable so a draft survives
 * the upgrade. The fallback is the one bare entry: no role and no name.
 */
function entryFor(models: readonly ModelDraft[], key: RowKey): ModelDraft | undefined {
  return models.find((model) => {
    const name = textOf(model, 'name')
    const role = textOf(model, 'role')
    if (key === 'fallback') return role === '' && name === ''
    return role === key || (role === '' && name === key)
  })
}

/**
 * Replace one row's entry, or remove it when the id is empty. The write
 * carries the role on the entry (`role`), so the display name stays a
 * separate fact; clearing the id removes the entry — an empty override is a
 * different intent from handing the catalog back, which is what reset does.
 * @param models - the mapping as currently drafted.
 * @param key - the row being written.
 * @param id - the model id the row names, or the empty string to clear.
 * @param name - the display name the row names (ignored for the fallback).
 * @param oneM - whether the row declares 1M context support.
 * @returns the next drafted array.
 */
function writeRow(models: readonly ModelDraft[], key: RowKey, id: string, name: string, oneM: boolean): ModelDraft[] {
  const next = models.map(model => ({ ...model }))
  const at = next.findIndex(model =>
    key === 'fallback'
      ? textOf(model, 'role') === '' && textOf(model, 'name') === ''
      : textOf(model, 'role') === key || (textOf(model, 'role') === '' && textOf(model, 'name') === key))
  if (id.length === 0) {
    if (at >= 0) next.splice(at, 1)
    return next
  }
  const entry: ModelDraft = {
    id,
    ...key === 'fallback' ? {} : { role: key },
    ...key === 'fallback' || name.length === 0 ? {} : { name },
    ...oneM ? { contextWindow: ONE_M_CONTEXT_WINDOW } : {},
  }
  const previous = at >= 0 ? next[at] : undefined
  if (previous === undefined) {
    next.push(entry)
  } else {
    // Fields this card cannot see ride along: capacities the endpoint
    // disclosed, modalities, anything hand-written in settings.yaml.
    const { role: _role, name: _name, contextWindow: _contextWindow, ...rest } = previous
    next[at] = { ...rest, ...entry }
  }
  return next
}

/**
 * Land the facts a candidate disclosed on the entry its id names: a capacity
 * the endpoint reported (1M declaring itself as the row's checked
 * declaration, any other size a plain capacity), and the input modalities on
 * the pi-ai profile's own field — `input`, not the wire-neutral
 * `inputModalities` — because that is the key pi-ai reads. Shared by the
 * dialog's adoption and each row's pick menu, so both write the same entry.
 * @param models - the mapping being written; mutated in place.
 * @param candidate - the fetched candidate whose facts land.
 */
function applyCandidateFacts(models: ModelDraft[], candidate: DiscoveredModelView): void {
  if (candidate.contextWindow === undefined && candidate.maxTokens === undefined
    && candidate.inputModalities === undefined) return
  const entry = models.find(model => textOf(model, 'id') === candidate.id)
  if (entry === undefined) return
  if (candidate.contextWindow !== undefined) entry.contextWindow = candidate.contextWindow
  if (candidate.maxTokens !== undefined) entry.maxTokens = candidate.maxTokens
  if (candidate.inputModalities !== undefined) entry.input = [...candidate.inputModalities]
}

/**
 * Adopt picked candidates into the mapping, filling rows in display order —
 * Sonnet first, the fallback last — and skipping a candidate whose id is
 * already served. The candidate's own display name rides along into the row
 * it fills, and the capacities the endpoint disclosed land with it; the role
 * rides on the entry's `role` field, keeping the display name the picker
 * shows a separate fact.
 * @param models - the mapping as currently drafted.
 * @param candidates - the candidates the user picked, in listing order.
 * @returns the next drafted array.
 */
export function adoptIntoMapping(
  models: readonly ModelDraft[],
  candidates: readonly DiscoveredModelView[],
): ModelDraft[] {
  let next = models.map(model => ({ ...model }))
  const taken = new Set(next.map(model => textOf(model, 'id')).filter(id => id.length > 0))
  for (const candidate of candidates) {
    if (taken.has(candidate.id)) continue
    const role = MODEL_ROLES.find(name => entryFor(next, name) === undefined)
    // All five roles are taken, so the fallback's bare entry is the one slot left.
    if (role === undefined && entryFor(next, 'fallback') !== undefined) continue
    const name = candidate.name === undefined || candidate.name.length === 0 ? '' : candidate.name
    next = writeRow(next, role ?? 'fallback', candidate.id, name, false)
    applyCandidateFacts(next, candidate)
    taken.add(candidate.id)
  }
  return next
}

/**
 * Fill one row from a fetched candidate its pick menu named: the id and the
 * display name the endpoint spells, the 1M declaration when the candidate's
 * own context window is 1M, and every disclosed capacity. A hand-picked row
 * is a deliberate fill, so an entry the row already held is replaced — the
 * same write typing the id by hand makes, minus the transcription.
 * @param models - the mapping as currently drafted.
 * @param key - the row being filled.
 * @param candidate - the fetched model the user picked.
 * @returns the next drafted array.
 */
export function pickIntoRow(
  models: readonly ModelDraft[],
  key: RowKey,
  candidate: DiscoveredModelView,
): ModelDraft[] {
  const next = writeRow(
    models,
    key,
    candidate.id,
    candidate.name ?? '',
    candidate.contextWindow === ONE_M_CONTEXT_WINDOW,
  )
  applyCandidateFacts(next, candidate)
  return next
}

/**
 * Fill an empty mapping with a preset's built-in models: each role takes the
 * first catalog model whose id names it (sonnet, opus, …), and the fallback
 * takes the first model no role consumed. The names and capacities are the
 * catalog's own facts, so a preset opens with the provider's real models
 * rather than an invented order.
 * @param models - the mapping as currently drafted; rows already filled stay.
 * @param candidates - the provider's built-in models, in catalog order.
 * @returns the next drafted array.
 */
export function prefillMapping(
  models: readonly ModelDraft[],
  candidates: readonly DiscoveredModelView[],
): ModelDraft[] {
  if (models.length > 0 || candidates.length === 0) return [...models]
  let next = models.map(model => ({ ...model }))
  const taken = new Set<string>()
  for (const role of MODEL_ROLES) {
    const hit = candidates.find(candidate =>
      !taken.has(candidate.id) && candidate.id.toLowerCase().includes(role.toLowerCase()))
    if (hit === undefined) continue
    taken.add(hit.id)
    next = writeRow(next, role, hit.id, hit.name ?? '', false)
  }
  const fallback = candidates.find(candidate => !taken.has(candidate.id))
  if (fallback !== undefined) {
    next = writeRow(next, 'fallback', fallback.id, '', false)
  }
  // The capacities the catalog disclosed ride along after the rows are
  // placed, so a 1M model shows its declaration checked and every other
  // capacity stays the fact the adapter itself reports.
  for (const candidate of candidates) {
    if (candidate.contextWindow === undefined && candidate.maxTokens === undefined
      && candidate.inputModalities === undefined) continue
    const entry = next.find(model => textOf(model, 'id') === candidate.id)
    if (entry === undefined) continue
    if (candidate.contextWindow !== undefined) entry.contextWindow = candidate.contextWindow
    if (candidate.maxTokens !== undefined) entry.maxTokens = candidate.maxTokens
    if (candidate.inputModalities !== undefined) entry.input = [...candidate.inputModalities]
  }
  return next
}

/**
 * How many mapping rows are still empty — the five roles plus the fallback,
 * less the filled ones. The 获取模型列表 dialog gates its adopt action on
 * this: with no empty row there is nothing an adoption could write.
 */
export function emptyMappingSlots(models: readonly ModelDraft[]): number {
  let slots = 0
  for (const role of MODEL_ROLES) {
    if (entryFor(models, role) === undefined) slots += 1
  }
  if (entryFor(models, 'fallback') === undefined) slots += 1
  return slots
}

/**
 * The row of any two sharing one model id whose entry is not the first with
 * that id. The adapter refuses a duplicate outright, so the mapping names the
 * row to change — the one just typed, not the one it repeats.
 * @param models - the drafted entries.
 * @param keys - the mapping row keys, in display order.
 * @returns the row keys whose entry another entry earlier in the array precedes.
 */
function duplicatedRows(models: readonly ModelDraft[], keys: readonly RowKey[]): ReadonlySet<string> {
  const firstIndexById = new Map<string, number>()
  models.forEach((model, index) => {
    const id = textOf(model, 'id')
    if (id.length > 0 && !firstIndexById.has(id)) firstIndexById.set(id, index)
  })
  const flagged = new Set<string>()
  for (const key of keys) {
    const entry = entryFor(models, key)
    if (entry === undefined) continue
    const first = firstIndexById.get(textOf(entry, 'id'))
    if (first !== undefined && models.indexOf(entry) > first) flagged.add(key)
  }
  return flagged
}

/**
 * One row's pick menu over the fetched pool: the chevron button in the
 * column before the 1M declaration, opening the endpoint's whole listing —
 * one click fills the row. The menu portals to the body because the mapping
 * itself sits inside a scrolling dialog.
 */
function RowPicker(props: {
  candidates: readonly DiscoveredModelView[]
  selectedId: string
  disabled: boolean
  label: string
  t: (key: keyof typeof en) => string
  onPick: (candidate: DiscoveredModelView) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const { t } = props
  // The id is the string a pick writes; the endpoint's own name for the model
  // rides beside it so the row it fills can be judged before it is picked.
  const items: MenuEntry[] = props.candidates.map(model => ({
    id: model.id,
    label: model.name !== undefined && model.name.length > 0 && model.name !== model.id
      ? `${model.id} — ${model.name}`
      : model.id,
  }))
  return (
    <Menu
      open={open}
      portal
      align="end"
      items={items}
      {...props.selectedId.length === 0 ? {} : { selectedId: props.selectedId }}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        const hit = props.candidates.find(model => model.id === id)
        if (hit !== undefined) props.onPick(hit)
        setOpen(false)
      }}
      anchor={(
        <button
          type="button"
          className={styles['rowPicker']}
          disabled={props.disabled}
          title={t('modelPickerLabel')}
          aria-label={`${props.label} — ${t('modelPickerLabel')}`}
          onClick={() => { setOpen(current => !current) }}
        >
          <IconChevronDownOutline14 size={14} />
        </button>
      )}
    />
  )
}

/**
 * Render the fixed model mapping.
 * @param props - the drafted rows, which layer owns them, and the two writes.
 * @returns the mapping editor.
 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, t, disabled } = props
  // The endpoint's own listing, once a fetch has returned one: the pool every
  // row's pick menu draws from. Empty before any fetch, so the pick column
  // renders nothing an unfetched provider would have to ignore.
  const fetchedPool = props.fetched ?? []
  const rows: readonly { key: RowKey; label: string }[] = [
    ...MODEL_ROLES.map(role => ({ key: role as RowKey, label: role })),
    { key: 'fallback', label: t('defaultFallbackModel') },
  ]

  /** Set one row's model id, keeping the other two facts the row edits. */
  const setId = (key: RowKey, value: string): void => {
    const entry = entryFor(models, key)
    onChange(writeRow(models, key, value.trim(), textOf(entry ?? {}, 'name'), declaresOneM(entry)))
  }

  /** Set one role row's display name. */
  const setName = (key: RowKey, value: string): void => {
    const entry = entryFor(models, key)
    if (entry === undefined) return
    onChange(writeRow(models, key, textOf(entry, 'id'), value, declaresOneM(entry)))
  }

  /** Toggle one row's 1M declaration. */
  const setOneM = (key: RowKey, value: boolean): void => {
    const entry = entryFor(models, key)
    if (entry === undefined) return
    onChange(writeRow(models, key, textOf(entry, 'id'), textOf(entry, 'name'), value))
  }

  // Two rows naming one id would be a duplicate the adapter refuses outright,
  // so the form names the later row and refuses the write.
  const duplicates = duplicatedRows(models, rows.map(row => row.key))

  return (
    <section className={styles['modelCatalog']} aria-label={t('modelMapping')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('modelMapping')}</span>
          {props.overridden === undefined
            ? null
            : (
              <span className={styles['modelCatalogMeta']}>
                {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
              </span>
            )}
        </div>
        {/* The fetch action rides the mapping's own header, at its right edge:
            the rows it fills are the thing the reply is for. It asks the
            endpoint the form currently shows, so it needs the same freedom a
            probe has — an edited-but-unsaved address, a key not yet stored. */}
        {props.onFetch === undefined ? null : (
          <div className={styles['modelListHeadActions']}>
            {props.overridden === true && props.onReset !== undefined
              ? (
                <button
                  type="button"
                  className={styles['linkButton']}
                  disabled={disabled}
                  onClick={props.onReset}
                >
                  {t('resetModels')}
                </button>
              )
              : null}
            <button
              type="button"
              className={styles['fetchButton']}
              disabled={disabled || props.fetchBlocked !== undefined}
              title={props.fetchBlocked === undefined ? undefined : t(props.fetchBlocked)}
              onClick={props.onFetch}
            >
              {t('fetchModels')}
            </button>
          </div>
        )}
      </div>
      <div className={styles['mappingList']}>
        <div className={styles['mappingHeaderRow']} aria-hidden="true">
          <span>{t('modelRoleLabel')}</span>
          <span>{t('modelName')}</span>
          <span>{t('requestModelLabel')}</span>
          <span />
          <span>{t('modelOneMHeader')}</span>
        </div>
        {MODEL_ROLES.map((role) => {
          const entry = entryFor(models, role)
          return (
            <div key={role} className={styles['mappingRow']}>
              <span className={styles['mappingRowLabel']}>{role}</span>
              {HIDDEN_ROLES.has(role)
                ? <span className={styles['mappingRowNote']}>{t('subagentHiddenName')}</span>
                : (
                  <input
                    className={styles['input']}
                    type="text"
                    value={entry === undefined ? '' : textOf(entry, 'name')}
                    placeholder={entry === undefined ? '' : textOf(entry, 'id')}
                    aria-label={`${role} — ${t('modelName')}`}
                    disabled={disabled}
                    onChange={(event) => { setName(role, event.target.value) }}
                  />
                )}
              <div className={styles['mappingRowField']}>
                <input
                  className={styles['input']}
                  type="text"
                  value={entry === undefined ? '' : textOf(entry, 'id')}
                  placeholder={t('modelId')}
                  aria-label={`${role} — ${t('requestModelLabel')}`}
                  disabled={disabled}
                  onChange={(event) => { setId(role, event.target.value) }}
                />
                {duplicates.has(role) ? <p className={styles['error']}>{t('modelIdDuplicate')}</p> : null}
              </div>
              {fetchedPool.length === 0 ? null : (
                <RowPicker
                  candidates={fetchedPool}
                  selectedId={entry === undefined ? '' : textOf(entry, 'id')}
                  disabled={disabled}
                  label={role}
                  t={t}
                  onPick={(candidate) => { onChange(pickIntoRow(models, role, candidate)) }}
                />
              )}
              {ONE_M_ROLES.has(role)
                ? (
                  <label className={styles['mappingRowCheck']}>
                    {/* The header names the column; the row keeps the checkbox
                        alone, so the track's width is the same in every row. */}
                    <input
                      type="checkbox"
                      checked={declaresOneM(entry)}
                      aria-label={`${role} — ${t('modelOneMHeader')}`}
                      disabled={disabled}
                      onChange={(event) => { setOneM(role, event.target.checked) }}
                    />
                  </label>
                )
                : <span className={styles['mappingRowNote']} aria-hidden="true">—</span>}
            </div>
          )
        })}
        {(() => {
          const entry = entryFor(models, 'fallback')
          return (
            <div className={`${styles['mappingRow']} ${styles['mappingRowFallback']}`}>
              <span className={styles['mappingRowLabel']}>{t('defaultFallbackModel')}</span>
              {/* The fallback is the model itself; the display-name column
                  stays empty so the row reads as its role siblings do. */}
              <span aria-hidden="true" />
              <div className={styles['mappingRowField']}>
                <input
                  className={styles['input']}
                  type="text"
                  value={entry === undefined ? '' : textOf(entry, 'id')}
                  placeholder={t('modelId')}
                  aria-label={`${t('defaultFallbackModel')} — ${t('requestModelLabel')}`}
                  disabled={disabled}
                  onChange={(event) => { setId('fallback', event.target.value) }}
                />
                {duplicates.has('fallback') ? <p className={styles['error']}>{t('modelIdDuplicate')}</p> : null}
              </div>
              {fetchedPool.length === 0 ? null : (
                <RowPicker
                  candidates={fetchedPool}
                  selectedId={entry === undefined ? '' : textOf(entry, 'id')}
                  disabled={disabled}
                  label={t('defaultFallbackModel')}
                  t={t}
                  onPick={(candidate) => { onChange(pickIntoRow(models, 'fallback', candidate)) }}
                />
              )}
              <label className={styles['mappingRowCheck']}>
                <input
                  type="checkbox"
                  checked={declaresOneM(entry)}
                  aria-label={`${t('defaultFallbackModel')} — ${t('modelOneMHeader')}`}
                  disabled={disabled}
                  onChange={(event) => { setOneM('fallback', event.target.checked) }}
                />
              </label>
            </div>
          )
        })()}
      </div>
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
    </section>
  )
}
