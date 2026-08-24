/**
 * Agent-presets settings section: the roster as cards, a composer that
 * assembles an agent from the installed plugins, a copy dialog, and a
 * read-only canvas view over the shipped compositions.
 *
 * The browser edits no composition text — a shipped preset opens as a
 * read-only design page (it is the known-good composition a copy starts
 * from), and a custom preset is edited in the composer or in its own files,
 * which is what the location action leads to. Deleting a preset leaves running
 * sessions alone: a composition is mounted once at session creation and
 * nothing re-reads the file.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconBrowseOutline16, IconCopyOutline16, IconEditOutline16, IconFolderOpenOutline16, IconPlusOutline16,
  IconTrashOutline16, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelKind } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { draftBlocker, type AgentPresetSectionState, type ComposeDraft } from './section-store.ts'
import { AgentPresetComposer } from './AgentPresetComposer.tsx'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetSection.module.css'

/** Registration-side business face for the management section. */
export interface AgentPresetSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useAgentPresetSection. */
    agentPresetSection: SnapshotStore<AgentPresetSectionState>
  }
  /** Read the roster; called once when the section first renders. */
  load: () => Promise<void>
  /** Open one shipped preset's composition in the read-only canvas view. */
  view: (id: string) => Promise<void>
  /** Close the read-only canvas view. */
  closeView: () => void
  /** Open the copy dialog over one preset. */
  beginCopy: (from: string) => void
  /** Close the copy dialog, discarding the draft. */
  cancelCopy: () => void
  /** Name the preset the copy creates. */
  setCopyId: (id: string) => void
  /** Name the copy's display name. */
  setCopyName: (name: string) => void
  /** Submit the copy. */
  confirmCopy: () => Promise<void>
  /** Open the drag-and-drop composer; null starts a new preset, an id edits one. */
  beginCompose: (id: string | null) => Promise<void>
  /** Close the composer, discarding the draft. */
  closeComposer: () => void
  /** Name the preset the composition lands on. */
  setComposerId: (id: string) => void
  /** Name the composed preset's display name. */
  setComposerName: (name: string) => void
  /**
   * Add a plugin module to the composition from the palette's click path.
   * Returns the new node's canvas id, or undefined when the module is already
   * composed, so the caller can select it.
   */
  addRow: (moduleName: string) => string | undefined
  /**
   * Add a plugin module to the composition from the palette's drop path, at
   * the graph position it landed on. Returns the new node's canvas id, or
   * undefined when the module is already composed.
   */
  addNodeAt: (moduleName: string, position: { x: number; y: number }) => string | undefined
  /** Remove one row from the composition, by its row id (or module name). */
  removeRow: (rowId: string) => void
  /** Remove one node from the composition by its canvas id (the delete key). */
  removeNode: (nodeId: string) => void
  /** Reorder the composition by chain index. */
  moveRow: (from: number, to: number) => void
  /** Move one node's canvas position (the drag gesture). */
  moveNode: (nodeId: string, position: { x: number; y: number }) => void
  /** Reorder the composition so one node runs right after another (connect). */
  reorderNode: (fromNodeId: string, toNodeId: string) => void
  /**
   * Bind one model kind's route on one composition node — the inspector's
   * model-kind picker. The route is part of the draft, so an edit wakes Save.
   */
  updateAgentModelKind: (nodeId: string, kind: ModelKind, field: 'provider' | 'model', value: string) => void
  /**
   * Save the composition. Resolves true when it saved, false when it was
   * blocked or failed, so a caller can chain a follow-up on success.
   */
  confirmCompose: () => Promise<boolean>
  /** Open one preset's directory, or reveal its path where there is no desktop. */
  openLocation: (id: string) => Promise<void>
  /**
   * Stage the self-referential preset and start a new session on it — the
   * guided way to author a preset, reached from the composer's Creator-mode
   * handoff. Absent when the surface is composed without the conversation
   * flow to land the session in.
   */
  startCreatorDraft?: () => void
  /** Ask for delete confirmation, or dismiss it with null. */
  confirmDelete: (id: string | null) => void
  /** Delete the preset awaiting confirmation. */
  remove: () => Promise<void>
  /** Make one preset the default for sessions created later. */
  makeDefault: (id: string) => Promise<void>
}

/** Full component props. */
export type AgentPresetSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSectionInjected>

/** Copy-dialog sub-view props: the draft plus the actions that mutate it. */
interface CopyDialogProps {
  state: AgentPresetSectionState
  t: (key: AgentPresetSettingsKey) => string
  actions: Pick<AgentPresetSectionInjected,
    'cancelCopy' | 'confirmCopy' | 'setCopyId' | 'setCopyName'>
}

