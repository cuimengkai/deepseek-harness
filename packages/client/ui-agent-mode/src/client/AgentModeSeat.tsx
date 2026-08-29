/**
 * The scenario-agent chip on the new-session screen: primary hero pick for
 * Mode = capability bind + entry flow.
 */

import { useEffect, useRef, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconAgentPresetOutline16, IconChevronDownOutline14, IconWarningOutline16, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentModeSeatState } from './mode-seat-store.ts'
import { scenarioLabel } from './mode-seat-store.ts'
import { modeDisplayText, type AgentModeSettingsKey } from './locales.ts'
import css from './AgentModeSeat.module.css'

/** Registration-side business face for the scenario chip. */
export interface AgentModeSeatInjected {
  hooks: {
    /** Seat snapshot bound as useAgentModeSeat. */
    agentModeSeat: SnapshotStore<AgentModeSeatState>
  }
  load: () => Promise<void>
  select: (id: string) => Promise<string | undefined>
  introduced: () => void
}

const INTRO_TEXT_DELAY_MS = 150
const INTRO_CHAR_STAGGER_MS = 40
const INTRO_TEXT_REVEAL_MS = 200
const INTRO_CHAR_FADE_MS = 400
const REFUSAL_HOLD_MS = 8000

/**
 * Per-character start offset for the introduce reveal.
 * @param count - character count.
 * @returns stagger ms.
 */
function introStaggerMs(count: number): number {
  if (count <= 1) return 0
  return Math.min(INTRO_CHAR_STAGGER_MS, INTRO_TEXT_REVEAL_MS / (count - 1))
}

/** Full component props. */
export type AgentModeSeatProps =
  PropsRuntime<'conversation.hero.agentMode'>
  & PropsLocale<'settings.agentMode'>
  & InjectFace<AgentModeSeatInjected>

/**
 * Render the new-session scenario chip.
 * @param props - composed slot props.
 * @returns the chip, or null when no modes are available.
 */
export function AgentModeSeat({ load, select, introduced, useAgentModeSeat, t }: AgentModeSeatProps) {
  const state = useAgentModeSeat(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const chosen = state.options.find(option => option.id === state.current)
  const label = chosen === undefined
    ? (state.current === '' ? t('seat.none') : state.current)
    : scenarioLabel(chosen, t)
  const ready = state.options.length > 0

  const [introducing, setIntroducing] = useState(false)
  useEffect(() => {
    if (!state.introduce || !ready) return
    const characters = Array.from(label)
    if (characters.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      introduced()
      return
    }
    setIntroducing(true)
    const done = window.setTimeout(() => {
      setIntroducing(false)
      introduced()
    }, INTRO_TEXT_DELAY_MS + (characters.length - 1) * introStaggerMs(characters.length) + INTRO_CHAR_FADE_MS)
    return () => { window.clearTimeout(done) }
  }, [state.introduce, ready, label, introduced])

  if (!ready) return null

  const characters = Array.from(label)
  const stagger = introStaggerMs(characters.length)
  const shownLabel = introducing
    ? (
      <span className={css.introText}>
        {characters.map((character, index) => (
          <span
            key={index}
            className={css.introChar}
            style={{ animationDelay: `${INTRO_TEXT_DELAY_MS + index * stagger}ms` }}
          >
            {character}
          </span>
        ))}
      </span>
    )
    : label

  return (
    <>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={state.options.map((option) => {
          const text = modeDisplayText(option, t)
          return {
            id: option.id,
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{text.name}</span>
                <span className={css.itemDesc}>
                  {text.description ?? t('section.noDescription')}
                  {option.preset !== undefined
                    ? ` · ${t('seat.capability')}: ${option.preset}`
                    : ''}
                </span>
              </span>
            ),
          }
        })}
        selectedId={state.current === '' ? undefined : state.current}
        onSelect={(id) => {
          setOpen(false)
          const picked = state.options.find(option => option.id === id)
          const name = picked === undefined ? id : scenarioLabel(picked, t)
          void select(id).then((refusal) => {
            if (refusal === undefined) return
            toastSeq.current += 1
            setToast({
              seq: toastSeq.current,
              text: t('seat.switchRefused', { name, reason: refusal }),
            })
          })
        }}
        align="start"
        portal
        anchor={(
          <button
            type="button"
            className={css.seat}
            data-selected={state.current !== '' ? 'true' : undefined}
            aria-haspopup="menu"
            aria-expanded={open}
            title={state.error ?? t('seat.hint')}
            disabled={state.busy}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconAgentPresetOutline16 className={introducing ? `${css.seatIcon} ${css.introIcon}` : css.seatIcon} />
            <span className={css.seatKind}>{t('seat.label')}</span>
            {shownLabel}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          holdMs={REFUSAL_HOLD_MS}
          anchor={document.querySelector<HTMLElement>('[data-composer-card]')}
          onDone={() => { setToast(null) }}
        />
      )}
    </>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.agentMode': AgentModeSettingsKey
  }
}
