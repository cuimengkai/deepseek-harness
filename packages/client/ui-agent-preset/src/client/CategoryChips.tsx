/**
 * WorkBuddy-style empty-state category segmented control: three picks that
 * stage a capability preset when the matching roster id is present.
 */

import { useEffect, type ReactNode } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCodeOutline16, IconEnhanceOutline16, IconThinkOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSeatState } from './seat-store.ts'
import css from './CategoryChips.module.css'

/** Category → shipped preset id (hide the chip when the id is absent). */
export const CATEGORY_PRESETS = [
  { id: 'office', presetId: 'standard', labelKey: 'category.office' as const, Icon: IconThinkOutline16 },
  { id: 'coding', presetId: 'develop', labelKey: 'category.coding' as const, Icon: IconCodeOutline16 },
  { id: 'creative', presetId: 'cordis', labelKey: 'category.creative' as const, Icon: IconEnhanceOutline16 },
] as const

/** Map a staged preset id back to a category id. */
export function categoryIdForPreset(presetId: string): (typeof CATEGORY_PRESETS)[number]['id'] | undefined {
  return CATEGORY_PRESETS.find(cat => cat.presetId === presetId)?.id
}

/** Injected seat face (shared with the composer capability chip). */
export interface CategoryChipsInjected {
  hooks: {
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
  }
  load: () => Promise<void>
  select: (id: string) => Promise<string | undefined>
}

export type CategoryChipsProps =
  PropsRuntime<'conversation.hero.agentPreset'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<CategoryChipsInjected>

/**
 * Render the three category segments under the Assistant greeting.
 * @param props - seat snapshot + select + locale.
 * @returns segmented control, or null when no mapped presets exist.
 */
export function CategoryChips({
  useAgentPresetSeat, load, select, t,
}: CategoryChipsProps): ReactNode {
  useEffect(() => { void load() }, [load])
  const options = useAgentPresetSeat(s => s.options)
  const current = useAgentPresetSeat(s => s.current)
  const busy = useAgentPresetSeat(s => s.busy)
  const visible = CATEGORY_PRESETS.filter(cat => options.some(o => o.id === cat.presetId))
  if (visible.length === 0) return null

  return (
    <div className={css.segment} data-category-chips="" role="group" aria-label={t('category.label')}>
      {visible.map((cat) => {
        const active = current === cat.presetId
        const Icon = cat.Icon
        return (
          <button
            key={cat.id}
            type="button"
            className={clsx(css.chip, active && css.chipActive)}
            data-category={cat.id}
            aria-pressed={active}
            disabled={busy}
            onClick={() => { void select(cat.presetId) }}
          >
            <Icon size={14} className={css.icon} />
            <span>{t(cat.labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
