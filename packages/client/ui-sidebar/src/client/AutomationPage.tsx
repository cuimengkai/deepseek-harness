/**
 * Operable Automation page: honest Jobs / flow-run explanation and recent
 * background jobs from the session list mirror. No cron SaaS surface.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SidebarKey } from './locales.ts'
import css from './DestinationPage.module.css'

/** Injected navigation for the Automation page. */
export interface AutomationRuleRow {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly enabled: boolean
  readonly kind: string
  readonly lastError?: string
}

export interface AutomationPageInjected {
  /** Return to the Assistant (conversation) surface. */
  goAssistant: () => void
  /** Open Agent orchestration (modes try-run). */
  goOrchestration: () => void
  /** Open Agent settings hub root. */
  goAgentSettings: () => void
  listRules: () => Promise<readonly AutomationRuleRow[]>
  createRule: (draft: { name: string; prompt: string; kind: 'interval'; intervalMs: number }) => Promise<AutomationRuleRow>
  setRuleEnabled: (id: string, enabled: boolean) => Promise<AutomationRuleRow>
  removeRule: (id: string) => Promise<void>
}

/** Props the renderer binds for `/automation`. */
export type AutomationPageProps =
  PropsRuntime<'page'>
  & PropsLocale<'sidebar'>
  & InjectFace<AutomationPageInjected>

/** One flattened recent-job row for the page list. */
interface RecentJobRow {
  readonly sessionId: string
  readonly sessionTitle: string
  readonly job: SessionJob
}

const MAX_RECENT = 12

/**
 * Explain Host automation surfaces and list recent background jobs when any.
 * @param props - session hooks, navigation, locale.
 * @returns page.
 */
