/**
 * Agent settings hub: one settings section whose feature-owned tabs host
 * capability packs and orchestration flows as two guided builder steps.
 * New sessions pick a scenario Agent on the home hero; pure presets stay advanced.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentHubLocaleKey } from './hub-locales.ts'
import css from './AgentHubSection.module.css'

/** One tab projected from a `settings.agent.tab` contribution. */
export interface AgentHubTabEntry {
  id: string
  order: number
  label: string
}

/** Registration-side business face for the hub. */
export interface AgentHubSectionInjected {
  hooks: {
    /** Ordered, locale-aware projection of the Agent tab ledger. */
    tabs: HostObservable<readonly AgentHubTabEntry[]>
    /** Active tab id derived from `?tab=` (falls back to the first tab). */
    activeTab: HostObservable<string | undefined>
  }
  /** Switch tab and rewrite `?tab=` on the current settings path. */
  selectTab: (id: string) => void
}

/** Props the renderer binds for the hub. */
export type AgentHubSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.agent'>
  & PropsRenderSlots<'settings.agent.tab'>
  & InjectFace<AgentHubSectionInjected>

/**
 * Parse `tab` from a URL search string.
 * @param search - `location.search`, including the leading `?` when present.
 * @returns the tab id, or undefined when absent/empty.
 */
export function tabFromSearch(search: string): string | undefined {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab')
  if (raw === null || raw.trim() === '') return undefined
  return raw.trim()
}

/**
 * Build a settings Agent path with tab and optional deep-link params.
 * @param tab - tab id to select; omitted clears the tab query.
 * @param extra - optional `preset` / `mode` deep-link ids.
 * @returns path under `/settings/agent`.
 */
export function agentHubPath(
  tab?: string,
  extra?: { readonly preset?: string; readonly mode?: string },
): string {
  const params = new URLSearchParams()
  if (tab !== undefined && tab !== '') params.set('tab', tab)
  if (extra?.preset !== undefined && extra.preset !== '') params.set('preset', extra.preset)
  if (extra?.mode !== undefined && extra.mode !== '') params.set('mode', extra.mode)
  const query = params.toString()
  return query === '' ? '/settings/agent' : `/settings/agent?${query}`
}

/**
 * Read one query value from a URL search string.
 * @param search - `location.search`.
 * @param key - parameter name.
 * @returns trimmed value, or undefined when absent/empty.
 */
export function searchParam(search: string, key: string): string | undefined {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(key)
  if (raw === null || raw.trim() === '') return undefined
  return raw.trim()
}

/**
 * Map a legacy settings section id onto the Agent hub tab it replaced.
 * @param section - URL section segment.
 * @returns hub tab id when the section was retired; otherwise undefined.
 */
export function legacyAgentSectionTab(section: string | undefined): string | undefined {
  if (section === 'agent-presets') return 'presets'
  if (section === 'agent-modes') return 'modes'
  return undefined
}

/** Render the Agent settings hub (intro + tabs + feature panels). */
export function AgentHubSection({
  t, renderSlot, close, useTabs, useActiveTab, selectTab,
}: AgentHubSectionProps) {
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const rows = useTabs(value => value)
  const urlTab = useActiveTab(value => value)
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  const active = (urlTab !== undefined && rows.some(row => row.id === urlTab)
    ? urlTab
    : rows[0]?.id)

  useEffect(() => {
    if (active === undefined) return
    setVisitedIds((previous) => {
      if (previous.has(active)) return previous
      return new Set([...previous, active])
    })
  }, [active])

  // Keep `?tab=` honest when the query is missing or names an unknown tab.
  useEffect(() => {
    if (active === undefined) return
    if (urlTab === active) return
    selectTab(active)
  }, [active, urlTab, selectTab])

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <div className={css.overview}>
        <p className={css.overviewLead}>{t('overviewLead')}</p>
        <ol className={css.overviewSteps}>
          <li>{t('overviewStep1')}</li>
          <li>{t('overviewStep2')}</li>
          <li>{t('overviewStep3')}</li>
        </ol>
      </div>
      {rows.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <>
          <div className={css.tabs} role="tablist" aria-label={t('tabs')}>
            {rows.map((row, index) => {
              const selected = row.id === active
              return (
                <button
                  key={row.id}
                  ref={(element) => { tabRefs.current[index] = element }}
                  id={`${tabsId}-tab-${row.id}`}
                  type="button"
                  role="tab"
                  className={css.tab}
                  aria-selected={selected}
                  aria-controls={`${tabsId}-panel-${row.id}`}
                  data-active={selected ? 'true' : undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => { selectTab(row.id) }}
                  onKeyDown={(event) => {
                    let nextIndex: number
                    switch (event.key) {
                      case 'ArrowRight': nextIndex = (index + 1) % rows.length; break
                      case 'ArrowLeft': nextIndex = (index - 1 + rows.length) % rows.length; break
                      case 'Home': nextIndex = 0; break
                      case 'End': nextIndex = rows.length - 1; break
                      default: return
                    }
                    event.preventDefault()
                    const nextRow = rows[nextIndex] as AgentHubTabEntry
                    const nextTab = tabRefs.current[nextIndex] as HTMLButtonElement
                    selectTab(nextRow.id)
                    nextTab.focus()
                  }}
                >
                  {row.label}
                </button>
              )
            })}
          </div>
          {rows
            .filter(row => row.id === active || visitedIds.has(row.id))
            .map((row) => {
              const selected = row.id === active
              return (
                <div
                  key={row.id}
                  id={`${tabsId}-panel-${row.id}`}
                  className={css.panel}
                  role="tabpanel"
                  aria-labelledby={`${tabsId}-tab-${row.id}`}
                  hidden={!selected}
                >
                  {renderSlot('settings.agent.tab', { close }, { only: row.id })}
                </div>
              )
            })}
        </>
      )}
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent settings hub chrome (title, intro, tab list). */
    'settings.agent': AgentHubLocaleKey
  }
}
