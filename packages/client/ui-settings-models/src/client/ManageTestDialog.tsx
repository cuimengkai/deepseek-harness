/**
 * The 管理与测试 dialog one provider form's base-URL field opens: it asks
 * the endpoint **the form currently shows** — including a key typed but not
 * yet saved — so testing a provider is one pass instead of save-then-return,
 * and the reply is candidates the user picks from, never configuration
 * written behind them. The picked candidates are handed to the form, which
 * fills its model mapping's empty rows with them; every fetched candidate is
 * also handed over on arrival, so the mapping rows' pick menus can offer the
 * endpoint's own listing even after this dialog closes.
 *
 * Opening the dialog is the request: the interrogation starts on its own. A
 * provider that cannot be asked — an unreachable endpoint, a protocol with
 * no readable listing, a key the form has already refused — is not a dead
 * end; the failure is shown, and the mapping rows wait behind the dialog
 * for hand-entry.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel as DiscoveredModelView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ModelsLlm, messageOf } from './store.ts'
import { emptyMappingSlots } from './ModelListEditor.tsx'
import type { ModelDraft } from './ModelListEditor.tsx'
import type { en, ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * The state both provider forms keep for one fetch outcome: the candidates
 * the last interrogation returned — the pool the mapping rows' pick menus
 * list — plus the transient top banner reporting how many models arrived.
 * The toast rides above the dialog (its layer sits over the modal's), so the
 * count is visible the moment the reply lands.
 * @param t - section copy.
 * @returns the fetched pool, the outcome callback, and the banner node.
 */
