/**
 * The card that declares a provider pi-ai does not ship — an OpenAI-compatible
 * gateway, a self-hosted server, or a provider newer than the installed
 * catalog. It is the add dialog's default form: picking the custom cell (or
 * opening the dialog, which starts there) puts this card under the grid.
 *
 * This is a create, not an edit, which is why it is its own card rather than
 * the provider editor with extra fields: the route id is being *chosen* here,
 * and the settings address does not exist until it is. One `settings.mutate`
 * sets the whole profile at `providers.<route>`; the key travels separately
 * through `credentials.set` under the reference the profile records, exactly as
 * an existing provider's key does.
 *
 * The form leads with the route id, display name, endpoint, and key — the
 * cc-switch custom-provider posture. The 高级选项 fold carries the rest: the
 * wire protocol, the credential reference, the User-Agent header, and the
 * model mapping. The three fields a hand-declared route cannot default —
 * endpoint, protocol, and at least one model — are required here rather than
 * at load, so the failure names the field while the user is still looking at
 * it (the fold is where the protocol and the models live, and its blocked
 * hint names the gate).
 *
 * There is deliberately no reasoning-effort control, here or on the editor
 * card: effort is a per-MODEL capability, and the models under one provider
 * disagree about it, so a provider-scoped control can only be set to a value
 * some of them reject. The composer's model picker offers each model its own
 * levels instead.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { IconApiOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { validateDeepSeekModels } from './DeepSeekModelsEditor.tsx'
import { IconField } from './IconPickerDialog.tsx'
import { adoptIntoMapping, ModelListEditor } from './ModelListEditor.tsx'
import { ManageTestDialog, useModelFetchOutcome } from './ManageTestDialog.tsx'
import type { ModelDraft } from './ModelListEditor.tsx'
import { deriveKeyRef, messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The settings namespace a hand-declared provider is written into. */
const NS = 'llm-pi-ai'

/**
 * A route id usable as a settings key AND as the stem of a credential name.
 * The leading letter is the second half of that: `deriveKeyRef` uppercases the
 * id and replaces every non-alphanumeric run with `_`, and a credential
 * reference is a POSIX shell identifier, which cannot start with a digit. A
 * digit-leading id passes every check this card makes and then fails at the
 * credential seam with a raw regular expression the user cannot act on.
 */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Props of {@link CustomProviderCard}. */
export interface CustomProviderCardProps {
  /** Route ids already declared, so the card refuses to shadow one. */
  taken: readonly string[]
  /** Wire protocols the adapter can serve, in the order it reports them. */
  protocols: readonly string[]
  /**
   * Revision of the `llm-pi-ai` user section this card opened at, sent with
   * the create so a route another tab declared meanwhile is a refusal rather
   * than a silent overwrite of its whole profile.
   */
  revision: number
  /** Wire faces for the write and for interrogating the endpoint. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /**
   * Render without the module fill — the pick dialog embeds this card in
   * the same scroll container as the preset flow above it, and two stacked
   * filled surfaces would read as two cards.
   */
  embedded?: boolean
  /**
   * Host the cancel/create row in this element instead of at the card's foot.
   * A dialog that embeds the card passes its footer region so the actions
   * stay pinned while the form scrolls; absent, the row renders in place.
   */
  footerSlot?: HTMLElement | undefined
  /** Close the card; `changed` reports whether a provider was created. */
  onClose: (changed: boolean) => void
}

/**
 * Render the custom-provider creation card.
 * @param props - existing routes, protocol choices, wire faces, and copy.
 * @returns the creation card.
 */
