// @vitest-environment jsdom
/** Settings shell registration: slot declaration injection, the ledger + URL projections, and HMR recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { RouterService } from '@deepseek-ai/dsh-client-ui-router/client'
import { apply as routerApply, inject as routerInject } from '@deepseek-ai/dsh-client-ui-router/client'
import { apply, inject } from '../src/client/index.ts'
import type { SettingsPageInjected, SettingsTriggerInjected } from '../src/client/shell-contract.ts'
import { SettingsPage } from '../src/client/SettingsPage.tsx'
import { SettingsTrigger } from '../src/client/SettingsTrigger.tsx'

/**
 * Mount the real slot + router + settings chain with the shell's declared
 * injections. The router is the real browser-history service (jsdom); the
 * locale/connection/remote stand-ins are the only mocks — the settings domain
 * base layer boots intact.
 */
async function bench() {
  // The browser history is a window-level singleton that a fresh RouterService
  // wraps: earlier benches' navigations leave the current URL and the stack in
  // place. Normalize the current entry so every bench starts from '/'.
  window.history.replaceState({}, '', '/')
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  await ctx.plugin({ inject: [...routerInject], apply: routerApply }).await()
  // Copy machinery the shell only reads a revision from; the real locale
  // plugin would drag its own settings-row dependencies into this bench.
  ctx.provide('locale', {
    register: () => () => {},
    bind: () => (key: string) => key,
    getSnapshot: () => ({ active: 'zh', locales: [], revision: 0 }),
    subscribe: () => () => {},
  } as never)
  ctx.provide('connection', {
    api: { settings: { describe: async () => ({ result: { ok: false } }) } },
    isLoopback: false,
  } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, router: ctx.get('router') as RouterService }
}

/** Declare the shell's two occupant holes the way ui-layout's root entry does. */
function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'page': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

function triggerInjectedOf(slots: SlotRegistry): SettingsTriggerInjected {
  const entry = slots.entries('sidebar.settings')[0]!
  return (entry.inject as () => SettingsTriggerInjected)()
}

function pageInjectedOf(slots: SlotRegistry): SettingsPageInjected {
  const entry = slots.entries('page')[0]!
  return (entry.inject as () => SettingsPageInjected)()
}

/** The two occupants' child declarations (trigger/onboarding; page chrome + sections). */
const CHILD_SPECS = {
  'settings.trigger': { kind: 'single', scope: 'root' },
  'settings.onboarding': { kind: 'list', scope: 'root' },
  'settings.header': { kind: 'single', scope: 'root' },
  'settings.action': { kind: 'list', scope: 'root' },
  'settings.close': { kind: 'single', scope: 'root' },
  'settings.section': { kind: 'list', scope: 'root' },
} as const