export function useModelFetchOutcome(t: (key: ModelsKey) => string): {
  fetched: readonly DiscoveredModelView[]
  onFetched: (models: readonly DiscoveredModelView[]) => void
  toast: ReactNode
} {
  const [fetched, setFetched] = useState<readonly DiscoveredModelView[]>([])
  const [banner, setBanner] = useState<{ seq: number; count: number } | undefined>(undefined)
  const onFetched = (models: readonly DiscoveredModelView[]): void => {
    setFetched(models)
    if (models.length > 0) setBanner(current => ({ seq: (current?.seq ?? 0) + 1, count: models.length }))
  }
  const toast = banner === undefined ? null : (
    <Toast
      key={banner.seq}
      text={t('fetchToast').replace('{count}', String(banner.count))}
      onDone={() => { setBanner(undefined) }}
    />
  )
  return { fetched, onFetched, toast }
}

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ManageTestDialog}. */
export interface ManageTestDialogProps {
  /** Endpoint facts for the interrogation. */
  probe: ProbeTarget
  /**
   * Copy key naming why the interrogation is unavailable, or `undefined` when
   * it is not. The card owns this because the key it would send is judged
   * there: asking with a key the form has already refused spends a round trip
   * to be told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** Wire face the interrogation calls. */
  api: Pick<ModelsLlm, 'discoverModels'>
  /**
   * The mapping as currently drafted, for two judgements the dialog makes on
   * its own: an id already served starts unchecked, and with no empty row an
   * adoption has nothing to write.
   */
  models: readonly ModelDraft[]
  /** Hand the picked candidates to the form, which fills its mapping rows. */
  onAdopt: (candidates: readonly DiscoveredModelView[]) => void
  /**
   * Hand every fetched candidate to the form the moment the reply lands —
   * the pool its mapping rows' pick menus list — so it survives this dialog
   * closing without an adoption.
   */
  onFetched: (models: readonly DiscoveredModelView[]) => void
  /** Close the dialog. */
  onClose: () => void
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Render the manage-and-test dialog.
 * @param props - the probe target, the drafted mapping, and copy.
 * @returns the dialog, which interrogates the endpoint on mount.
 */
export function ManageTestDialog(props: ManageTestDialogProps): ReactNode {
  const { probe, api, models, t } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [latency, setLatency] = useState<number | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  // The dialog mounts per open (its parent renders it conditionally), so the
  // interrogation runs once on mount: `probe` and `models` cannot change while
  // a modal owns the screen.
  useEffect(() => {
    // A route the adapter already describes answers without an endpoint; only
    // a draft with neither has nothing to ask about.
    const askable = probe.provider !== undefined
      || (probe.baseURL !== undefined && probe.baseURL.length > 0)
    if (props.probeBlocked !== undefined) {
      setFailure(t(props.probeBlocked))
      return
    }
    if (!askable) {
      setFailure(t('fetchNeedsBaseUrl'))
      return
    }
    setBusy(true)
    const startedAt = performance.now()
    let stale = false
    void api.discoverModels(probe.settingsNs, {
      ...probe.provider === undefined ? {} : { provider: probe.provider },
      ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
      ...probe.api === undefined ? {} : { api: probe.api },
      ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
    }).then(
      (response) => {
        if (stale) return
        setBusy(false)
        if (!response.ok) {
          setFailure(response.error.message)
          return
        }
        const found = response.value
        setLatency(Math.round(performance.now() - startedAt))
        props.onFetched(found)
        if (found.length === 0) {
          setFailure(t('fetchEmpty'))
          return
        }
        // Everything already served starts unchecked, so adopting a selection
        // never silently rewrites a capacity the user corrected.
        const known = new Set(models.map(model => textOf(model, 'id')))
        setCandidates(found)
        setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
      },
      (error: unknown) => {
        // The transport rejected rather than answering; without this the
        // dialog would stay busy with nothing shown.
        if (stale) return
        setBusy(false)
        setFailure(messageOf(error))
      },
    )
    return () => { stale = true }
  }, [])

  const adoptPicked = (): void => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    props.onAdopt(candidates.filter(candidate => picked.has(candidate.id)))
    props.onClose()
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const activeCandidates = candidates ?? []
  const allCandidatesPicked = activeCandidates.length > 0
    && activeCandidates.every(candidate => picked.has(candidate.id))

  const toggleAllCandidates = (): void => {
    setPicked(() => {
      return activeCandidates.every(candidate => picked.has(candidate.id))
        ? new Set()
        : new Set(activeCandidates.map(candidate => candidate.id))
    })
  }

  // With every row filled there is nothing an adoption could write; the
  // button explains itself rather than closing over a silent no-op.
  const slots = emptyMappingSlots(models)

  return (
    <Modal
      open
      onClose={props.onClose}
      title={t('manageAndTest')}
      closeLabel={t('close')}
      description={t('manageTestDescription')}
      className={styles['fetchDialog'] as string}
      contentClassName={styles['fetchDialogContent'] as string}
      bodyClassName={styles['fetchDialogBody'] as string}
      footer={(
        <>
          <Button variant="outline" onClick={props.onClose}>{t('cancel')}</Button>
          <Button
            variant="outline"
            disabled={slots === 0 || candidates === undefined}
            title={slots === 0 ? t('mappingFull') : undefined}
            onClick={adoptPicked}
          >
            {t('fetchAdopt')}
          </Button>
        </>
      )}
    >
      {busy ? <p className={styles['advancedHint']}>{t('fetching')}</p> : null}
      {/* The endpoint's answer time, the one number a "test" owes: it says
          how long the interrogation round trip took, beside whatever the
          listing itself reports. */}
      {latency === undefined ? null : (
        <p className={styles['fetchLatency']}>{t('fetchLatency').replace('{ms}', String(latency))}</p>
      )}
      {candidates === undefined ? null : (
        <>
          <div className={styles['candidateActions']}>
            <Button variant="ghost" size="sm" onClick={toggleAllCandidates}>
              {t(allCandidatesPicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
            </Button>
          </div>
          <ul className={styles['candidateList']}>
            {activeCandidates.map(candidate => (
              <li key={candidate.id} className={styles['candidate']}>
                <label className={styles['candidateLabel']}>
                  <input
                    type="checkbox"
                    checked={picked.has(candidate.id)}
                    onChange={() => { toggle(candidate.id) }}
                  />
                  {/* The id is the string adoption writes; the endpoint's own
                      name for the model rides beside it as the display name
                      the row it fills would show, and a 1M context declares
                      itself as the checked declaration adoption would set. */}
                  <span className={styles['candidateId']}>{candidate.id}</span>
                  {candidate.name !== undefined && candidate.name.length > 0
                    ? <span className={styles['candidateName']}>{candidate.name}</span>
                    : null}
                  {candidate.contextWindow === 1_000_000
                    ? <span className={styles['candidateOneM']}>{t('modelOneMHeader')}</span>
                    : null}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
    </Modal>
  )
}
