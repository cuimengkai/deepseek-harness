/**
 * Settings page: the routed, full-viewport settings surface (ui-layout renders
 * it above the inert app grid while its `/settings/:section?` path is active).
 * Slack/Notion-style layout — a top bar (back, page title, actions, close)
 * over a left nav rail and a full-height content column that renders the
 * active section with generous padding. The active section id arrives from the
 * injected face, which validates the URL parameter against the section ledger
 * and falls back to the first row; the section entries are mounted by id so
 * the app holds only one section's tree at a time. Every piece of text
 * (trigger label, panel title, close label, sections) arrives from registrants
 * through slots; the back and nav labels are the shell's own `settings` copy.
 */
import { useEffect, useId, useRef } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16, IconChevronLeftOutline14, IconCloseOutline16,
  IconDataOutline16, IconPersonalizationOutline16, IconSettingsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPageComponentProps } from './shell-contract.ts'
import css from './SettingsPage.module.css'

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent' || id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

/**
 * Render the routed settings page (top bar + nav rail + active section).
 * @param props - composed slot props (shell-contract.ts).
 * @returns the settings page element tree.
 */
export function SettingsPage({ useSections, useSectionId, close, back, openSection, renderSlot, t }: SettingsPageComponentProps) {
  const rows = useSections(s => s)
  const active = useSectionId(s => s)
  const titleId = useId()

  // Document-level Escape is the keyboard close path for the whole page: it
  // leaves settings for good (root), same as the X control — not a history
  // step, so it cannot strand the app under a covering page from a deep
  // section stack (listener lifetime is the page's — mounted while the page
  // is active).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [close])

  // Baseline focus management: entering the page lands on the close control.
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeButton.current?.focus() }, [])

  return (
    <div className={css.page} data-settings-page>
      <header className={css.topBar}>
        <button type="button" className={css.back} onClick={back}>
          <IconChevronLeftOutline14 size={14} />
          {t('back')}
        </button>
        <h1 id={titleId} className={css.title}>{renderSlot('settings.header', {})}</h1>
        <div className={css.actions}>{renderSlot('settings.action', {})}</div>
        <button ref={closeButton} type="button" className={css.close} onClick={close}>
          <IconCloseOutline16 size={14} />
          <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
        </button>
      </header>
      <div className={css.body}>
        <nav className={css.nav} aria-label={t('nav')}>
          {rows.map(row => (
            <button
              key={row.id}
              type="button"
              className={clsx(css.navCell, row.id === active && css.active)}
              aria-current={row.id === active ? 'page' : undefined}
              onClick={() => { openSection(row.id) }}
            >
              {navIcon(row.id)}
              <span className={css.navLabel}>{row.label}</span>
            </button>
          ))}
        </nav>
        <div className={css.content}>
          <div className={css.options}>
            {active !== undefined && renderSlot('settings.section', { close }, { only: active })}
          </div>
        </div>
      </div>
    </div>
  )
}