function CopyDialog({ state, t, actions }: CopyDialogProps): ReactNode {
  const draft = state.copy
  const blocker = draft === null ? undefined : draftBlocker(draft, state.rows)
  const message = draft === null ? null : draft.error ?? (blocker === undefined ? null : t(blocker))
  const source = draft === null ? undefined : state.rows.find(row => row.id === draft.from)
  const sourceTitle = source === undefined ? draft?.fromTitle : presetDisplayText(source, t).name
  return (
    <Modal
      open={draft !== null}
      onClose={() => { actions.cancelCopy() }}
      title={draft === null ? t('copyTitle') : `${t('copyTitle')} · ${t('copyOf')} ${sourceTitle}`}
      closeLabel={t('close')}
      description={t('copyIntro')}
      className={css.dialog as string}
      footer={(
        <>
          <Button
            variant="outline"
            disabled={draft?.saving === true}
            onClick={() => { actions.cancelCopy() }}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={draft === null || draft.saving || blocker !== undefined}
            onClick={() => { void actions.confirmCopy() }}
          >
            {draft?.saving === true ? t('creating') : t('create')}
          </Button>
        </>
      )}
    >
      {draft === null
        ? null
        : (
          <div className={css.dialogFields}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('presetId')}</span>
              <input
                className={css.input}
                value={draft.id}
                autoFocus
                spellCheck={false}
                placeholder={t('presetIdPlaceholder')}
                onChange={(event) => { actions.setCopyId(event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('displayName')}</span>
              <input
                className={css.input}
                value={draft.name}
                spellCheck={false}
                placeholder={t('displayNamePlaceholder')}
                onChange={(event) => { actions.setCopyName(event.target.value) }}
              />
            </label>
            {message === null ? null : <p className={css.error} role="alert">{message}</p>}
          </div>
        )}
    </Modal>
  )
}

/**
 * Render one card's description, clamped by CSS and offered in full on hover.
 * The tooltip is attached only while the text is actually cut off, so a short
 * description does not answer a hover with a bubble repeating the card.
 * @param props.text - the description as rendered, already localized.
 * @returns the description element, tooltip-anchored while it overflows.
 */
function CardDescription({ text }: { text: string }): ReactNode {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    /* v8 ignore next -- the ref is attached before layout effects run. */
    if (el === null) return
    const measure = () => { setTruncated(el.scrollHeight > el.clientHeight) }
    measure()
    // Card width follows the settings pane, which resizes with the window.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [text])
  return (
    // Capped near the card's own width: the default half-viewport bubble would
    // spill a description out of the settings dialog and across the app behind it.
    <Tooltip label={text} side="bottom" delayMs={400} disabled={!truncated} maxWidth={360}>
      {/* The empty title stops the card body's native tooltip from climbing to
        this span: a cut-off description answers with one bubble, not two. */}
      <span ref={ref} className={css.cardDesc} title="">{text}</span>
    </Tooltip>
  )
}

/**
 * Render the Agent presets section content column.
 * @param props - composed slot props.
 * @returns the section, or null when the deployment composes no presets.
 */
export function AgentPresetSection(props: AgentPresetSectionProps): ReactNode {
  const { useAgentPresetSection, t, load } = props
  const state = useAgentPresetSection(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  // A deployment that composes no presets has nothing to manage: every
  // session shares the host composition and the page would be an empty list.
  if (state.status === 'unavailable') return null
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const detail = state.error ?? ''
    return (
      <div className={css.section}>
        <p className={css.error} role="alert">{`${t('error')} ${detail}`}</p>
        <button type="button" className={css.secondaryButton} onClick={() => { void load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  /* The composer entry: assemble an agent from the installed plugin palette
     by dragging rows into a pipeline. The dashed affordance marks it the
     same way the old creator button did — a place a preset will appear.
     Creator mode is reached from inside the composer, as the handoff that
     builds or refines the draft in conversation. */
  const composerEntry = (
    <button
      type="button"
      className={css.creatorButton}
      disabled={!state.authorable}
      title={state.authorable ? undefined : t('duplicateUnavailable')}
      onClick={() => { void props.beginCompose(null) }}
    >
      <IconPlusOutline16 size={14} />
      {t('newAgent')}
    </button>
  )

  // The composer owns the whole section while open: the roster it edits is
  // the workspace, not context to keep on screen.
  if (state.composer !== null) {
    return (
      <div className={`${css.section} ${css.sectionComposer}`}>
        <AgentPresetComposer
          draft={state.composer}
          palette={state.palette}
          modelCatalog={state.modelCatalog}
          roster={state.rows}
          t={t}
          actions={{
            closeComposer: props.closeComposer,
            setComposerId: props.setComposerId,
            setComposerName: props.setComposerName,
            addRow: props.addRow,
            addNodeAt: props.addNodeAt,
            removeRow: props.removeRow,
            removeNode: props.removeNode,
            moveRow: props.moveRow,
            moveNode: props.moveNode,
            reorderNode: props.reorderNode,
            updateAgentModelKind: props.updateAgentModelKind,
            confirmCompose: props.confirmCompose,
            // The handoff leaves settings with the new session, exactly as the
            // old creator button did.
            ...props.startCreatorDraft === undefined
              ? {}
              : { startCreatorDraft: () => { props.startCreatorDraft?.(); props.close() } },
          }}
        />
      </div>
    )
  }

  // A shipped preset opens as the same design page an edit shows, but
  // read-only: its composition graph is the known-good one a copy starts from,
  // so the canvas explains the chain without any edit affordance. The roster it
  // views is the workspace, not context to keep on screen.
  if (state.view !== null) {
    const view = state.view
    // The head names the preset the way its roster card does: a known shipped
    // preset reads its localized display name, anything else keeps the title
    // the view loaded (so a row that left the roster mid-view still has one).
    const row = state.rows.find(candidate => candidate.id === view.id)
    const title = row === undefined ? view.title : presetDisplayText(row, t).name
    const draft: ComposeDraft = {
      id: view.id,
      name: title,
      graph: view.graph,
      saving: false,
      error: null,
      original: { id: view.id, name: title, graph: view.graph },
    }
    return (
      <div className={`${css.section} ${css.sectionComposer}`}>
        <AgentPresetComposer
          readOnly
          draft={draft}
          palette={state.palette}
          modelCatalog={state.modelCatalog}
          roster={state.rows}
          t={t}
          actions={{
            // Read-only renders none of the edit controls, so only the close
            // action (and, on an authoring deployment, the copy handoff) is
            // reachable; the rest stay as inert stubs so a read-only path
            // cannot mutate a shipped composition by accident.
            closeComposer: props.closeView,
            ...(state.authorable
              ? { onEdit: () => { props.closeView(); props.beginCopy(view.id) } }
              : {}),
            /* v8 ignore start -- the read-only view renders no fields, palette,
               or edit affordances, so the composer never invokes these stubs. */
            setComposerId: () => {},
            setComposerName: () => {},
            addRow: () => undefined,
            addNodeAt: () => undefined,
            removeRow: () => {},
            removeNode: () => {},
            moveRow: () => {},
            moveNode: () => {},
            reorderNode: () => {},
            updateAgentModelKind: () => {},
            confirmCompose: () => Promise.resolve(false),
            /* v8 ignore stop */
          }}
        />
      </div>
    )
  }

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('nav')}</h2>
      <p className={css.intro}>{t('sectionIntro')}</p>
      {state.error === null ? null : <p className={css.error} role="alert">{state.error}</p>}
      {([['system', t('builtInGroup')], ['user', t('customGroup')]] as const).map(([trust, heading]) => {
        const group = state.rows
          .filter(row => row.trust === trust)
          .map(row => ({ row, text: presetDisplayText(row, t) }))
        // The custom group is where a preset of one's own will appear, so it
        // stays on screen even while empty: heading plus the creation entries.
        const tail = trust === 'user'
          ? <div className={css.createRow}>{composerEntry}</div>
          : null
        if (group.length === 0 && tail === null) return null
        return (
          <section key={trust} className={css.group}>
            <h3 className={css.groupHead}>{heading}</h3>
            {group.length === 0 ? null : (
              <ul className={css.cards}>
                {group.map(({ row, text }) => (
                  <li
                    key={row.id}
                    className={row.broken !== undefined
                      ? `${css.card} ${css.cardBroken}`
                      : row.isDefault ? `${css.card} ${css.cardActive}` : css.card}
                  >
                    {/* The card body IS the control: picking a preset is the
                      common act, so it should not hide behind a small button.
                      The action row sits outside it — nesting buttons is
                      invalid, and these act on the card rather than select it.
                      A broken preset cannot compose a session, so its body is
                      disabled and the card says why instead of offering it. */}
                    <button
                      type="button"
                      className={css.cardMain}
                      aria-pressed={row.isDefault}
                      disabled={row.isDefault || row.broken !== undefined}
                      // Without this the name is the whole card read aloud —
                      // title, badge, description, id.
                      aria-label={`${row.broken !== undefined ? t('brokenBadge') : row.isDefault ? t('inUse') : t('setDefault')}: ${text.name}`}
                      title={row.broken ?? (row.isDefault ? t('inUse') : t('setDefault'))}
                      onClick={() => { void props.makeDefault(row.id) }}
                    >
                      <span className={css.cardHead}>
                        <span className={css.cardName}>{text.name}</span>
                        {row.broken !== undefined
                          ? <span className={css.brokenBadge}>{t('brokenBadge')}</span>
                          : null}
                        <span className={css.badge}>
                          {row.trust === 'user' ? t('userTrust') : t('builtIn')}
                        </span>
                        {row.isDefault ? <span className={css.inUse}>{t('inUse')}</span> : null}
                      </span>
                      <CardDescription text={text.description ?? t('noDescription')} />
                      {row.broken === undefined
                        ? null
                        : <span className={css.cardBrokenReason} role="alert">{row.broken}</span>}
                      <code className={css.cardId}>{row.id}</code>
                    </button>
                    <div className={css.cardFoot}>
                      {/* Shipped presets are the compositions a copy starts
                        from, so READING one is the point; a custom preset is
                        edited in its files instead, which the location action
                        leads to. A broken shipped preset has no readable
                        composition to offer, so its viewer is withheld; a
                        broken custom one keeps the location action — the
                        files are where it gets fixed. */}
                      {row.trust === 'system'
                        ? row.broken === undefined
                          ? (
                            <button
                              type="button"
                              className={css.iconButton}
                              data-tip={t('view')}
                              aria-label={`${t('view')}: ${text.name}`}
                              onClick={() => { void props.view(row.id) }}
                            >
                              <IconBrowseOutline16 />
                            </button>
                          )
                          : null
                        : (
                          <button
                            type="button"
                            className={css.iconButton}
                            data-tip={state.hasDocument ? t('openLocation') : t('showLocation')}
                            aria-label={`${state.hasDocument ? t('openLocation') : t('showLocation')}: ${text.name}`}
                            onClick={() => { void props.openLocation(row.id) }}
                          >
                            <IconFolderOpenOutline16 />
                          </button>
                        )}
                      {/* A custom preset is the one thing the composer may
                        overwrite; a shipped one is the composition a copy
                        starts from, so its rows stay read-only. A broken
                        custom preset cannot even load its rows to edit. */}
                      {row.trust === 'user'
                        ? (
                          <button
                            type="button"
                            className={css.iconButton}
                            disabled={!state.authorable || row.broken !== undefined}
                            data-tip={row.broken !== undefined
                              ? t('brokenNoCompose')
                              : state.authorable ? t('compose') : t('duplicateUnavailable')}
                            aria-label={`${t('compose')}: ${text.name}`}
                            onClick={() => { void props.beginCompose(row.id) }}
                          >
                            <IconEditOutline16 />
                          </button>
                        )
                        : null}
                      <button
                        type="button"
                        className={css.iconButton}
                        disabled={!state.authorable || row.broken !== undefined}
                        data-tip={row.broken !== undefined
                          ? t('brokenNoCopy')
                          : state.authorable ? t('duplicate') : t('duplicateUnavailable')}
                        aria-label={`${t('duplicate')}: ${text.name}`}
                        onClick={() => { props.beginCopy(row.id) }}
                      >
                        <IconCopyOutline16 />
                      </button>
                      {row.trust === 'user'
                        ? (
                          <button
                            type="button"
                            className={`${css.iconButton} ${css.iconDanger}`}
                            data-tip={t('delete')}
                            aria-label={`${t('delete')}: ${text.name}`}
                            onClick={() => { props.confirmDelete(row.id) }}
                          >
                            <IconTrashOutline16 />
                          </button>
                        )
                        : null}
                    </div>
                    {state.revealedPaths[row.id] === undefined
                      ? null
                      : (
                        <p className={css.revealedPath}>
                          <span className={css.revealedPathLabel}>{t('revealedPathLabel')}</span>
                          <code>{state.revealedPaths[row.id]}</code>
                        </p>
                      )}
                  </li>
                ))}
              </ul>
            )}
            {tail}
          </section>
        )
      })}
      <CopyDialog
        state={state}
        t={t}
        actions={{
          cancelCopy: props.cancelCopy,
          confirmCopy: props.confirmCopy,
          setCopyId: props.setCopyId,
          setCopyName: props.setCopyName,
        }}
      />
      <Modal
        open={state.pendingDelete !== null}
        onClose={() => { props.confirmDelete(null) }}
        title={t('deleteTitle')}
        closeLabel={t('close')}
        description={t('deleteDescription')}
        className={css.deleteDialog as string}
        footer={(
          <>
            <Button
              variant="outline"
              autoFocus
              disabled={state.deleting}
              onClick={() => { props.confirmDelete(null) }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.deleteConfirm}
              disabled={state.deleting}
              onClick={() => { void props.remove() }}
            >
              {state.deleting ? t('deleting') : t('deleteConfirm')}
            </Button>
          </>
        )}
      />
    </div>
  )
}
