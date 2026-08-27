/**
 * Models settings section: a stacked list of full-width provider cards joined
 * from the configurable directory, settings namespaces, credential states,
 * the host model catalog, and the composed default-model selection — the
 * cc-switch posture. Cards expose only confirmed API-key state through
 * accessible solid configured or missing dots; each usable provider carries a
 * one-click “Set as default” command — a plain click when the catalog offers
 * one model, a model menu when it offers several — while the default card's
 * command is the disabled “In use” state plus the brand border. Every
 * configured card carries the always-visible icon actions cc-switch ships —
 * details (endpoint, protocol, credential reference, model list), edit,
 * duplicate for a dict-keyed route, and confirmed removal — and a dormant
 * directory provider renders as a not-configured card whose primary Enable
 * command opens the same editor the add flow uses. A whole-section provider
 * without a configured key renders as its open setup card instead of a row,
 * but only in the first-run posture — no provider on the page can serve
 * requests yet — and only until the user closes that card. Editing, adding,
 * declaring, and removing a provider each render in their own modal, so
 * closing one never discards a draft in another. Every mutation writes
 * through the wire, while a provider removal first requires confirmation;
 * the page re-renders from pushed invalidations or the post-apply reload.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconCheckOutline16, IconChevronDownOutline14, IconCopyOutline16, IconEditOutline16,
  IconPlusOutline16, IconTrashOutline16, Menu, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { DEFAULT_MODEL_NS, deriveKeyRef, messageOf, protocolChoices, providerUsable } from './store.ts'
import type { ModelsSettingsStore, ProviderRow } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor, type ProviderEditorProps } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: ModelsSettingsStore['store']
  }
  /** Wire faces the editor writes through. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelsSectionProps = Partial<InjectFace<ModelsSectionInjected>>

type ModelsSectionFace = InjectFace<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
}

/**
 * The one modal the page has open, if any: editing or adding a provider
 * profile, picking what to add, or declaring a custom route. One state owns
 * them all so opening one always closes another, and no draft can sit behind
 * a second dialog. The default-model switch is not a dialog — it is the
 * card's one-click command, with a model menu when the catalog offers several.
 */
type DialogState =
  | { kind: 'edit'; target: EditorTarget }
  | { kind: 'add'; target: EditorTarget }
  | { kind: 'pick' }
  | { kind: 'declare' }

/** Values that vary around the shared provider-editor rendering. */
interface ProviderEditorRenderProps extends Pick<
  ProviderEditorProps,
  'namespace' | 'schema' | 'api' | 't' | 'readOnly' | 'onClose'
> {
  target: EditorTarget
}

/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditor({ target, ...props }: ProviderEditorRenderProps): ReactNode {
  return (
    <ProviderEditor
      provider={target.provider}
      displayName={target.displayName}
      settingsPath={target.settingsPath}
      {...target.declared === true ? { declared: true } : {}}
      {...props}
    />
  )
}

/** Avatar palette classes, cycled by the route-id hash in {@link avatarClassOf}. */
const AVATAR_CLASSES = ['avatarBlue', 'avatarDeepseek', 'avatarGreen', 'avatarRed', 'avatarAmber'] as const

/**
 * Deterministic avatar class for a provider route. The route set is open —
 * catalog entries and hand-declared routes alike — so no logo assets exist to
 * ship; the palette hash gives each card a stable identity color instead, the
 * same fallback shape preset-less providers get in cc-switch.
 * @param provider - the provider route id.
 * @returns the palette class name for its avatar.
 */
function avatarClassOf(provider: string): string {
  let hash = 0
  for (const char of provider) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return styles[AVATAR_CLASSES[hash % AVATAR_CLASSES.length] as keyof typeof styles] as string
}

/**
 * The provider's letter avatar: the display name's first character on the
 * route's palette color. Purely decorative — the name sits right beside it.
 * @param props - the route id and the display name to take the initial from.
 * @returns the avatar element.
 */
