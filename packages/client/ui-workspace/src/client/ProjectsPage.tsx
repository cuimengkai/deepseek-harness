/**
 * Operable Projects page: Host workspaces with start/open session actions.
 * Not multiplayer collab — local workspace directories the Host already
 * tracks. Lives in ui-workspace (not ui-sidebar) because it reads the global
 * `useWorkspaces` hook this package declares; ui-sidebar's `sidebar.workspaces`
 * slot declaration already makes ui-workspace depend on ui-sidebar one-way,
 * so the reverse (a page needing `useWorkspaces`) has to live here too.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarKey } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import css from './ProjectsPage.module.css'

/** Injected navigation and session actions for the Projects page. */
export interface ProjectBundleRow {
  readonly id: string
  readonly name: string
  readonly instructions: string
  readonly sharedRoot: string
  readonly connectorIds: readonly string[]
}

export interface ProjectsPageInjected {
  /** Return to the Assistant (conversation) surface. */
  goAssistant: () => void
  /** Open Agent settings (capabilities + orchestration). */
  goAgentSettings: () => void
  /** Start a blank session in a workspace and land on Assistant. */
  startSession: (workspaceId: WorkspaceId) => void
  /** Open an existing session and land on Assistant. */
  openSession: (sessionId: SessionId) => void
  listBundles: () => Promise<readonly ProjectBundleRow[]>
  createBundle: (draft: { name: string; sharedRoot: string; instructions: string }) => Promise<ProjectBundleRow>
  startBundle: (id: string) => Promise<void>
  removeBundle: (id: string) => Promise<void>
}

/** Props the renderer binds for `/projects`. */
export type ProjectsPageProps =
  PropsRuntime<'page'>
  & PropsLocale<'sidebar'>
  & InjectFace<ProjectsPageInjected>

/**
 * List Host workspaces with start/open actions and Agent settings exits.
 * @param props - workspace/session hooks, actions, locale.
 * @returns page.
 */
export function ProjectsPage({
  useWorkspaces, useSessions, startSession, openSession, goAssistant, goAgentSettings,
  listBundles, createBundle, startBundle, removeBundle, t,
}: ProjectsPageProps): ReactNode {
  const phase = useWorkspaces(state => state.phase)
  const items = useWorkspaces(state => state.items)
  const archived = useWorkspaces(state => state.archivedSessionIds)
  const byId = useSessions(state => state.byId)
  const [bundles, setBundles] = useState<readonly ProjectBundleRow[]>([])
  const [bundleError, setBundleError] = useState<string | undefined>()
  const [bundleName, setBundleName] = useState('')
  const [sharedRoot, setSharedRoot] = useState('')
  const [instructions, setInstructions] = useState('')

  const reloadBundles = useCallback(async () => {
    try {
      setBundles(await listBundles())
      setBundleError(undefined)
    } catch (caught) {
      setBundleError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [listBundles])

  useEffect(() => {
    void reloadBundles()
  }, [reloadBundles])

  useEffect(() => {
    if (sharedRoot === '' && items[0] !== undefined) setSharedRoot(items[0].path)
  }, [items, sharedRoot])

  return (
    <div className={css.page} data-projects-page="">
      <div className={css.stack}>
        <header className={css.header}>
          <h1 className={css.title}>{t('projects.title')}</h1>
          <p className={css.body}>{t('projects.body')}</p>
          <div className={css.actions}>
            <button type="button" className={css.primary} onClick={() => { goAssistant() }}>
              {t('projects.toAssistant')}
            </button>
            <button type="button" className={css.secondary} onClick={() => { goAgentSettings() }}>
              {t('projects.toAgent')}
            </button>
          </div>
        </header>

        <section className={css.section} aria-labelledby="projects-bundles-heading">
          <h2 id="projects-bundles-heading" className={css.sectionTitle}>{t('projects.listHeading')}</h2>
          <form
            className={css.form}
            onSubmit={(event) => {
              event.preventDefault()
              void createBundle({ name: bundleName, sharedRoot, instructions }).then(() => {
                setBundleName('')
                setInstructions('')
                return reloadBundles()
              }, (caught: unknown) => {
                setBundleError(caught instanceof Error ? caught.message : String(caught))
              })
            }}
          >
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('projects.name')}</span>
              <input className={css.input} value={bundleName} onChange={(event) => { setBundleName(event.target.value) }} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('projects.sharedRoot')}</span>
              <input className={css.input} value={sharedRoot} onChange={(event) => { setSharedRoot(event.target.value) }} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('projects.instructions')}</span>
              <textarea className={css.textarea} value={instructions} onChange={(event) => { setInstructions(event.target.value) }} />
            </label>
            <div className={css.actions}>
              <button type="submit" className={css.primary}>{t('projects.create')}</button>
            </div>
          </form>
          {bundleError !== undefined ? <p className={css.error} role="alert">{bundleError}</p> : null}
          {bundles.length === 0 ? (
            <p className={css.muted}>{t('projects.bundlesEmpty')}</p>
          ) : (
            <ul className={css.list}>
              {bundles.map(row => (
                <li key={row.id} className={css.card} data-project-bundle="">
                  <div className={css.cardMain}>
                    <div className={css.cardTitle}>{row.name}</div>
                    <div className={css.cardMeta}>{row.sharedRoot}</div>
                  </div>
                  <div className={css.cardActions}>
                    <button type="button" className={css.primary} onClick={() => { void startBundle(row.id) }}>
                      {t('projects.start')}
                    </button>
                    <button type="button" className={css.secondary} onClick={() => { void removeBundle(row.id).then(() => reloadBundles()) }}>
                      {t('projects.remove')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <h2 className={css.sectionTitle}>{t('projects.workspacesHeading')}</h2>
        {phase !== 'ready' ? (
          <p className={css.muted}>{t('projects.loading')}</p>
        ) : items.length === 0 ? (
          <p className={css.muted}>{t('projects.empty')}</p>
        ) : (
          <ul className={css.list}>
            {items.map((workspace) => {
              const liveSessions = workspace.sessionIds
                .filter(id => !archived.includes(id))
                .map(id => byId[id])
                .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined)
                .sort((a, b) => b.updatedAt - a.updatedAt)
              const latest = liveSessions[0]
              return (
                <li key={workspace.workspaceId} className={css.card} data-workspace-row="">
                  <div className={css.cardMain}>
                    <div className={css.cardTitle}>{workspace.title}</div>
                    <div className={css.cardMeta}>{workspace.path}</div>
                    {latest !== undefined ? (
                      <div className={css.cardMeta}>
                        {t('projects.latest', { title: latest.displayTitle })}
                      </div>
                    ) : null}
                  </div>
                  <div className={css.cardActions}>
                    <button
                      type="button"
                      className={css.primary}
                      onClick={() => { startSession(workspace.workspaceId) }}
                    >
                      {t('projects.start')}
                    </button>
                    {latest !== undefined && !latest.blank ? (
                      <button
                        type="button"
                        className={css.secondary}
                        onClick={() => { openSession(latest.id) }}
                      >
                        {t('projects.open')}
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Locale keys this page reads from the sidebar namespace. */
export type ProjectsPageLocaleKey = Extract<
  SidebarKey,
  | 'projects.title' | 'projects.body' | 'projects.toAssistant' | 'projects.toAgent'
  | 'projects.loading' | 'projects.empty' | 'projects.start' | 'projects.open' | 'projects.latest'
  | 'projects.listHeading' | 'projects.name' | 'projects.sharedRoot' | 'projects.instructions'
  | 'projects.create' | 'projects.bundlesEmpty' | 'projects.remove' | 'projects.workspacesHeading'
>
