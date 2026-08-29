// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SettingsTriggerComponentProps } from '../src/client/shell-contract.ts'
import { SettingsTrigger } from '../src/client/SettingsTrigger.tsx'

afterEach(cleanup)

type Step = { id: string; order: number }

/**
 * Mount the trigger with stand-in slot content and the face's plain callbacks.
 * `sessions` selects the blank-Hero fact the onboarding coordinator reads.
 */
function mount({
  wide = true,
  route = false,
  steps = [
    { id: 'welcome', order: -100 },
    { id: 'credential', order: 0 },
  ],
  sessions = { phase: 'ready', byId: {} },
}: {
  wide?: boolean
  route?: boolean
  steps?: Step[]
  sessions?: { phase: string; current?: string; byId: Record<string, { blank: boolean }> }
} = {}) {
  const renderSlot = vi.fn(
    (key: string, _owner: unknown, opts?: { only?: string }) => {
      if (key === 'settings.trigger') return 'Settings'
      return <div data-testid={`onboarding-${opts?.only ?? 'all'}`} />
    },
  )
  const openSettings = vi.fn()
  const openSection = vi.fn()
  // The pending-interaction share exists because the global standard face
  // requires it; SettingsTrigger never reads it.
  const unusedHook = (() => { throw new Error('unused by SettingsTrigger') }) as never
  const props: SettingsTriggerComponentProps = {
    useSessions: ((select: (state: unknown) => unknown) => select(sessions)) as never,
    useSessionPendingInteraction: unusedHook,
    useWorkspaces: unusedHook,
    wide,
    useOnboardingSteps: select => select(steps),
    useSettingsRoute: select => select(route),
    openSettings,
    openSection,
    renderSlot: renderSlot,
  }
  const view = render(<SettingsTrigger {...props} />)
  return { view, renderSlot, openSettings, openSection }
}

describe('SettingsTrigger', () => {
  it('renders the trigger seat content as the accessible name, with navigation not dialog semantics', () => {
    const { renderSlot, openSettings } = mount()
    const trigger = screen.getByRole('button', { name: 'Settings' })
    expect(trigger.hasAttribute('aria-label')).toBe(false)
    expect(trigger.hasAttribute('aria-haspopup')).toBe(false)
    expect(trigger.hasAttribute('aria-expanded')).toBe(false)
    expect(trigger.hasAttribute('aria-current')).toBe(false)
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: true })
    fireEvent.click(trigger)
    // A click navigates; it opens no dialog.
    expect(openSettings).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hands the rail state to the trigger seat', () => {
    const { renderSlot } = mount({ wide: false })
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: false })
  })

  it('marks the trigger current while the settings route is active', () => {
    mount({ route: true })
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('SettingsTrigger onboarding', () => {
  it('mounts steps in order and transfers ownership only on completion', () => {
    const { renderSlot } = mount()
    const first = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    expect(first?.[1]).toMatchObject({ stepId: 'welcome' })
    expect(first?.[2]).toEqual({ only: 'welcome' })
    act(() => {
      (first?.[1] as { complete: () => void }).complete()
      ;(first?.[1] as { complete: () => void }).complete()
    })
    const onboardingCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding')
    const second = onboardingCalls.at(-1)
    expect(second?.[1]).toMatchObject({ stepId: 'credential' })
    expect(second?.[2]).toEqual({ only: 'credential' })
  })

  it('hands the step section navigation through to the face openSection', () => {
    const { renderSlot, openSection } = mount()
    const first = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    act(() => {
      (first?.[1] as { openSection: (id: string) => void }).openSection('models')
    })
    expect(openSection).toHaveBeenCalledWith('models')
  })

  it('paints no step chrome while the covering settings page is active', () => {
    const { renderSlot } = mount({ route: true })
    const onboardingCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding')
    expect(onboardingCalls).toHaveLength(0)
  })

  it('paints no takeover chrome of its own around a mounted step', () => {
    // The chrome (mask, opaque stage, #root inert) belongs to the step via
    // the step-owned dialog surface — a mounted-but-deciding step that
    // renders null must show and block nothing (the reload white-flash fix).
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const { view } = mount()
    expect(view.container.querySelector('[class*="onboarding"]')).toBeNull()
    expect(document.body.querySelector('[class*="onboarding"]')).toBeNull()
    expect(appRoot.inert).not.toBe(true)
    view.unmount()
    appRoot.remove()
  })

  it('renders no step while the sessions fact is no longer blank', () => {
    const { renderSlot } = mount({
      sessions: { phase: 'ready', current: 'active-session', byId: { 'active-session': { blank: false } } },
    })
    const onboardingCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding')
    expect(onboardingCalls).toHaveLength(0)
  })
})