function ProviderAvatar(props: { provider: string; displayName: string }): ReactNode {
  const first = props.displayName.trim().codePointAt(0)
  const initial = first === undefined ? '?' : String.fromCodePoint(first).toUpperCase()
  return (
    <span className={`${styles['avatar']} ${avatarClassOf(props.provider)}`} aria-hidden="true">
      {initial}
    </span>
  )
}

/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(
  api: Pick<IApiClient, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; settingsPath: readonly string[]; credentialRef?: string },
): Promise<string | undefined> {
  try {
    if (target.credentialRef !== undefined) {
      const credential = await api.credentials.unset({ ref: target.credentialRef })
      if (!credential.result.ok) return credential.result.error.message
    }
    const response = await api.settings.mutate({
      ns: target.settingsNs,
      ops: [{ op: 'unset', path: [...target.settingsPath] }],
    })
    if (!response.result.ok) return response.result.error.message
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able
    // to retry the idempotent operation instead of the row silently staying.
    return messageOf(error)
  }
  await controller.load()
  return undefined
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Absent is not "shipped": an adapter that answers nothing leaves the
    // route-level fields only a declared route owns off the card, exactly as
    // it leaves the custom tag off the row.
    ...row.entry.declared === true ? { declared: true } : {},
  }
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/** Replace the one model placeholder in localized default-model copy. */
export function modelCopy(template: string, model: string): string {
  return template.replace('{model}', () => model)
}

/** Read-only endpoint facts a resolved profile may name, for the details view. */
export function profileFactsOf(profile: unknown): { baseURL?: string; api?: string } {
  if (typeof profile !== 'object' || profile === null) return {}
  const record = profile as { baseURL?: unknown; api?: unknown }
  return {
    ...typeof record.baseURL === 'string' && record.baseURL.length > 0 ? { baseURL: record.baseURL } : {},
    ...typeof record.api === 'string' && record.api.length > 0 ? { api: record.api } : {},
  }
}

/**
 * The dict address a duplicate writes to, when the route has one: a profile
 * under a `providers` dict is a value that can be copied to a sibling key,
 * while a whole-section route (an empty path) and any other layout has no
 * sibling to receive the copy.
 * @param row - the joined provider row.
 * @returns the `[root, key]` settings path, or undefined when the route is
 * not a dict-keyed provider.
 */
export function duplicablePathOf(row: ProviderRow): readonly [string, string] | undefined {
  const [root, key] = row.entry.settingsPath
  return root === 'providers' && typeof key === 'string' ? [root, key] : undefined
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): ReactNode {
  const { controller, useSnapshot, api, schema, t } = props
  if (
    controller === undefined || useSnapshot === undefined || api === undefined
    || schema === undefined || t === undefined
  ) return null
  return <Loaded injected={{ controller, useSnapshot, api, schema, t }} />
}