export function CustomProviderCard(props: CustomProviderCardProps): ReactNode {
  const { taken, protocols, api, t } = props
  // Captured at mount, like the editor's: the write must be judged against the
  // section this card was drafted over, not whatever it grew into meanwhile.
  const [openedAt] = useState(() => props.revision)
  const [icon, setIcon] = useState<string | undefined>(undefined)
  const [route, setRoute] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [protocol, setProtocol] = useState(protocols[0] ?? '')
  const [authRef, setAuthRef] = useState('')
  const [userAgent, setUserAgent] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [models, setModels] = useState<readonly ModelDraft[]>([])
  // Whether the base-URL field's 管理与测试 dialog is open. It mounts per open,
  // so opening it again re-asks the endpoint with whatever the form now shows.
  const [manageOpen, setManageOpen] = useState(false)
  // The endpoint's own listing, once an interrogation returns one: the pool
  // the mapping rows' pick menus list, plus the banner reporting the count.
  const { fetched, onFetched, toast } = useModelFetchOutcome(t)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /**
   * The profile write landed. Only the key write can still be outstanding, so
   * the fields that describe the provider are settled and the retry path is
   * the credential alone.
   */
  const [committed, setCommitted] = useState(false)
  const disabled = props.readOnly || busy
  /** Everything but the key stops being editable once the provider exists. */
  const profileDisabled = disabled || committed

  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route)
  const routeTaken = taken.includes(route)
  // Rows are checked by the same per-row validator the editor cards use, so a
  // bad row is named by its position here too. Capacities have route-level
  // fallbacks; what a route cannot default is at least one model.
  const modelFailure = validateDeepSeekModels(models)
  const keyFailure = apiKeyFailure(keyDraft)
  /** Why the 管理与测试 interrogation is unavailable, when it is. */
  const manageBlocked = baseURL.length === 0
    ? 'fetchNeedsBaseUrl' as const
    : keyFailure === 'keyBlank' ? 'keyBlankNew' as const : keyFailure
  // The typed key with paste whitespace removed. A blank field yields an empty
  // string, which the create path reads as "no key supplied" — a route may
  // legitimately authenticate through the provider's own ambient discovery.
  const keyValue = keyDraft.trim()
  const ready = route.length > 0 && !routeInvalid && !routeTaken
    && baseURL.length > 0 && models.length > 0 && modelFailure === undefined
    && keyFailure === undefined
  // The one blocked gate worth a line under the form. A satisfied card says
  // nothing at all rather than printing an empty paragraph.
  const hint = failure !== undefined || ready
    // The key field prints its own failure directly beneath itself, so a card
    // blocked only by the key stays silent here rather than answering with the
    // next unmet gate — which is satisfied, and reads as a second, false fault.
    || keyFailure !== undefined
    // Same for the route id, and it must be tested rather than assumed: the
    // fallback arm below reads "no models yet", so an unmet route gate would
    // fall through to it and contradict the filled-in list right above.
    || route.length === 0 || routeInvalid || routeTaken
    ? undefined
    : baseURL.length === 0
      ? t('customNeedsBaseUrl')
      : modelFailure !== undefined
        ? `${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`
        : t('customNeedsModels')

  /** Perform the create, returning a failure message or undefined. */
  const createOnce = async (): Promise<string | undefined> => {
    // A named reference wins over the derived one — the one knob a shared or
    // pre-provisioned credential needs; blank keeps the page's convention.
    const keyRef = authRef.trim().length > 0 ? authRef.trim() : deriveKeyRef(route)
    const storesKey = keyValue.length > 0
    if (!committed) {
      const profile = {
        ...displayName.length === 0 ? {} : { displayName },
        ...icon === undefined ? {} : { icon },
        // The profile names the conventional reference only when this card is
        // about to store a key, matching the editor: a route declared with the
        // key left blank keeps its provider-native auth path (a credential
        // chain, ADC) instead of resolving a reference nothing ever sets.
        ...storesKey ? { apiKeyEnv: keyRef } : {},
        api: protocol,
        baseURL,
        models: models.map(model => ({ ...model })),
        ...userAgent.trim().length === 0 ? {} : { headers: { 'User-Agent': userAgent.trim() } },
      }
      const response = await api.settings.mutate({
        ns: NS,
        ops: [{ op: 'set', path: ['providers', route], value: profile }],
        // `taken` is a snapshot too, so the id check alone cannot see a route
        // declared after this card opened; the revision makes that race a
        // `settings-conflict` instead of a write over the other profile.
        expectedRevision: openedAt,
      })
      if (!response.result.ok) return response.result.error.message
      // The provider now exists. A retry after the key write below fails must
      // not re-run this mutate: the revision it holds is the one this write
      // just superseded, so the Host would answer `settings-conflict` and the
      // key could never be stored from this card at all.
      setCommitted(true)
    }
    if (storesKey) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      // The profile landed; saying the key did not is the only honest report,
      // and the retry above now goes straight back to this write.
      if (!stored.result.ok) return stored.result.error.message
    }
    return undefined
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await createOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      props.onClose(true)
    } catch (error) {
      // A transport failure rejects rather than answering; without this the
      // card would stay busy with nothing shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const cardFooter = (
    <EditorFooter
      t={t}
      busy={busy}
      submitDisabled={disabled || !ready}
      submitLabel="create"
      submitBusyLabel="creating"
      onCancel={() => { props.onClose(committed) }}
      onSubmit={() => { void create() }}
    />
  )

  return (
    <div className={props.embedded === true ? styles['editorEmbedded'] : styles['editor']}>
      {/* The provider's logo, centered above the route id: the icon dialog's
          chosen mark, or the display name's initial until one is chosen. A
          gateway being declared has no route yet, so the avatar seeds from
          the display name — the same fallback the card list shows. */}
      <IconField
        provider={route.length === 0 ? 'custom' : route}
        displayName={displayName.length === 0 ? (route.length === 0 ? '?' : route) : displayName}
        icon={icon}
        onChange={setIcon}
        disabled={profileDisabled}
        t={t}
      />
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customRoute')}</span>
        <input
          className={styles['input']}
          type="text"
          value={route}
          placeholder="acme-gateway"
          aria-label={t('customRoute')}
          disabled={profileDisabled}
          onChange={(event) => { setRoute(event.target.value) }}
        />
      </div>
      {/* A rejected id reads as a fault, not as guidance — the same split the
          key field below already makes between its failure and its hint. */}
      {routeInvalid || routeTaken
        ? <p className={styles['error']}>{t(routeInvalid ? 'customRouteInvalid' : 'customRouteTaken')}</p>
        : <p className={styles['advancedHint']}>{t('customRouteHint')}</p>}
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
        <input
          className={styles['input']}
          type="text"
          value={displayName}
          placeholder={route.length === 0 ? t('customDisplayName') : route}
          aria-label={t('customDisplayName')}
          disabled={profileDisabled}
          onChange={(event) => { setDisplayName(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <div className={styles['fieldHead']}>
          <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
          {/* The endpoint's own action, at the label row's right edge. A route
              being declared has no adapter to answer for it yet, so the typed
              endpoint is the only thing an interrogation could go on — the
              button waits for one, and says so in its title. */}
          <button
            type="button"
            className={styles['manageButton']}
            disabled={profileDisabled || manageBlocked !== undefined}
            title={manageBlocked === undefined ? undefined : t(manageBlocked)}
            onClick={() => { setManageOpen(true) }}
          >
            <IconApiOutline14 size={14} />
            {t('manageAndTest')}
          </button>
        </div>
        <input
          className={styles['input']}
          type="text"
          value={baseURL}
          placeholder="https://gateway.example/v1"
          aria-label={t('baseUrl')}
          disabled={profileDisabled}
          onChange={(event) => { setBaseURL(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('keyInput')}</span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={t('keyPlaceholder')}
          aria-label={t('keyInput')}
          disabled={disabled}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
        {/* A create card has no stored key to keep, so the blank case says
            what a blank field means here instead: this route may authenticate
            through the provider's own ambient discovery or OAuth. */}
        {keyFailure === undefined
          ? null
          : <p className={styles['error']}>{t(keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure)}</p>}
      </div>
      {/*
        The 高级选项 fold carries everything a hand-declared route can still
        default or defer: the wire it speaks, the credential reference its key
        stores under, the User-Agent its requests carry, and the model mapping
        it serves — cc-switch's own advanced section for a custom provider.
      */}
      <details className={styles['customized']}>
        <summary className={styles['customizedSummary']}>{t('advanced')}</summary>
        <div className={styles['customizedBody']}>
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('customApi')}</span>
            <select
              className={`${styles['input']} ${styles['selectInput']}`}
              value={protocol}
              aria-label={t('customApi')}
              disabled={profileDisabled}
              onChange={(event) => { setProtocol(event.target.value) }}
            >
              {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          </div>
          {/* Blank keeps the derived `<ROUTE>_API_KEY` reference; naming one
              stores the key under it instead — the reference the profile and
              the credential write must agree on. */}
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('credentialRef')}</span>
            <input
              className={styles['input']}
              type="text"
              value={authRef}
              placeholder={route.length === 0 ? t('credentialRef') : deriveKeyRef(route)}
              aria-label={t('credentialRef')}
              disabled={profileDisabled}
              onChange={(event) => { setAuthRef(event.target.value) }}
            />
          </div>
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('userAgent')}</span>
            <input
              className={styles['input']}
              type="text"
              value={userAgent}
              aria-label={t('userAgent')}
              disabled={profileDisabled}
              onChange={(event) => { setUserAgent(event.target.value) }}
            />
          </div>
          {/* A provider being declared has no route yet, so the endpoint typed
              in the form above is the only thing an interrogation could go on;
              the fetch rides the mapping's own header, at its right edge. */}
          <ModelListEditor
            models={models}
            onChange={setModels}
            t={t}
            disabled={profileDisabled}
            onFetch={() => { setManageOpen(true) }}
            fetchBlocked={manageBlocked}
            fetched={fetched}
          />
          {manageOpen
            ? (
              <ManageTestDialog
                probe={{
                  settingsNs: NS,
                  baseURL,
                  api: protocol,
                  ...keyValue.length === 0 ? {} : { apiKey: keyValue },
                }}
                probeBlocked={manageBlocked}
                api={api}
                models={models}
                t={t}
                onAdopt={(candidates) => { setModels(adoptIntoMapping(models, candidates)) }}
                onFetched={onFetched}
                onClose={() => { setManageOpen(false) }}
              />
            )
            : null}
        </div>
      </details>
      {/* The fetch banner portals to the body's top layer, above any dialog. */}
      {toast}
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {/* Only the gates with something to say render; the route-id gate has its
          own field-level hint, so its blocked state would print an empty line. */}
      {hint === undefined ? null : <p className={styles['advancedHint']}>{hint}</p>}
      {props.footerSlot === undefined ? cardFooter : createPortal(cardFooter, props.footerSlot)}
    </div>
  )
}
