/**
 * Category-scoped skill starter chips above the blank-session composer.
 * Static locale labels + prompt drafts; not a Host skill marketplace.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSeatState } from './seat-store.ts'
import { CATEGORY_PRESETS, categoryIdForPreset } from './CategoryChips.tsx'
import type { AgentPresetSettingsKey } from './locales.ts'
import css from './CategorySkillRow.module.css'

/** One starter chip: label key + draft text key. */
export interface SkillStarter {
  id: string
  labelKey: AgentPresetSettingsKey
  draftKey: AgentPresetSettingsKey
}

/** Starters per category (aligned with WorkBuddy screenshot semantics). */
export const SKILL_STARTERS: Record<(typeof CATEGORY_PRESETS)[number]['id'], readonly SkillStarter[]> = {
  office: [
    { id: 'docs', labelKey: 'skill.office.docs', draftKey: 'skill.office.docs.draft' },
    { id: 'finance', labelKey: 'skill.office.finance', draftKey: 'skill.office.finance.draft' },
    { id: 'data', labelKey: 'skill.office.data', draftKey: 'skill.office.data.draft' },
    { id: 'desk', labelKey: 'skill.office.desk', draftKey: 'skill.office.desk.draft' },
    { id: 'slides', labelKey: 'skill.office.slides', draftKey: 'skill.office.slides.draft' },
    { id: 'research', labelKey: 'skill.office.research', draftKey: 'skill.office.research.draft' },
  ],
  coding: [
    { id: 'daily', labelKey: 'skill.coding.daily', draftKey: 'skill.coding.daily.draft' },
    { id: 'web', labelKey: 'skill.coding.web', draftKey: 'skill.coding.web.draft' },
    { id: 'agent', labelKey: 'skill.coding.agent', draftKey: 'skill.coding.agent.draft' },
    { id: 'skill', labelKey: 'skill.coding.skill', draftKey: 'skill.coding.skill.draft' },
    { id: 'cicd', labelKey: 'skill.coding.cicd', draftKey: 'skill.coding.cicd.draft' },
    { id: 'docs', labelKey: 'skill.coding.docs', draftKey: 'skill.coding.docs.draft' },
  ],
  creative: [
    { id: 'site', labelKey: 'skill.creative.site', draftKey: 'skill.creative.site.draft' },
    { id: 'ppt', labelKey: 'skill.creative.ppt', draftKey: 'skill.creative.ppt.draft' },
    { id: 'poster', labelKey: 'skill.creative.poster', draftKey: 'skill.creative.poster.draft' },
    { id: 'app', labelKey: 'skill.creative.app', draftKey: 'skill.creative.app.draft' },
    { id: 'system', labelKey: 'skill.creative.system', draftKey: 'skill.creative.system.draft' },
    { id: 'brand', labelKey: 'skill.creative.brand', draftKey: 'skill.creative.brand.draft' },
  ],
}

/** Injected seat + draft writer. */
export interface CategorySkillRowInjected {
  hooks: {
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
  }
  load: () => Promise<void>
}

export type CategorySkillRowProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<CategorySkillRowInjected>

/**
 * Render category skill starters for blank sessions only.
 * @param props - InputZone + seat + locale + inputActions from session kit.
 * @returns scrollable chip row, or null when not blank / no category.
 */
export function CategorySkillRow({
  session, useAgentPresetSeat, load, inputActions, t,
}: CategorySkillRowProps): ReactNode {
  useEffect(() => { void load() }, [load])
  const current = useAgentPresetSeat(s => s.current)
  const scroller = useRef<HTMLDivElement>(null)
  if (!session.blank) return null
  const category = categoryIdForPreset(current) ?? 'office'
  const starters = SKILL_STARTERS[category]
  const canWrite = inputActions !== undefined

  return (
    <div className={css.wrap} data-category-skills="" role="group" aria-label={t('skill.label')}>
      <div ref={scroller} className={css.row}>
        {starters.map(starter => (
          <button
            key={starter.id}
            type="button"
            className={css.chip}
            data-skill={starter.id}
            disabled={!canWrite}
            onClick={() => { inputActions?.setDraft(t(starter.draftKey)) }}
          >
            {t(starter.labelKey)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={css.more}
        aria-label={t('skill.scroll')}
        onClick={() => {
          scroller.current?.scrollBy({ left: 160, behavior: 'smooth' })
        }}
      >
        <IconChevronDownOutline14 size={14} className={css.moreIcon} />
      </button>
    </div>
  )
}
