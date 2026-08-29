/**
 * Composer-attached strip: start the scenario entry flow, then show status.
 * Same dock family as Goal/Queue — one row, input card stays primary.
 */

import { useEffect, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ScenarioRunState } from './scenario-run-store.ts'
import { modeDisplayText, type AgentModeSettingsKey } from './locales.ts'
import css from './ScenarioDock.module.css'

/** Inject face for the scenario dock. */
export interface ScenarioDockInjected {
  hooks: {
    /** Per-session scenario run store. */
    scenarioRun: SnapshotStore<ScenarioRunState>
  }
  /** Start the entry flow with the given input. */
  start: (input: string) => Promise<void>
}

/** Props the renderer binds. */
export type ScenarioDockProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'settings.agentMode'>
  & InjectFace<ScenarioDockInjected>

/**
 * Friendly display name for the bound scenario id.
 * @param agentMode - mode id, or null.
 * @param t - locale lookup.
 * @returns display name.
 */
function scenarioTitle(
  agentMode: string | null,
  t: (key: AgentModeSettingsKey, params?: Record<string, string>) => string,
): string {
  if (agentMode === null || agentMode === '') return t('seat.label')
  return modeDisplayText({ id: agentMode, trust: 'system' }, t).name
}

/**
 * Render the scenario start / progress strip above the composer.
 * @param props - dock props.
 * @returns dock content, or null when idle.
 */
export function ScenarioDock(props: ScenarioDockProps): ReactNode {
  const {
    useScenarioRun, useInput, inputActions, useSession, start, t,
  } = props
  const run = useScenarioRun(snapshot => snapshot)
  const draft = useInput(state => state.draft)
  const sessionId = useSession(state => state.sessionId)
  const title = scenarioTitle(run.agentMode, t)

  useEffect(() => {
    // Sync is owned by the plugin apply.
  }, [sessionId])

  if (run.phase === 'idle') return null

  if (run.phase === 'ready' || run.phase === 'failed') {
    return (
      <div className={css.dock} data-scenario-dock="" data-phase={run.phase}>
        <div className={css.bar}>
          <span className={css.lead} aria-hidden>
            <IconAgentPresetOutline16 size={16} />
          </span>
          <div className={css.copy}>
            <p className={css.title}>{t('scenario.readyTitle', { name: title })}</p>
            {run.error !== null
              ? <p className={css.error} role="alert">{run.error}</p>
              : (
                <p className={css.hint}>
                  {draft.trim() === '' ? t('scenario.startEmptyHint') : t('scenario.readyHint')}
                </p>
              )}
          </div>
          <div className={css.actions}>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                void (async () => {
                  const text = draft.trim()
                  await start(text)
                  if (text !== '') inputActions.setDraft('')
                })()
              }}
            >
              {t('scenario.start')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (run.phase === 'starting' || run.phase === 'running') {
    return (
      <div className={css.dock} data-scenario-dock="" data-phase="running">
        <div className={css.bar}>
          <span className={css.pulse} aria-hidden />
          <div className={css.copy}>
            <p className={css.title}>{t('scenario.runningTitle', { name: title })}</p>
            <p className={css.hint}>
              {t('scenario.running')}
              {run.status !== null ? ` · ${run.status}` : ''}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={css.dock} data-scenario-dock="" data-phase="settled">
      <div className={css.bar}>
        <span className={css.lead} aria-hidden>
          <IconAgentPresetOutline16 size={16} />
        </span>
        <div className={css.copy}>
          <p className={css.title}>{t('scenario.settledTitle')}</p>
          <p className={css.hint}>{t('scenario.settled')}</p>
        </div>
      </div>
    </div>
  )
}
