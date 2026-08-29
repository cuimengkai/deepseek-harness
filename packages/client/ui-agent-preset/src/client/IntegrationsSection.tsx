/**
 * Agent hub Integrations tab: MCP connector roster plus searchable plugin
 * inventory cards. Cards deep-link to Connectors, Capabilities, or Plugins.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AgentHubLocaleKey } from './hub-locales.ts'
import type { PaletteModule } from './section-store.ts'
import css from './IntegrationsSection.module.css'

/** Registration-side face for the Integrations tab. */
export interface ConnectorRow {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly url?: string
  readonly command?: string
}

export interface IntegrationsSectionInjected {
  /** List installable plugins (same source as the preset palette). */
  listModules: () => Promise<readonly PaletteModule[]>
  /** List persisted MCP connectors. */
  listConnectors: () => Promise<readonly ConnectorRow[]>
  /** Open Capability packs composer. */
  goPresets: () => void
  /** Open Plugins settings section. */
  goPlugins: () => void
  /** Open Models settings section. */
  goModels: () => void
  /** Open the Connectors destination page. */
  goConnectors: () => void
}

/** Props the renderer binds for the Integrations tab. */
export type IntegrationsSectionProps =
  PropsRuntime<'settings.agent.tab'>
  & PropsLocale<'settings.agent'>
  & InjectFace<IntegrationsSectionInjected>

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; modules: readonly PaletteModule[] }
  | { status: 'error'; message: string }

/**
 * Render Integrations cards from Host plugin inventory with search filter.
 * @param props - inventory loader, navigation, locale.
 * @returns tab panel.
 */
export function IntegrationsSection({
  listModules, listConnectors, goPresets, goPlugins, goModels, goConnectors, t,
}: IntegrationsSectionProps): ReactNode {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [connectors, setConnectors] = useState<readonly ConnectorRow[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    void listModules().then(
      (modules) => {
        if (!cancelled) setLoad({ status: 'ready', modules })
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    void listConnectors().then(
      (rows) => {
        if (!cancelled) setConnectors(rows)
      },
      () => {
        if (!cancelled) setConnectors([])
      },
    )
    return () => { cancelled = true }
  }, [listModules, listConnectors])

  const filtered = useMemo(() => {
    if (load.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    if (needle === '') return load.modules
    return load.modules.filter((module) => {
      const hay = [
        module.displayName,
        module.moduleName,
        module.category ?? '',
        module.description ?? '',
      ].join('\n').toLowerCase()
      return hay.includes(needle)
    })
  }, [load, query])

  return (
    <div className={css.section} data-integrations="">
      <h3 className={css.heading}>{t('integrations.title')}</h3>
      <p className={css.intro}>{t('integrations.intro')}</p>
      <div className={css.toolbar}>
        <label className={css.search}>
          <IconSearchOutline16 size={14} aria-hidden />
          <span className={css.srOnly}>{t('integrations.search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('integrations.search')}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </label>
        <button type="button" className={css.link} onClick={() => { goModels() }}>
          {t('integrations.toModels')}
        </button>
        <button type="button" className={css.link} onClick={() => { goPlugins() }}>
          {t('integrations.toPlugins')}
        </button>
        <button type="button" className={css.link} onClick={() => { goConnectors() }}>
          {t('integrations.toConnectors')}
        </button>
      </div>

      <h4 className={css.subheading}>{t('integrations.connectorsHeading')}</h4>
      {connectors.length === 0 ? (
        <p className={css.muted}>{t('integrations.connectorsEmpty')}</p>
      ) : (
        <ul className={css.grid}>
          {connectors.map(row => (
            <li key={row.id}>
              <button
                type="button"
                className={css.card}
                data-connector-card=""
                onClick={() => { goConnectors() }}
              >
                <span className={css.cardTitle}>{row.name}</span>
                <span className={css.cardBody}>
                  {t('integrations.connectorMeta', {
                    status: row.status,
                    target: row.url ?? row.command ?? row.id,
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {load.status === 'loading' ? (
        <p className={css.muted}>{t('integrations.loading')}</p>
      ) : load.status === 'error' ? (
        <p className={css.error} role="alert">{t('integrations.error', { message: load.message })}</p>
      ) : filtered.length === 0 ? (
        <p className={css.muted}>
          {query.trim() === '' ? t('integrations.empty') : t('integrations.noMatch')}
        </p>
      ) : (
        <ul className={css.grid}>
          {filtered.map(module => (
            <li key={module.moduleName}>
              <button
                type="button"
                className={css.card}
                data-integration-card=""
                onClick={() => { goPresets() }}
              >
                <span className={css.cardTitle}>
                  {module.displayName === '' ? module.moduleName : module.displayName}
                </span>
                {module.category !== undefined ? (
                  <span className={css.cardCategory}>{module.category}</span>
                ) : null}
                {module.description !== undefined && module.description !== '' ? (
                  <span className={css.cardBody}>{module.description}</span>
                ) : (
                  <span className={css.cardBody}>{module.moduleName}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent settings hub chrome (title, intro, tab list, Skills / Integrations). */
    'settings.agent': AgentHubLocaleKey
  }
}
