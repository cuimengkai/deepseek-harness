/**
 * Settings shell contract — the types of the `sidebar.settings` occupant and
 * the routed `page` entry this package renders. They live here rather than in
 * ui-settings because they reference the sidebar's own slot type: ui-settings
 * is the settings domain's base layer and must not depend on any `ui-*`
 * presentation package, or the reference graph closes a cycle through
 * ui-sidebar → ui-layout → ui-theme. The settings SLOT types (what
 * registrants contribute) stay in ui-settings.
 */
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.settings' entry)
// into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the settings slot declarations the shell renders into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** One nav row projected from a settings.section registration's options. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
}

/** One ordered onboarding step projected from a slot registration. */
export interface SettingsOnboardingStep {
  id: string
  order: number
}

/**
 * Registrant-private injected share of the settings trigger (assembled in
 * apply): the onboarding ledger's coordinator order, a boolean tracking
 * whether the current URL is on the settings route, and the navigation
 * callbacks the trigger and onboarding stage call.
 */
export type SettingsTriggerInjected = {
  hooks: {
    /** settings.onboarding ledger projected into coordinator order. */
    onboardingSteps: HostObservable<readonly SettingsOnboardingStep[]>
    /** Whether the current URL is on the settings route (suppresses the onboarding overlays behind the covering page). */
    settingsRoute: HostObservable<boolean>
  }
  /** Open the settings page (navigates to `/settings` when not already there). */
  openSettings: () => void
  /** Navigate to a settings section (`/settings/:id`). */
  openSection: (id: string) => void
}

/**
 * Full component props of the settings trigger: the sidebar owner share
 * (wide/rail state) plus the trigger/onboarding render shares and the injected
 * face (hooks compartment bound to useOnboardingSteps/useSettingsRoute).
 */
export type SettingsTriggerComponentProps =
  PropsRuntime<'sidebar.settings'>
  & PropsRenderSlots<'settings.trigger' | 'settings.onboarding'>
  & InjectFace<SettingsTriggerInjected>

/**
 * Registrant-private injected share of the routed settings page (assembled in
 * apply): the section ledger projected into ordered nav rows, the section id
 * validated against the URL parameter with the first-row fallback, and the
 * navigation callbacks the page chrome calls.
 */
export type SettingsPageInjected = {
  hooks: {
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
    /** Active section id from the URL parameter, falling back to the first row. */
    sectionId: HostObservable<string | undefined>
  }
  /** Leave the settings page entirely (navigate to the root `/`). The header
   * close control, Escape, and the section `close` owner prop all land here. */
  close: () => void
  /** Step one entry back in history (back through sections); lands on the root when there is no back target. */
  back: () => void
  /** Navigate to a settings section (`/settings/:id`). */
  openSection: (id: string) => void
}

/**
 * Full component props of the settings page: the standard `settings` locale
 * seat (the entry registers `locale: NS`), the declared render shares, and the
 * injected face (hooks compartment bound to useSections/useSectionId).
 */
export type SettingsPageComponentProps =
  PropsLocale<'settings'>
  & PropsRenderSlots<'settings.header' | 'settings.action' | 'settings.close' | 'settings.section'>
  & InjectFace<SettingsPageInjected>
