/**
 * Settings shell trigger: the sidebar-foot row that opens the routed settings
 * page. Navigation now, not a dialog: the button carries `aria-current` while
 * the settings route is active and a click calls the injected `openSettings`
 * (which navigates to `/settings`). The onboarding coordinator mounts exactly
 * one ordered registrant while the sessions-derived empty-Hero fact is active
 * — except on the settings route itself, where the covering page would sit
 * under a step's takeover chrome. Visible step chrome belongs to the step, so
 * a mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { SettingsTriggerComponentProps } from './shell-contract.ts'
import css from './SettingsTrigger.module.css'

/**
 * Render the settings trigger and run the onboarding coordinator.
 * @param props - composed slot props (shell-contract.ts).
 * @returns the settings trigger element tree.
 */
export function SettingsTrigger({
  wide, useSessions, useOnboardingSteps, useSettingsRoute,
  openSettings, openSection, renderSlot,
}: SettingsTriggerComponentProps) {
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const onboardingSteps = useOnboardingSteps(s => s)
  const settingsRoute = useSettingsRoute(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  // The settings page covers the whole app while the route is active; a step
  // must not paint its takeover chrome over it. The coordinator keeps its
  // completion state, so leaving the page resumes at the next step.
  const onboardingStep = (onboardingActive && !settingsRoute)
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  return (
    <>
      <button
        type="button"
        className={clsx(css.trigger, !wide && css.rail)}
        aria-current={settingsRoute ? 'page' : undefined}
        onClick={openSettings}
      >
        {renderSlot('settings.trigger', { wide })}
      </button>
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