export function AutomationPage({
  useSessions, goAssistant, goOrchestration, goAgentSettings,
  listRules, createRule, setRuleEnabled, removeRule, t,
}: AutomationPageProps): ReactNode {
  const byId = useSessions(state => state.byId)
  const jobsBySession = useSessions(state => state.jobsBySession)

  const [rules, setRules] = useState<readonly AutomationRuleRow[]>([])
  const [ruleError, setRuleError] = useState<string | undefined>()
  const [ruleName, setRuleName] = useState('')
  const [rulePrompt, setRulePrompt] = useState('')
  const [intervalMs, setIntervalMs] = useState('3600000')

  const reloadRules = useCallback(async () => {
    try {
      setRules(await listRules())
      setRuleError(undefined)
    } catch (caught) {
      setRuleError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [listRules])

  useEffect(() => {
    void reloadRules()
  }, [reloadRules])

  const recent = useMemo(() => {
    const rows: RecentJobRow[] = []
    for (const [sessionId, jobs] of Object.entries(jobsBySession)) {
      const summary = byId[sessionId as keyof typeof byId]
      const sessionTitle = summary?.displayTitle ?? sessionId
      for (const job of jobs) {
        rows.push({ sessionId, sessionTitle, job })
      }
    }
    rows.sort((a, b) => {
      const aAt = a.job.finishedAt ?? a.job.startedAt
      const bAt = b.job.finishedAt ?? b.job.startedAt
      return bAt - aAt
    })
    return rows.slice(0, MAX_RECENT)
  }, [byId, jobsBySession])

  return (
    <div className={css.page} data-automation-page="">
      <div className={css.stack}>
        <header className={css.header}>
          <h1 className={css.title}>{t('automation.title')}</h1>
          <p className={css.body}>{t('automation.body')}</p>
          <div className={css.actions}>
            <button type="button" className={css.primary} onClick={() => { goOrchestration() }}>
              {t('automation.toModes')}
            </button>
            <button type="button" className={css.secondary} onClick={() => { goAssistant() }}>
              {t('automation.toAssistant')}
            </button>
            <button type="button" className={css.secondary} onClick={() => { goAgentSettings() }}>
              {t('automation.toAgent')}
            </button>
          </div>
        </header>

        <section className={css.section} aria-labelledby="automation-rules-heading">
          <h2 id="automation-rules-heading" className={css.sectionTitle}>{t('automation.listHeading')}</h2>
          <form
            className={css.form}
            onSubmit={(event) => {
              event.preventDefault()
              void createRule({
                name: ruleName,
                prompt: rulePrompt,
                kind: 'interval',
                intervalMs: Number(intervalMs),
              }).then(() => {
                setRuleName('')
                setRulePrompt('')
                return reloadRules()
              }, (caught: unknown) => {
                setRuleError(caught instanceof Error ? caught.message : String(caught))
              })
            }}
          >
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('automation.name')}</span>
              <input className={css.input} value={ruleName} onChange={(event) => { setRuleName(event.target.value) }} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('automation.prompt')}</span>
              <textarea className={css.textarea} value={rulePrompt} onChange={(event) => { setRulePrompt(event.target.value) }} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('automation.intervalMs')}</span>
              <input className={css.input} value={intervalMs} onChange={(event) => { setIntervalMs(event.target.value) }} />
            </label>
            <div className={css.actions}>
              <button type="submit" className={css.primary}>{t('automation.create')}</button>
            </div>
          </form>
          {ruleError !== undefined ? <p className={css.error} role="alert">{ruleError}</p> : null}
          {rules.length === 0 ? (
            <p className={css.muted}>{t('automation.rulesEmpty')}</p>
          ) : (
            <ul className={css.list}>
              {rules.map(row => (
                <li key={row.id} className={css.card} data-automation-rule="">
                  <div className={css.cardMain}>
                    <div className={css.cardTitle}>{row.name}</div>
                    <div className={css.cardMeta}>
                      {t('automation.ruleMeta', {
                        kind: row.kind,
                        status: row.enabled ? 'on' : 'off',
                      })}
                    </div>
                    {row.lastError !== undefined ? <div className={css.cardMeta}>{row.lastError}</div> : null}
                  </div>
                  <div className={css.cardActions}>
                    <button
                      type="button"
                      className={css.secondary}
                      onClick={() => {
                        void setRuleEnabled(row.id, !row.enabled).then(() => reloadRules())
                      }}
                    >
                      {row.enabled ? t('automation.disable') : t('automation.enable')}
                    </button>
                    <button
                      type="button"
                      className={css.secondary}
                      onClick={() => {
                        void removeRule(row.id).then(() => reloadRules())
                      }}
                    >
                      {t('automation.remove')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={css.section} aria-labelledby="automation-jobs-heading">
          <h2 id="automation-jobs-heading" className={css.sectionTitle}>
            {t('automation.jobsHeading')}
          </h2>
          <p className={css.muted}>{t('automation.jobsHint')}</p>
          {recent.length === 0 ? (
            <p className={css.muted}>{t('automation.jobsEmpty')}</p>
          ) : (
            <ul className={css.list}>
              {recent.map(({ sessionId, sessionTitle, job }) => (
                <li key={`${sessionId}:${job.id}`} className={css.card} data-job-row="">
                  <div className={css.cardMain}>
                    <div className={css.cardTitle}>{job.label}</div>
                    <div className={css.cardMeta}>
                      {t('automation.jobMeta', {
                        status: job.status,
                        session: sessionTitle,
                      })}
                    </div>
                    {job.detail !== undefined && job.detail !== '' ? (
                      <div className={css.cardMeta}>{job.detail}</div>
                    ) : null}
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
export type AutomationPageLocaleKey = Extract<
  SidebarKey,
  | 'automation.title' | 'automation.body' | 'automation.toModes' | 'automation.toAssistant'
  | 'automation.toAgent' | 'automation.jobsHeading' | 'automation.jobsHint'
  | 'automation.jobsEmpty' | 'automation.jobMeta'
  | 'automation.listHeading' | 'automation.name' | 'automation.prompt' | 'automation.intervalMs'
  | 'automation.create' | 'automation.rulesEmpty' | 'automation.enable' | 'automation.disable'
  | 'automation.remove' | 'automation.ruleMeta'
>
