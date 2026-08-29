// @vitest-environment jsdom
/** Category chips and category skill-starter row presentation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { CategoryChips, CATEGORY_PRESETS } from '../src/client/CategoryChips.tsx'
import type { CategoryChipsProps } from '../src/client/CategoryChips.tsx'
import { CategorySkillRow, SKILL_STARTERS } from '../src/client/CategorySkillRow.tsx'
import type { CategorySkillRowProps } from '../src/client/CategorySkillRow.tsx'
import type { AgentPresetSeatState } from '../src/client/seat-store.ts'
import { en } from '../src/client/locales.ts'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'

afterEach(() => { cleanup() })

const t = (key: string) => (en as Record<string, string>)[key] ?? key

function seatState(partial: Partial<AgentPresetSeatState> = {}): AgentPresetSeatState {
  return {
    options: [
      { id: 'standard', trust: 'system', name: 'Standard' },
      { id: 'develop', trust: 'system', name: 'Develop' },
      { id: 'cordis', trust: 'system', name: 'Creator' },
      { id: 'minimal', trust: 'system', name: 'Minimal' },
    ],
    current: 'standard',
    error: null,
    busy: false,
    introduce: false,
    ...partial,
  }
}

describe('CategoryChips', () => {
  it('maps the three WorkBuddy categories onto shipped presets and stages a pick', async () => {
    const store = createSnapshotStore(seatState())
    const select = vi.fn(async () => undefined)
    render(<CategoryChips {...({
      useAgentPresetSeat: (sel: (s: AgentPresetSeatState) => unknown) => sel(store.getSnapshot()),
      load: async () => {},
      select,
      t,
    } as unknown as CategoryChipsProps)}
    />)
    expect(CATEGORY_PRESETS).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Everyday work' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Code & build' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Design & create' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Task categories' }).hasAttribute('data-category-chips')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Code & build' }))
    expect(select).toHaveBeenCalledWith('develop')
  })

  it('hides categories whose preset id is absent from the roster', () => {
    const store = createSnapshotStore(seatState({
      options: [{ id: 'standard', trust: 'system', name: 'Standard' }],
    }))
    render(<CategoryChips {...({
      useAgentPresetSeat: (sel: (s: AgentPresetSeatState) => unknown) => sel(store.getSnapshot()),
      load: async () => {},
      select: async () => undefined,
      t,
    } as unknown as CategoryChipsProps)}
    />)
    expect(screen.getByRole('button', { name: 'Everyday work' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Code & build' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Design & create' })).toBeNull()
  })
})

describe('CategorySkillRow', () => {
  it('injects a category starter draft on blank sessions', () => {
    const store = createSnapshotStore(seatState({ current: 'develop' }))
    const setDraft = vi.fn()
    const session = { blank: true } as SessionSnapshot
    render(<CategorySkillRow {...({
      session,
      input: {},
      inputActions: { setDraft },
      useAgentPresetSeat: (sel: (s: AgentPresetSeatState) => unknown) => sel(store.getSnapshot()),
      load: async () => {},
      t,
    } as unknown as CategorySkillRowProps)}
    />)
    expect(SKILL_STARTERS.coding).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: 'Day-to-day coding' }))
    expect(setDraft).toHaveBeenCalledWith('Help me with day-to-day coding in this workspace.')
  })

  it('hides on non-blank sessions', () => {
    const store = createSnapshotStore(seatState())
    const session = { blank: false } as SessionSnapshot
    const { container } = render(<CategorySkillRow {...({
      session,
      input: {},
      inputActions: { setDraft: vi.fn() },
      useAgentPresetSeat: (sel: (s: AgentPresetSeatState) => unknown) => sel(store.getSnapshot()),
      load: async () => {},
      t,
    } as unknown as CategorySkillRowProps)}
    />)
    expect(container.querySelector('[data-category-skills]')).toBeNull()
  })
})
