/**
 * Hero-state + flyout: add file, Plan mode, Experts settings, skills (/).
 */

import { useRef, useState, type ReactNode } from 'react'
import {
  IconAgentPresetOutline16, IconPaperclipOutline16, IconPlusOutline16,
  IconSkillOutline16, IconThinkOutline16, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditSelection } from '../contract/input.ts'
import css from './ComposerPlusMenu.module.css'

/** Actions the plus menu needs from InputBar. */
export interface ComposerPlusMenuActions {
  /** Admit picked image files into the draft. */
  onFiles: (files: readonly File[]) => void
  /** Enter or leave plan mode via /plan. */
  togglePlan: (leaving: boolean) => void
  /** Whether plan mode is effectively on. */
  planActive: boolean
  /** Open Agent settings. */
  openAgentSettings: () => void
  /** Open the / command menu at a caret span. */
  openSkills: (selection: EditSelection) => void
  /** Current editor selection (or empty leading). */
  caretSpan: () => EditSelection
}

/**
 * Render the hero + control with its WorkBuddy flyout.
 * @param props - actions + translator + locked flag.
 * @returns + button wrapped in Menu.
 */
export function ComposerPlusMenu({
  locked, actions, t,
}: {
  locked: boolean
  actions: ComposerPlusMenuActions
  t: TranslateNS<'conversation'>
}): ReactNode {
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          const list = e.target.files
          if (list !== null && list.length > 0) actions.onFiles([...list])
          e.target.value = ''
        }}
        data-plus-file-input=""
      />
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        align="start"
        side="top"
        portal
        items={[
          {
            id: 'file',
            label: t('input.plus.file'),
            icon: <IconPaperclipOutline16 size={14} />,
          },
          {
            id: 'mode',
            label: t('input.plus.mode'),
            icon: <IconThinkOutline16 size={14} />,
            submenu: [
              {
                id: 'plan',
                label: (
                  <span className={css.planRow}>
                    <span className={css.planCopy}>
                      <span className={css.hint}>{t('input.plus.mode.hint')}</span>
                      <span>{t('input.plus.mode.plan')}</span>
                    </span>
                    <span
                      className={actions.planActive ? css.toggleOn : css.toggleOff}
                      aria-hidden
                    />
                  </span>
                ),
              },
            ],
          },
          {
            id: 'expert',
            label: t('input.plus.expert'),
            icon: <IconAgentPresetOutline16 size={14} />,
          },
          {
            id: 'skills',
            label: t('input.plus.skills'),
            icon: <IconSkillOutline16 size={14} />,
          },
        ]}
        onSelect={(id) => {
          if (id === 'file') {
            setOpen(false)
            fileRef.current?.click()
            return
          }
          setOpen(false)
          if (id === 'plan') actions.togglePlan(actions.planActive)
          else if (id === 'expert') actions.openAgentSettings()
          else if (id === 'skills') actions.openSkills(actions.caretSpan())
        }}
        anchor={(
          <button
            type="button"
            className={css.add}
            aria-label={t('input.plus')}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={locked}
            data-composer-plus=""
            onMouseDown={(e) => { e.preventDefault() }}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPlusOutline16 size={14} />
          </button>
        )}
      />
    </>
  )
}
