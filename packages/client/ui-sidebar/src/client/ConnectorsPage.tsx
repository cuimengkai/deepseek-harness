/**
 * Operable Connectors page: generic MCP-server cards from the Host registry.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarKey } from './locales.ts'
import css from './DestinationPage.module.css'

/** One connector card the page renders. */
export interface ConnectorCard {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly transport: string
  readonly url?: string
  readonly command?: string
  readonly status: string
  readonly error?: string
}

/** Injected Host registry + navigation. */
export interface ConnectorsPageInjected {
  list: () => Promise<readonly ConnectorCard[]>
  addHttp: (request: { name: string; url: string }) => Promise<ConnectorCard>
  setEnabled: (id: string, enabled: boolean) => Promise<ConnectorCard>
  remove: (id: string) => Promise<void>
  goAssistant: () => void
}

/** Props the renderer binds for `/connectors`. */
export type ConnectorsPageProps =
  PropsRuntime<'page'>
  & PropsLocale<'sidebar'>
  & InjectFace<ConnectorsPageInjected>

/**
 * List MCP connectors and add one by URL.
 * @param props - registry actions, locale.
 * @returns page.
 */
export function ConnectorsPage({
  list, addHttp, setEnabled, remove, goAssistant, t,
}: ConnectorsPageProps): ReactNode {
  const [rows, setRows] = useState<readonly ConnectorCard[]>([])
  const [error, setError] = useState<string | undefined>()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setRows(await list())
      setError(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [list])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className={css.page} data-connectors-page="">
      <div className={css.stack}>
        <header className={css.header}>
          <h1 className={css.title}>{t('connectors.title')}</h1>
          <p className={css.body}>{t('connectors.body')}</p>
          <div className={css.actions}>
            <button type="button" className={css.secondary} onClick={() => { goAssistant() }}>
              {t('connectors.toAssistant')}
            </button>
          </div>
        </header>

        <section className={css.section} aria-labelledby="connectors-add-heading">
          <h2 id="connectors-add-heading" className={css.sectionTitle}>{t('connectors.addHeading')}</h2>
          <form
            className={css.form}
            onSubmit={(event) => {
              event.preventDefault()
              setBusy(true)
              void addHttp({ name, url }).then(
                () => {
                  setName('')
                  setUrl('')
                  return reload()
                },
                (caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : String(caught))
                },
              ).finally(() => { setBusy(false) })
            }}
          >
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('connectors.name')}</span>
              <input className={css.input} value={name} onChange={(event) => { setName(event.target.value) }} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('connectors.url')}</span>
              <input className={css.input} value={url} onChange={(event) => { setUrl(event.target.value) }} />
            </label>
            <div className={css.actions}>
              <button type="submit" className={css.primary} disabled={busy}>
                {t('connectors.add')}
              </button>
            </div>
          </form>
        </section>

        {error !== undefined ? <p className={css.error} role="alert">{error}</p> : null}

        <section className={css.section} aria-labelledby="connectors-list-heading">
          <h2 id="connectors-list-heading" className={css.sectionTitle}>{t('connectors.listHeading')}</h2>
          {rows.length === 0 ? (
            <p className={css.muted}>{t('connectors.empty')}</p>
          ) : (
            <ul className={css.list}>
              {rows.map(row => (
                <li key={row.id} className={css.card} data-connector-row="">
                  <div className={css.cardMain}>
                    <div className={css.cardTitle}>{row.name}</div>
                    <div className={css.cardMeta}>
                      {t('connectors.meta', {
                        status: row.status,
                        target: row.url ?? row.command ?? row.transport,
                      })}
                    </div>
                    {row.error !== undefined ? <div className={css.cardMeta}>{row.error}</div> : null}
                  </div>
                  <div className={css.cardActions}>
                    <button
                      type="button"
                      className={css.secondary}
                      onClick={() => {
                        void setEnabled(row.id, !row.enabled).then(() => reload(), (caught: unknown) => {
                          setError(caught instanceof Error ? caught.message : String(caught))
                        })
                      }}
                    >
                      {row.enabled ? t('connectors.disable') : t('connectors.enable')}
                    </button>
                    <button
                      type="button"
                      className={css.secondary}
                      onClick={() => {
                        void remove(row.id).then(() => reload(), (caught: unknown) => {
                          setError(caught instanceof Error ? caught.message : String(caught))
                        })
                      }}
                    >
                      {t('connectors.remove')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

/** Locale keys this page reads from the sidebar namespace. */
export type ConnectorsPageLocaleKey = Extract<
  SidebarKey,
  | 'connectors.title' | 'connectors.body' | 'connectors.toAssistant' | 'connectors.addHeading'
  | 'connectors.name' | 'connectors.url' | 'connectors.add' | 'connectors.listHeading'
  | 'connectors.empty' | 'connectors.meta' | 'connectors.enable' | 'connectors.disable'
  | 'connectors.remove'
>