function Loaded({ injected }: { injected: ModelsSectionFace }): ReactNode {
  const { controller, api, schema, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [dialog, setDialog] = useState<DialogState | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [savedTarget, setSavedTarget] = useState<ProviderIdentity | undefined>(undefined)
  const [savedDefault, setSavedDefault] = useState<string | undefined>(undefined)
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())
  /** The provider route a one-click default switch is writing, and its failure text. */
  const [switching, setSwitching] = useState<string | undefined>(undefined)
  const [switchFailure, setSwitchFailure] = useState<string | undefined>(undefined)
  /** The provider route whose model menu is open. */
  const [modelMenuFor, setModelMenuFor] = useState<string | undefined>(undefined)
  /** Provider routes whose details panel is expanded. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  /** The provider route a duplicate is writing, and its failure text. */
  const [duplicating, setDuplicating] = useState<string | undefined>(undefined)
  const [duplicateFailure, setDuplicateFailure] = useState<string | undefined>(undefined)

  const announceSaved = (target: ProviderIdentity): void => {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    setSavedDefault(undefined)
    void controller.load().then(() => { setSavedTarget(target) })
  }

  const closeEditor = (changed: boolean, target: ProviderIdentity): void => {
    setDialog(undefined)
    if (changed) announceSaved(target)
  }

  /**
   * Close a setup card, which owns none of the state above: the dialogs each
   * own theirs, so clearing those here would discard a draft the user opened
   * beside this card. Dismissal is this card's own — the provider falls back
   * to an ordinary card for the rest of the session, and reopens through Edit.
   */
  const closeSetup = (changed: boolean, target: ProviderIdentity): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) announceSaved(target)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(undefined)
    setDeleteFailure(undefined)
  }

  /**
   * Write a default-model selection from a card's one-click command. Unlike
   * the dialogs, there is no surface to inline a failure into, so the outcome
   * lands in the page's status region: the saved-model notice on success, an
   * alert with the wire's message on failure.
   * @param selection - the provider route and the model to make default.
   */
  const commitDefault = (selection: { provider: string; displayName: string; model: string }): void => {
    if (switching !== undefined) return
    setModelMenuFor(undefined)
    setSwitching(selection.provider)
    setSwitchFailure(undefined)
    setSavedTarget(undefined)
    setSavedDefault(undefined)
    void controller.setDefaultModel({ provider: selection.provider, model: selection.model })
      .then((failure) => {
        if (failure !== undefined) {
          setSwitchFailure(failure)
          return
        }
        setSavedDefault(selection.model)
      })
      .finally(() => { setSwitching(undefined) })
  }

  const confirmDelete = (): void => {
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void removeProviderProfile(api, controller, deleteTarget)
      .then((failure) => {
        if (failure !== undefined) {
          setDeleteFailure(failure)
          return
        }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  /**
   * Copy one dict-keyed provider profile to a fresh sibling key, cc-switch's
   * duplicate. The copy shares the source's credential reference: a stored
   * key is write-only, so the page cannot re-store it under a new reference —
   * both routes resolve the same reference until one is edited. Like the
   * default switch, there is no dialog to inline a failure into, so the
   * outcome lands in the page's status region.
   * @param row - the configured provider row to copy.
   */
  const commitDuplicate = (row: ProviderRow): void => {
    if (duplicating !== undefined) return
    const path = duplicablePathOf(row)
    const namespace = state.namespaces.get(row.entry.settingsNs)
    if (path === undefined || namespace === undefined || row.profile === undefined) return
    const taken = new Set(state.rows.map(candidate => candidate.entry.provider))
    let id = `${row.entry.provider}-copy`
    for (let n = 2; taken.has(id); n += 1) id = `${row.entry.provider}-copy-${n}`
    // The profile comes from a mirror snapshot; clone it so the write carries
    // a plain value no other render path aliases.
    const value = JSON.parse(JSON.stringify(row.profile)) as unknown
    setDuplicating(row.entry.provider)
    setDuplicateFailure(undefined)
    setSavedTarget(undefined)
    setSavedDefault(undefined)
    void api.settings.mutate({
      ns: row.entry.settingsNs,
      ops: [{ op: 'set', path: [path[0], id], value }],
      expectedRevision: namespace.revision,
    })
      .then((response) => {
        if (!response.result.ok) {
          setDuplicateFailure(response.result.error.message)
          return
        }
        const record = value as { displayName?: unknown }
        announceSaved({
          provider: id,
          displayName: typeof record.displayName === 'string' && record.displayName.length > 0
            ? record.displayName
            : id,
        })
      })
      .catch((error: unknown) => { setDuplicateFailure(messageOf(error)) })
      .finally(() => { setDuplicating(undefined) })
  }

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  // The saved provider as the directory currently names it. The route id is
  // what the apply cannot change, so it is what the notice is keyed by; a card
  // the same apply removed keeps the captured identity, since nothing newer
  // exists to name it with.
  const savedRow = savedTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

  // One fact decides both first-run postures on this page and the onboarding
  // step: whether the user already has a provider to talk to.
  const anyUsable = state.rows.some(providerUsable)
  const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')
  // Hand-declared routes live in the pi-ai namespace, which is also the only
  // one whose schema names the protocols one may speak; without it mounted
  // there is nothing to declare and the entry point stays disabled.
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'), schema)
  // The default-model write needs the namespace mounted; without it the page
  // offers no Set-as-default action rather than a button that can only fail.
  const defaultSupported = state.namespaces.has(DEFAULT_MODEL_NS)
  const defaultProvider = state.defaultSelection?.provider

  const editorDialog = dialog !== undefined && (dialog.kind === 'edit' || dialog.kind === 'add')
    ? dialog
    : undefined
  const editorTarget = editorDialog?.target
  const editorNamespace = editorTarget === undefined ? undefined : state.namespaces.get(editorTarget.settingsNs)

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      {!state.writable && state.status === 'ready' ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      {savedIdentity === undefined && savedDefault === undefined
        ? null
        : (
          <p className={styles['savedNotice']} role="status" aria-live="polite">
            {savedIdentity === undefined
              ? modelCopy(t('savedDefault'), savedDefault ?? '')
              : providerCopy(t('savedProvider'), savedIdentity)}
          </p>
        )}
      <ul className={styles['list']}>
        {state.rows.map((row) => {
          // A directory entry the page cannot address is a composition fact,
          // not something this page can offer an action for.
          if (!row.configured && row.entry.settingsNs === '') return null
          const target = targetOf(row)
          const namespace = state.namespaces.get(target.settingsNs)
          if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
            // First-run posture: the provider exists but has no key — the
            // setup card IS its presence on the page, until the user closes it.
            /* v8 ignore next -- the join marks a setup row configured only when its namespace resolved */
            if (namespace === undefined) return null
            return (
              <li key={row.entry.provider} className={styles['setupCard']}>
                {renderProviderEditor({
                  target,
                  namespace,
                  schema,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeSetup(changed, target) },
                })}
              </li>
            )
          }
          if (!row.configured) {
            // Dormant directory entry: a preset this deployment can adopt. The
            // card's primary Enable command — cc-switch's additive Add — opens
            // the same editor the add flow uses, prefilled by the provider it
            // stands for.
            return (
              <li key={row.entry.provider} className={`${styles['card']} ${styles['cardDormant']}`}>
                <div className={styles['cardRow']}>
                  <ProviderAvatar provider={row.entry.provider} displayName={row.entry.displayName} />
                  <div className={styles['cardBody']}>
                    <span className={styles['rowIdentity']}>
                      <span className={styles['rowName']}>{row.entry.displayName}</span>
                      <span className={styles['rowTag']}>{t('notConfigured')}</span>
                    </span>
                  </div>
                  <div className={styles['rowActions']}>
                    <button
                      type="button"
                      className={`${styles['primaryButton']} ${styles['cardButton']}`}
                      aria-label={providerCopy(t('addProvider'), target)}
                      disabled={!state.writable}
                      onClick={() => {
                        setSavedTarget(undefined)
                        setSavedDefault(undefined)
                        setDialog({ kind: 'add', target })
                      }}
                    >
                      <IconPlusOutline16 size={14} />
                      {t('enable')}
                    </button>
                  </div>
                </div>
              </li>
            )
          }
          /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
          if (namespace === undefined) return null
          const isDefault = defaultProvider === row.entry.provider
          const group = state.catalog.find(candidate => candidate.id === row.entry.provider)
          const credentialConfigured = row.credential?.configured === true
          const credentialMissing = !credentialConfigured
            && row.apiKeyEnv !== undefined
            && row.credential?.configured === false
          // The one-click switch — the cc-switch posture: the command is the
          // row's primary action. One model commits on click; several open a
          // model menu; none leave the command disabled with the reason, since
          // a free-typed id is a write the host would refuse to resolve.
          const models = group?.models ?? []
          const canSwitch = defaultSupported && !isDefault && providerUsable(row) && state.writable
          const busy = switching === row.entry.provider
          const menuOpen = modelMenuFor === row.entry.provider
          const modelItems: readonly MenuEntry[] = models.map(model => ({
            id: model.id,
            label: model.name.trim() === '' ? model.id : model.name,
          }))
          const facts = profileFactsOf(row.profile)
          const open = expanded.has(row.entry.provider)
          return (
            <li
              className={isDefault ? `${styles['card']} ${styles['cardDefault']}` : styles['card']}
              key={row.entry.provider}
            >
              <div className={styles['cardRow']}>
                <ProviderAvatar provider={row.entry.provider} displayName={row.entry.displayName} />
                <div className={styles['cardBody']}>
                  <span className={styles['rowIdentity']}>
                    <span className={styles['rowName']}>{row.entry.displayName}</span>
                    {/* Only the adapter can tell a hand-declared route from a
                        shipped one it also has a stored profile for, so the tag
                        follows its answer and stays off when it gives none. */}
                    {row.entry.declared === true
                      ? <span className={styles['rowTag']}>{t('customTag')}</span>
                      : null}
                    {credentialConfigured
                      ? (
                        <span
                          className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`}
                          role="img"
                          aria-label={t('credentialConfigured')}
                          title={t('credentialConfigured')}
                        />
                      )
                      : credentialMissing
                        ? (
                          <span
                            className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`}
                            role="img"
                            aria-label={t('credentialMissing')}
                            title={t('credentialMissing')}
                          />
                        )
                        : null}
                  </span>
                  <p className={styles['cardSummary']}>
                    {isDefault
                      ? modelCopy(t('inUseTitle'), state.defaultSelection?.model ?? '')
                      : group !== undefined
                        ? modelCopy(t('modelsCount'), String(group.models.length))
                        : ''}
                  </p>
                </div>
                {isDefault
                  ? (
                    <button
                      type="button"
                      className={`${styles['secondaryButton']} ${styles['cardButton']}`}
                      disabled
                      title={modelCopy(t('inUseTitle'), state.defaultSelection?.model ?? '')}
                    >
                      <IconCheckOutline16 size={14} />
                      {t('inUse')}
                    </button>
                  )
                  : !canSwitch
                    ? null
                    : busy
                      ? (
                        <button
                          type="button"
                          className={`${styles['primaryButton']} ${styles['cardButton']}`}
                          disabled
                        >
                          {t('defaultSetting')}
                        </button>
                      )
                      : models.length === 0
                        ? (
                          <button
                            type="button"
                            className={`${styles['primaryButton']} ${styles['cardButton']}`}
                            aria-label={providerCopy(t('setDefaultProvider'), target)}
                            disabled
                            title={t('defaultNoModels')}
                          >
                            {t('setDefault')}
                          </button>
                        )
                        : models.length === 1
                          ? (
                            <button
                              type="button"
                              className={`${styles['primaryButton']} ${styles['cardButton']}`}
                              aria-label={providerCopy(t('setDefaultProvider'), target)}
                              onClick={() => {
                                const model = models[0]
                                if (model === undefined) return
                                commitDefault({
                                  provider: row.entry.provider,
                                  displayName: row.entry.displayName,
                                  model: model.id,
                                })
                              }}
                            >
                              {t('setDefault')}
                            </button>
                          )
                          : (
                            <Menu
                              open={menuOpen}
                              items={modelItems}
                              align="end"
                              onClose={() => { setModelMenuFor(undefined) }}
                              onSelect={(modelId) => {
                                commitDefault({
                                  provider: row.entry.provider,
                                  displayName: row.entry.displayName,
                                  model: modelId,
                                })
                              }}
                              anchor={(
                                <button
                                  type="button"
                                  className={`${styles['primaryButton']} ${styles['cardButton']}`}
                                  aria-label={providerCopy(t('setDefaultProvider'), target)}
                                  aria-haspopup="menu"
                                  aria-expanded={menuOpen}
                                  onClick={() => { setModelMenuFor(menuOpen ? undefined : row.entry.provider) }}
                                >
                                  {t('setDefault')}
                                  <IconChevronDownOutline14 size={14} />
                                </button>
                              )}
                            />
                          )}
                <div className={styles['iconActions']}>
                  <button
                    type="button"
                    className={styles['iconButton']}
                    aria-label={providerCopy(t('detailsProvider'), target)}
                    title={t('details')}
                    aria-expanded={open}
                    onClick={() => {
                      setExpanded((previous) => {
                        const next = new Set(previous)
                        if (previous.has(row.entry.provider)) next.delete(row.entry.provider)
                        else next.add(row.entry.provider)
                        return next
                      })
                    }}
                  >
                    <IconChevronDownOutline14
                      size={14}
                      className={open ? styles['chevronOpen'] : undefined}
                    />
                  </button>
                  <button
                    type="button"
                    className={styles['iconButton']}
                    aria-label={providerCopy(t('editProvider'), target)}
                    title={t('edit')}
                    onClick={() => {
                      setSavedTarget(undefined)
                      setSavedDefault(undefined)
                      setDialog({ kind: 'edit', target })
                    }}
                  >
                    <IconEditOutline16 size={16} />
                  </button>
                  {duplicablePathOf(row) !== undefined
                    ? (
                      <button
                        type="button"
                        className={styles['iconButton']}
                        aria-label={providerCopy(t('duplicateProvider'), target)}
                        title={t('duplicate')}
                        disabled={!state.writable || duplicating !== undefined}
                        onClick={() => { commitDuplicate(row) }}
                      >
                        <IconCopyOutline16 size={16} />
                      </button>
                    )
                    : null}
                  {row.removable
                    ? (
                      <button
                        type="button"
                        className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
                        aria-label={providerCopy(t('removeProvider'), target)}
                        title={t('remove')}
                        disabled={!state.writable}
                        onClick={() => {
                          setSavedTarget(undefined)
                          setSavedDefault(undefined)
                          setDeleteFailure(undefined)
                          setDeleteTarget(target)
                        }}
                      >
                        <IconTrashOutline16 size={16} />
                      </button>
                    )
                    : null}
                </div>
              </div>
              {open
                ? (
                  <div className={styles['cardDetails']}>
                    <dl className={styles['detailGrid']}>
                      <dt>{t('endpoint')}</dt>
                      <dd>{facts.baseURL ?? t('notConfigured')}</dd>
                      {facts.api === undefined
                        ? null
                        : (
                          <>
                            <dt>{t('protocol')}</dt>
                            <dd>{facts.api}</dd>
                          </>
                        )}
                      <dt>{t('credentialRef')}</dt>
                      <dd>{row.apiKeyEnv ?? t('noCredentialRef')}</dd>
                    </dl>
                    <div className={styles['detailModels']}>
                      <span className={styles['detailModelsLabel']}>{t('modelsLabel')}</span>
                      {models.length === 0
                        ? <span>{t('defaultNoModels')}</span>
                        : (
                          <ul className={styles['modelList']}>
                            {models.map(model => (
                              <li key={model.id} className={styles['modelChip']}>
                                {model.name.trim() === '' ? model.id : model.name}
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  </div>
                )
                : null}
            </li>
          )
        })}
        <li className={styles['addTile']}>
          <button
            type="button"
            className={styles['addTileButton']}
            disabled={!state.writable || (addable.length === 0 && protocols.length === 0)}
            onClick={() => {
              setSavedTarget(undefined)
              setSavedDefault(undefined)
              setDialog({ kind: 'pick' })
            }}
          >
            <IconPlusOutline16 size={14} />
            {t('add')}
          </button>
        </li>
      </ul>
      <Modal
        open={dialog?.kind === 'pick'}
        onClose={() => { setDialog(undefined) }}
        title={t('addTitle')}
        closeLabel={t('close')}
        description={t('addPickHint')}
      >
        {addable.length === 0
          ? null
          : (
            <ul className={styles['pickList']}>
              {addable.map((row) => {
                const target = targetOf(row)
                return (
                  <li key={row.entry.provider}>
                    <button
                      type="button"
                      className={styles['pickRow']}
                      onClick={() => { setDialog({ kind: 'add', target }) }}
                    >
                      <ProviderAvatar provider={row.entry.provider} displayName={row.entry.displayName} />
                      {row.entry.displayName}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        <button
          type="button"
          className={styles['addButton']}
          disabled={protocols.length === 0}
          onClick={() => { setDialog({ kind: 'declare' }) }}
        >
          <IconPlusOutline16 size={14} />
          {t('customAdd')}
        </button>
      </Modal>
      {editorTarget !== undefined && editorNamespace !== undefined
        ? (
          <Modal
            open
            onClose={() => { closeEditor(false, editorTarget) }}
            title={editorDialog?.kind === 'add'
              ? t('addTitle')
              : providerTargetLabel(editorTarget)}
            closeLabel={t('close')}
            contentClassName={styles['editorDialogContent'] as string}
          >
            {editorDialog?.kind === 'add'
              ? (
                <div className={styles['field']}>
                  <span className={styles['fieldLabel']}>{t('provider')}</span>
                  <select
                    className={`${styles['input']} ${styles['selectInput']}`}
                    value={editorTarget.provider}
                    aria-label={t('provider')}
                    onChange={(event) => {
                      const row = addable.find(candidate => candidate.entry.provider === event.target.value)
                      /* v8 ignore next -- the select only lists addable rows */
                      if (row === undefined) return
                      setDialog({ kind: 'add', target: targetOf(row) })
                    }}
                  >
                    {addable.map(row => (
                      <option key={row.entry.provider} value={row.entry.provider}>{row.entry.displayName}</option>
                    ))}
                  </select>
                </div>
              )
              : null}
            <ProviderEditor
              key={editorTarget.provider}
              provider={editorTarget.provider}
              displayName={editorTarget.displayName}
              hideTitle
              namespace={editorNamespace}
              schema={schema}
              settingsPath={editorTarget.settingsPath}
              {...editorTarget.declared === true ? { declared: true } : {}}
              api={api}
              t={t}
              readOnly={!state.writable}
              onClose={(changed) => { closeEditor(changed, editorTarget) }}
            />
          </Modal>
        )
        : null}
      {dialog?.kind === 'declare'
        ? (
          <Modal
            open
            onClose={() => {
              // The card reports whether its profile write landed, so a
              // half-created provider still reloads the page behind the close.
              setDialog(undefined)
              void controller.load()
            }}
            title={t('customTitle')}
            closeLabel={t('close')}
            contentClassName={styles['editorDialogContent'] as string}
          >
            <CustomProviderCard
              taken={state.rows.map(row => row.entry.provider)}
              protocols={protocols}
              /* v8 ignore next -- the card only opens from a button disabled without this namespace */
              revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
              api={api}
              t={t}
              readOnly={!state.writable}
              onClose={(changed) => {
                setDialog(undefined)
                if (changed) void controller.load()
              }}
            />
          </Modal>
        )
        : null}
      {switchFailure === undefined
        ? null
        : (
          <p className={styles['error']} role="alert">
            {`${t('defaultFailed')}: ${switchFailure}`}
          </p>
        )
      }
      {duplicateFailure === undefined
        ? null
        : (
          <p className={styles['error']} role="alert">
            {`${t('duplicateFailed')}: ${duplicateFailure}`}
          </p>
        )
      }
      <Modal
        open={deleteTarget !== undefined}
        onClose={closeDelete}
        title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === undefined
          ? ''
          : providerCopy(
            deleteTarget.credentialRef === undefined
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget,
          )}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles['deleteConfirm']}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined
                ? ''
                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles['error']}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}
