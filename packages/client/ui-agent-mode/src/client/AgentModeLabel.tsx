/**
 * Session-header scenario label: prefers the stamped agent mode when present.
 */

import { useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentModeSeatState } from './mode-seat-store.ts'
import { scenarioLabel } from './mode-seat-store.ts'
import css from './AgentModeLabel.module.css'

/** Registration-side business face for the header scenario label. */
export interface AgentModeLabelInjected {
  hooks: {
    /** Mode roster + staged pick, reused for display names. */
    agentModeSeat: SnapshotStore<AgentModeSeatState>
  }
  load: () => Promise<void>
}

/** Full component props. */
export type AgentModeLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentMode'>
  & InjectFace<AgentModeLabelInjected>

/**
 * Render this session's scenario name beside its title when an agent mode is set.
 * @param props - composed slot props.
 * @returns the label, or null when the session has no mode.
 */
export function AgentModeLabel({
  sessionId, useSessions, useAgentModeSeat, load, t,
}: AgentModeLabelProps) {
  const agentMode = useSessions((state) => {
    const value = state.byId[sessionId]?.projectionValues?.agentMode
    return typeof value === 'string' && value !== '' ? value : undefined
  })
  const options = useAgentModeSeat(state => state.options)

  useEffect(() => {
    if (agentMode !== undefined) void load()
  }, [agentMode, load])

  if (agentMode === undefined) return null

  const option = options.find(entry => entry.id === agentMode)
  const name = option === undefined ? agentMode : scenarioLabel(option, t)
  const description = option?.description
  return (
    <span className={css.label} title={description ?? t('seat.hint')}>
      <IconAgentPresetOutline16 size={14} className={css.icon} />
      <span className={css.kind}>{t('seat.label')}</span>
      {name}
    </span>
  )
}
