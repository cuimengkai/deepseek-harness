/**
 * Header utility that opens/closes the session results column (`details`).
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { sessionProducedPaths } from './DetailsPanel.tsx'
import css from './ResultsToggle.module.css'

/** Registration-side face for the results header toggle. */
export interface ResultsToggleInjected {
  /** Whether the results column is open. */
  getDetailsOpen: () => boolean
  /** Subscribe to open-state changes. */
  subscribeDetails: (listener: () => void) => () => void
  /** Toggle the results column. */
  toggleDetails: () => void
  /** Open the results column (used for auto-open on first artifact). */
  openDetails: () => void
}

/** Full props for the header Results toggle. */
export type ResultsToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'chat'>
  & InjectFace<ResultsToggleInjected>

/**
 * Session-header Results switch (WorkBuddy “show details panel”).
 * @param props - slot runtime plus layout face.
 * @returns toggle button.
 */
export function ResultsToggle({
  useChat, getDetailsOpen, subscribeDetails, toggleDetails, openDetails, t,
}: ResultsToggleProps): ReactNode {
  const [open, setOpen] = useState(getDetailsOpen)
  const producedCount = useChat(s => sessionProducedPaths(s).length)
  const [autoOpenedFor, setAutoOpenedFor] = useState(0)

  useEffect(() => subscribeDetails(() => { setOpen(getDetailsOpen()) }), [subscribeDetails, getDetailsOpen])

  useEffect(() => {
    if (producedCount === 0) return
    if (producedCount <= autoOpenedFor) return
    if (getDetailsOpen()) {
      setAutoOpenedFor(producedCount)
      return
    }
    openDetails()
    setAutoOpenedFor(producedCount)
  }, [producedCount, autoOpenedFor, getDetailsOpen, openDetails])

  const badge = !open && producedCount > 0

  return (
    <button
      type="button"
      className={css.toggle}
      data-results-toggle=""
      data-active={open || undefined}
      aria-pressed={open}
      aria-label={open ? t('results.toggleClose') : t('results.toggleOpen')}
      onClick={() => { toggleDetails() }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className={css.icon}>
        <path
          d="M2.5 2.5h5v11h-5zm7 0h4.5v11H9.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      </svg>
      <span className={css.label}>{t('results.toggle')}</span>
      {badge ? <span className={css.badge} aria-hidden>{producedCount}</span> : null}
    </button>
  )
}