describe('ui-settings apply', () => {
  it('declares the slot registry plus the router', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'settingsScope', 'router'])
  })

  it('registers the trigger and the routed page, declaring every child slot, before or after the declaration', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries('sidebar.settings')[0]!.component).toBe(SettingsTrigger)
    const pageEntry = before.slots.entries('page')[0]!
    expect(pageEntry.component).toBe(SettingsPage)
    // The page entry carries the routable-path option and the locale seat.
    expect(pageEntry.options).toMatchObject({ id: 'settings', order: 0, path: '/settings/:section?' })
    expect(pageEntry.locale).toBe('settings')
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(before.slots.spec(name)).toEqual(CHILD_SPECS[name])
    }

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('sidebar.settings')).toHaveLength(0)
    expect(after.slots.entries('page')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('sidebar.settings')[0]!.component).toBe(SettingsTrigger)
    expect(after.slots.entries('page')[0]!.component).toBe(SettingsPage)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('sidebar.settings')).toHaveLength(1)
    expect(after.slots.entries('page')).toHaveLength(1)
  })

  it('projects the section ledger into ordered nav rows with option defaults', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { sections } = pageInjectedOf(b.slots).hooks
    // This package registers the General section itself; every other section
    // arrives from a feature registrant.
    const GENERAL = { id: 'general', order: 0, label: 'general.nav' }
    expect(sections.getSnapshot()).toEqual([GENERAL])
    b.slots.register({ name: 'settings.section', id: 'z', order: 20, label: 'Z' } as never, () => null)
    // No order and no label: both projection defaults apply.
    b.slots.register({ name: 'settings.section', id: 'a' } as never, () => null)
    const rows = sections.getSnapshot()
    expect(rows).toEqual([
      GENERAL,
      { id: 'a', order: 0, label: '' },
      { id: 'z', order: 20, label: 'Z' },
    ])
    // Snapshot identity is stable until the ledger moves (uSES contract).
    expect(sections.getSnapshot()).toBe(rows)
    const listener = vi.fn()
    const off = sections.subscribe(listener)
    b.slots.register({ name: 'settings.section', id: 'b', order: 1, label: 'B' } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalled()
    expect(sections.getSnapshot()).not.toBe(rows)
    off()
  })

  it('projects onboarding entries into stable coordinator order', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { onboardingSteps } = triggerInjectedOf(b.slots).hooks
    b.slots.register({ name: 'settings.onboarding', id: 'credential', order: 0 } as never, () => null)
    b.slots.register({ name: 'settings.onboarding', id: 'welcome', order: -100 } as never, () => null)
    b.slots.register({ name: 'settings.onboarding', id: 'default-order' } as never, () => null)
    const steps = onboardingSteps.getSnapshot()
    expect(steps).toEqual([
      { id: 'welcome', order: -100 },
      { id: 'credential', order: 0 },
      { id: 'default-order', order: 0 },
    ])
    expect(onboardingSteps.getSnapshot()).toBe(steps)
    const listener = vi.fn()
    const off = onboardingSteps.subscribe(listener)
    b.slots.register({ name: 'settings.onboarding', id: 'later', order: 10 } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    off()
  })

  it('projects the active section from the URL parameter with the first-row fallback', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const router = b.ctx.get('router') as RouterService
    const { sectionId } = pageInjectedOf(b.slots).hooks

    // Off-route and a bare /settings both land on the first row.
    expect(sectionId.getSnapshot()).toBe('general')
    router.navigate('/settings')
    expect(sectionId.getSnapshot()).toBe('general')
    // A valid section id activates; an unknown id falls back.
    router.navigate('/settings/models')
    expect(sectionId.getSnapshot()).toBe('general')
    const offModels = b.slots.register({
      name: 'settings.section', id: 'models', order: 10, label: 'Models',
    } as never, () => null)
    expect(sectionId.getSnapshot()).toBe('models')
    // A section unmounting under an active deep link falls back to the first row.
    offModels()
    expect(sectionId.getSnapshot()).toBe('general')
    // A deep link to a valid section holds across ledger churn.
    b.slots.register({ name: 'settings.section', id: 'models', order: 10, label: 'Models' } as never, () => null)
    router.navigate('/settings/models')
    expect(sectionId.getSnapshot()).toBe('models')

    // Subscribers ride both the router and the section ledger.
    const listener = vi.fn()
    const off = sectionId.subscribe(listener)
    router.navigate('/settings/agent-presets')
    expect(listener).toHaveBeenCalled()
    b.slots.register({ name: 'settings.section', id: 'agent-presets', order: 20, label: 'Agent presets' } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })

  it('tracks the settings route and navigates from the trigger', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const router = b.ctx.get('router') as RouterService
    const trigger = triggerInjectedOf(b.slots)
    const { settingsRoute } = trigger.hooks

    expect(settingsRoute.getSnapshot()).toBe(false)
    router.navigate('/settings/models')
    expect(settingsRoute.getSnapshot()).toBe(true)
    router.navigate('/')
    expect(settingsRoute.getSnapshot()).toBe(false)

    // Subscribers ride router navigations.
    const listener = vi.fn()
    const off = settingsRoute.subscribe(listener)
    router.navigate('/settings')
    expect(listener).toHaveBeenCalled()
    off()

    // openSettings navigates only when not already on the route; openSection
    // navigates to the section.
    trigger.openSettings()
    expect(router.getSnapshot().pathname).toBe('/settings')
    trigger.openSection('models')
    expect(router.getSnapshot().pathname).toBe('/settings/models')
    trigger.openSettings()
    expect(router.getSnapshot().pathname).toBe('/settings/models')
  })

  it('close always leaves for the root; back steps through history with a root fallback', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const router = b.ctx.get('router') as RouterService
    const { close, back } = pageInjectedOf(b.slots)

    // Close is the leave-for-good affordance: it lands on the root no matter
    // how deep the section stack is, so a single X/Escape/section-close can
    // never strand the app under a covering page. The length is forced
    // deterministically rather than asserted, since the shared window stack
    // grows with every earlier bench's pushes.
    const lengthSpy = vi.spyOn(Object.getPrototypeOf(window.history), 'length', 'get').mockReturnValue(1)
    router.navigate('/settings/models')
    close()
    expect(router.getSnapshot().pathname).toBe('/')
    lengthSpy.mockRestore()

    // Back steps one entry at a time: deep → settings root → app root. The
    // step lands asynchronously (jsdom fires popstate on history.back()).
    router.navigate('/settings')
    router.navigate('/settings/models')
    back()
    await vi.waitFor(() => { expect(router.getSnapshot().pathname).toBe('/settings') })
    back()
    await vi.waitFor(() => { expect(router.getSnapshot().pathname).toBe('/') })
  })

  it('back falls back to the root when a fresh tab opened straight on the settings deep link', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const router = b.ctx.get('router') as RouterService
    const { back } = pageInjectedOf(b.slots)

    // A fresh tab has no history to step back through: back lands on the root.
    const lengthSpy = vi.spyOn(Object.getPrototypeOf(window.history), 'length', 'get').mockReturnValue(1)
    router.navigate('/settings/models')
    const version = router.getVersion()
    back()
    expect(router.getVersion()).toBe(version + 1)
    expect(router.getSnapshot().pathname).toBe('/')
    lengthSpy.mockRestore()
  })

  it('re-registers after an HMR collapse re-declares the slots (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(1)
    expect(b.slots.entries('page')).toHaveLength(1)
    // Declarer unload: the cascade removes both occupants and every child
    // declaration while our local disposer variables go stale.
    redeclare()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(0)
    expect(b.slots.entries('page')).toHaveLength(0)
    expect(b.slots.spec('settings.trigger')).toBeUndefined()
    expect(b.slots.spec('settings.section')).toBeUndefined()
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('sidebar.settings')[0]!.component).toBe(SettingsTrigger)
    expect(b.slots.entries('page')[0]!.component).toBe(SettingsPage)
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(b.slots.spec(name)).toEqual(CHILD_SPECS[name])
    }
  })

  it('unregisters both occupants and collapses every child slot on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(0)
    expect(b.slots.entries('page')).toHaveLength(0)
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(b.slots.spec(name)).toBeUndefined()
    }
  })
})
