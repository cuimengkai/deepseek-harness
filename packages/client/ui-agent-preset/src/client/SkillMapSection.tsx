/**
 * Agent hub Skills Map tab: list session-scoped skills from `remote.skills`,
 * with honest filesystem install paths when no session or catalog is empty.
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { AgentHubLocaleKey } from './hub-locales.ts'
import css from './SkillMapSection.module.css'

/** Registration-side face for the Skills Map tab. */
export interface SkillMapSectionInjected {
  /**
   * List human-invocable skills for one session's composition.
   * @param sessionId - session whose cwd/preset resolve the catalog.
   */
  listSkills: (sessionId: SessionId) => Promise<readonly SkillEntry[]>
}

/** Props the renderer binds for the Skills tab. */
export type SkillMapSectionProps =
  PropsRuntime<'settings.agent.tab'>
  & PropsLocale<'settings.agent'>
  & InjectFace<SkillMapSectionInjected>

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; skills: readonly SkillEntry[] }
  | { status: 'error'; message: string }

/**
 * Render the Skills Map: Host catalog when a session is selected, else paths.
 * @param props - list callback, session hooks, locale.
 * @returns tab panel.
 */
export function SkillMapSection({
  listSkills, useSessions, t,
}: SkillMapSectionProps): ReactNode {
  const current = useSessions(state => state.current)
  const [load, setLoad] = useState<LoadState>({ status: 'idle' })

  useEffect(() => {
    if (current === undefined) {
      setLoad({ status: 'idle' })
      return
    }
    let cancelled = false
    setLoad({ status: 'loading' })
    void listSkills(current).then(
      (skills) => {
        if (!cancelled) setLoad({ status: 'ready', skills })
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
    return () => { cancelled = true }
  }, [current, listSkills])

  return (
    <div className={css.section} data-skill-map="">
      <h3 className={css.heading}>{t('skills.title')}</h3>
      <p className={css.intro}>{t('skills.intro')}</p>

      {current === undefined ? (
        <p className={css.muted}>{t('skills.noSession')}</p>
      ) : load.status === 'loading' || load.status === 'idle' ? (
        <p className={css.muted}>{t('skills.loading')}</p>
      ) : load.status === 'error' ? (
        <p className={css.error} role="alert">{t('skills.error', { message: load.message })}</p>
      ) : load.skills.length === 0 ? (
        <p className={css.muted}>{t('skills.empty')}</p>
      ) : (
        <ul className={css.list}>
          {load.skills.map(skill => (
            <li key={skill.name} className={css.row} data-skill-row="">
              <div className={css.name}>/{skill.name}</div>
              <div className={css.description}>{skill.description}</div>
              {!skill.modelInvocable ? (
                <div className={css.badge}>{t('skills.userOnly')}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className={css.paths}>
        <p className={css.pathsLead}>{t('skills.pathsLead')}</p>
        <ul className={css.pathList}>
          <li><code>{t('skills.pathHome')}</code></li>
          <li><code>{t('skills.pathProject')}</code></li>
        </ul>
      </div>
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent settings hub chrome (title, intro, tab list, Skills / Integrations). */
    'settings.agent': AgentHubLocaleKey
  }
}
