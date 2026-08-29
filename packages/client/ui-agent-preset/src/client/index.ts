/**
 * Agent-preset surface plugin, browser half — General-settings row, composer
 * capability chip (after permission), session header label, and the Agent
 * settings hub (capability-preset tab). Orchestration modes register their
 * own tab into the same hub.
 *
 * A running session keeps the composition it began with (the host refuses to
 * adopt an existing session under a different preset). That is what splits
 * the choice from the display: the General row and the composer chip are both
 * before-the-fact on blank sessions, while the header only reports what a
 * session already runs.
 */

// Type-only: pulls the Session Controller service merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-router/client'
// Type-only: pulls the Workspace UI navigation service merge (ctx.uiWorkspace).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelKind } from '@deepseek-ai/dsh-llm/types'
import { AgentPresetLabel } from './AgentPresetLabel.tsx'
import type { AgentPresetLabelInjected } from './AgentPresetLabel.tsx'
import { AgentPresetRow } from './AgentPresetRow.tsx'
import type { AgentPresetRowInjected } from './AgentPresetRow.tsx'
import { CategoryChips } from './CategoryChips.tsx'
import type { CategoryChipsInjected } from './CategoryChips.tsx'
import { CategorySkillRow } from './CategorySkillRow.tsx'
import type { CategorySkillRowInjected } from './CategorySkillRow.tsx'
import { AgentPresetSeat } from './AgentPresetSeat.tsx'
import type { AgentPresetSeatInjected } from './AgentPresetSeat.tsx'
import { AgentHubSection, agentHubPath, searchParam, tabFromSearch } from './AgentHubSection.tsx'
import type { AgentHubSectionInjected, AgentHubTabEntry } from './AgentHubSection.tsx'
import { AgentPresetSection } from './AgentPresetSection.tsx'
import type { AgentPresetSectionInjected } from './AgentPresetSection.tsx'
import { SkillMapSection } from './SkillMapSection.tsx'
import type { SkillMapSectionInjected } from './SkillMapSection.tsx'
import { IntegrationsSection } from './IntegrationsSection.tsx'
import type { IntegrationsSectionInjected } from './IntegrationsSection.tsx'
import { AgentPresetSeatController } from './seat-store.ts'
import { AgentPresetSectionController, displayNameFor } from './section-store.ts'
import type { ModuleSource, PaletteModule } from './section-store.ts'
import { en, zh } from './locales.ts'
import { hubEn, hubZh } from './hub-locales.ts'
import { AGENT_PRESET_SETTINGS_NS, AgentPresetSettingsController } from './settings-store.ts'

export type { AgentPresetLabelInjected, AgentPresetLabelProps } from './AgentPresetLabel.tsx'
export type { AgentPresetRowInjected, AgentPresetRowProps } from './AgentPresetRow.tsx'
export type { AgentPresetSeatInjected, AgentPresetSeatProps } from './AgentPresetSeat.tsx'
export type { AgentHubSectionInjected, AgentHubSectionProps, AgentHubTabEntry } from './AgentHubSection.tsx'
export { agentHubPath, legacyAgentSectionTab, searchParam, tabFromSearch } from './AgentHubSection.tsx'
export type { AgentPresetSectionInjected, AgentPresetSectionProps } from './AgentPresetSection.tsx'
export type { AgentPresetSeatState } from './seat-store.ts'
export {
  displayNameFor, draftBlocker, type AgentPresetSectionState, type CopyDraft,
  type ModuleSource, type PaletteModule, type PresetRow, type PresetView,
} from './section-store.ts'
export type { AgentPresetOption, AgentPresetSettingsState } from './settings-store.ts'
export { AGENT_PRESET_SETTINGS_NS, writeDefaultPreset } from './settings-store.ts'
export type { AgentHubLocaleKey } from './hub-locales.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'locale', 'remote', 'remote.agentPresets', 'remote.settings', 'remote.pluginInventory',
  'remote.skills', 'settingsScope', 'router',
]

/**
 * Mount the General-settings row.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const settingsWire = { settings: ctx.remote.settings }
  const controller = new AgentPresetSettingsController(settingsWire, ctx.remote, ctx.settingsScope.describe())
  // One roster, four surfaces. The chip is registered in a later scope, so it
  // subscribes here rather than being reached from this one.
  const rosterReaders = new Set<() => void>()
  // The composer palette reads the deployment's installed plugins through the
  // generated Remote; a host that mounts no inventory makes the call fail and
  // the palette degrades to "unavailable" without touching an edit in flight.
  const modules: ModuleSource = {
    list: async () => {
      const result = await ctx.remote.pluginInventory.list()
      if (!result.ok) {
        throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
      }
      // The inventory is entry-ordered, and the same module can be shipped by
      // more than one Loader entry; the palette is a set of installable
      // plugins, and duplicate moduleNames would collide as React list keys.
      const byName = new Map<string, PaletteModule>()
      for (const entry of result.value.entries) {
        if (byName.has(entry.moduleName)) continue
        byName.set(entry.moduleName, {
          moduleName: entry.moduleName,
          displayName: displayNameFor(entry.moduleName),
          ...entry.category === undefined ? {} : { category: entry.category },
          ...entry.description === undefined ? {} : { description: entry.description },
        })
      }
      return [...byName.values()]
    },
  }
  const section = new AgentPresetSectionController(ctx.remote, () => {
    void controller.load()
    for (const read of rosterReaders) read()
  }, modules)

  ctx.effect(() => ctx.locale.register('settings.agentPreset', { zh, en }), 'ui-agent-preset: settings row dictionaries')
  ctx.effect(() => ctx.locale.register('settings.agent', { zh: hubZh, en: hubEn }), 'ui-agent-preset: hub dictionaries')

  const injected = (): AgentPresetRowInjected => ({
    hooks: { agentPreset: controller.store },
    load: () => controller.load(),
    select: (id: string) => controller.select(id),
  })

  ctx.effect(() => {
    // The configured model catalog can move while the composer is open: adapter
    // topology commits and settings documents both feed it, and the picker
    // re-reads so a provider or model that changed mid-edit shows up. The
    // composer owns the section while open, so an overlay check is all the
    // gate needed — no namespace filter, exactly like the model selection
    // surface's own refresh.
    const refresh = (): void => {
      const state = section.store.getSnapshot()
      if (state.composer === null && state.view === null) return
      void section.loadModelCatalog()
    }
    const disposers = [
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.remote.$on('settings/document-updated', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-agent-preset: model catalog refresh')

  ctx.effect(() => {
    // The roster is a live directory and the default is a settings field, so
    // both an external settings edit and a reconnect can move this row.
    const refresh = (): void => {
      void controller.load()
      // The section reads the same roster and marks the same default, so a
      // change made from either surface converges both.
      if (section.store.getSnapshot().status !== 'idle') void section.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        refresh()
      }),
      ctx.on('connection/reset', () => { refresh() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-agent-preset: settings refresh')

  // Deep-link `?tab=presets&preset=` (or `?preset=` while the hub defaults to
  // presets) opens view (system) or compose (user), then strips `preset`.
  ctx.effect(() => {
    let opening = false
    const consume = (): void => {
      if (opening) return
      const snap = ctx.router.getSnapshot()
      if (snap.pathname !== '/settings/agent') return
      const tab = tabFromSearch(snap.search)
      if (tab !== undefined && tab !== 'presets') return
      const presetId = searchParam(snap.search, 'preset')
      if (presetId === undefined) return
      opening = true
      void (async () => {
        try {
          await section.load()
          const row = section.store.getSnapshot().rows.find(entry => entry.id === presetId)
          if (row !== undefined) {
            if (row.trust === 'system') await section.view(presetId)
            else await section.beginCompose(presetId)
          }
          ctx.router.navigate(agentHubPath('presets'), { replace: true })
        } finally {
          opening = false
        }
      })()
    }
    consume()
    return ctx.router.subscribe(consume)
  }, 'ui-agent-preset: preset deep link')

  // The settings section's conversational authoring entry: stage the
  // self-referential preset and land a new session on it. Bound inside the
  // conversation scope below (the seat and the session flow live there) and
  // unbound with it, so the section's face reads the current binding per
  // render and simply hides the button while no flow exists.
  let creatorDraft: (() => void) | undefined

  // The composer capability chip and the header label: one controller, because
  // the staged choice belongs to the flow rather than to any one session.
  ctx.inject(['slots', 'conversation', 'sessions', 'uiWorkspace'], (scope: ClientContext) => {
    const seat = new AgentPresetSeatController(scope.remote, () => {
      const state = scope.sessions.list.getSnapshot()
      return state.current === undefined ? undefined : state.byId[state.current]
    })

    const seatInjected = (): AgentPresetSeatInjected => ({
      hooks: { agentPresetSeat: seat.store },
      load: () => seat.load(),
      select: (id: string) => seat.select(id),
      introduced: () => { seat.introduced() },
    })

    const categoryInjected = (): CategoryChipsInjected => ({
      hooks: { agentPresetSeat: seat.store },
      load: () => seat.load(),
      select: (id: string) => seat.select(id),
    })

    const skillInjected = (): CategorySkillRowInjected => ({
      hooks: { agentPresetSeat: seat.store },
      load: () => seat.load(),
    })

    const labelInjected = (): AgentPresetLabelInjected => ({
      hooks: { agentPresets: controller.store },
      load: () => controller.load(),
    })

    scope.effect(() => {
      // Connecting a workspace either creates a blank session or reuses one,
      // and either way the chip's pick predates it — so the stage is applied
      // when the session arrives, not when it was made.
      const stop = scope.sessions.list.subscribe(() => { void seat.apply() })
      // The chip opens on the deployment default, so a default changed from
      // the settings surface moves it too — otherwise the screen that starts
      // the next session keeps offering the previous default until a reload,
      // which is exactly the session the setting claims to govern. A staged
      // pick survives: `load()` prefers it over the refreshed fallback.
      const settingsMoved = scope.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        void seat.load()
      })
      // Authoring writes a FILE, not a setting, so nothing on the wire
      // announces it — without this the screen that starts the next session
      // keeps offering the roster as it stood when the chip first loaded, and
      // a preset authored to be used is missing from the one place it is used.
      const readRoster = (): void => { void seat.load() }
      rosterReaders.add(readRoster)
      // Stage WITHOUT applying — the still-current running session would
      // refuse the swap and drop the stage — then start the session it lands
      // on: the chip's list-change applier composes the blank session the
      // workspace connect produces or reuses.
      creatorDraft = () => {
        // The introduce cue makes the chip announce the pick the user never
        // made on this screen — the stage happened back in settings.
        seat.stage('cordis', true)
        scope.uiWorkspace.startSession()
      }
      const chip = scope.slots.register({
        name: 'conversation.input.left',
        id: 'agent-preset',
        // Immediately after PermissionSelect inside `.modes` (plan follows).
        order: -10,
        locale: 'settings.agentPreset',
        inject: seatInjected,
      }, AgentPresetSeat)
      const categories = scope.slots.register({
        name: 'conversation.hero.agentPreset',
        locale: 'settings.agentPreset',
        inject: categoryInjected,
      }, CategoryChips)
      const skills = scope.slots.register({
        name: 'conversation.input.dock',
        id: 'category-skills',
        order: -20,
        locale: 'settings.agentPreset',
        inject: skillInjected,
      }, CategorySkillRow)
      const label = scope.slots.register({
        name: 'conversation.session.header.actions',
        id: 'agent-preset',
        // Static session context occupies the header's leading negative-order band.
        order: -10,
        locale: 'settings.agentPreset',
        inject: labelInjected,
      }, AgentPresetLabel)
      return () => {
        stop()
        settingsMoved()
        rosterReaders.delete(readRoster)
        creatorDraft = undefined
        chip()
        categories()
        skills()
        label()
      }
    }, 'ui-agent-preset: composer capability chip, hero categories, and header label')
  })

  const sectionInjected = (): AgentPresetSectionInjected => ({
    hooks: { agentPresetSection: section.store },
    load: () => section.load(),
    view: (id: string) => section.view(id),
    closeView: () => { section.closeView() },
    beginCopy: (from: string) => { section.beginCopy(from) },
    cancelCopy: () => { section.cancelCopy() },
    setCopyId: (id: string) => { section.setCopyId(id) },
    setCopyName: (name: string) => { section.setCopyName(name) },
    confirmCopy: () => section.confirmCopy(),
    beginCompose: (id: string | null) => section.beginCompose(id),
    closeComposer: () => { section.closeComposer() },
    setComposerId: (id: string) => { section.setComposerId(id) },
    setComposerName: (name: string) => { section.setComposerName(name) },
    addRow: (moduleName: string) => section.addRow(moduleName),
    addNodeAt: (moduleName: string, position: { x: number; y: number }) => section.addNodeAt(moduleName, position),
    removeRow: (rowId: string) => { section.removeRow(rowId) },
    removeNode: (nodeId: string) => { section.removeNode(nodeId) },
    moveRow: (from: number, to: number) => { section.moveRow(from, to) },
    moveNode: (nodeId: string, position: { x: number; y: number }) => { section.moveNode(nodeId, position) },
    reorderNode: (fromNodeId: string, toNodeId: string) => { section.reorderNode(fromNodeId, toNodeId) },
    updateAgentModelKind: (nodeId: string, kind: ModelKind, field: 'provider' | 'model', value: string) => {
      section.updateAgentModelKind(nodeId, kind, field, value)
    },
    confirmCompose: () => section.confirmCompose(),
    openLocation: (id: string) => section.openLocation(id),
    ...creatorDraft === undefined ? {} : { startCreatorDraft: creatorDraft },
    confirmDelete: (id: string | null) => { section.confirmDelete(id) },
    remove: () => section.remove(),
    makeDefault: (id: string) => section.makeDefault(id),
  })

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'agent-preset',
    order: -25,
    locale: 'settings.agentPreset',
    inject: injected,
  }, AgentPresetRow))

  // One Agent settings page hosts capability-preset and orchestration-mode
  // tabs. Modes register `settings.agent.tab` from their own package.
  let tabsVersion = -1
  let tabsRevision = -1
  let tabs: readonly AgentHubTabEntry[] = []
  const hubInjected = (): AgentHubSectionInjected => ({
    hooks: {
      tabs: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.agent.tab')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== tabsVersion || revision !== tabsRevision) {
            tabsVersion = version
            tabsRevision = revision
            tabs = ctx.slots.entries('settings.agent.tab')
              .map(entry => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: entry.options.id ?? '',
                order: entry.options.order ?? 0,
                label: resolveSlotLabel(entry.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return tabs
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.agent.tab', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
      activeTab: {
        getSnapshot: () => tabFromSearch(ctx.router.getSnapshot().search),
        subscribe: listener => ctx.router.subscribe(listener),
      },
    },
    selectTab: (id) => {
      const search = ctx.router.getSnapshot().search
      const preset = searchParam(search, 'preset')
      const mode = searchParam(search, 'mode')
      ctx.router.navigate(agentHubPath(id, {
        ...id === 'presets' && preset !== undefined ? { preset } : {},
        ...id === 'modes' && mode !== undefined ? { mode } : {},
      }), { replace: true })
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent',
    order: 20,
    label: () => ctx.locale.bind('settings.agent')('nav'),
    locale: 'settings.agent',
    inject: hubInjected,
    children: { 'settings.agent.tab': { kind: 'list', scope: 'root' } },
  }, AgentHubSection))

  ctx.slots.inject('settings.agent.tab', () => ctx.slots.register({
    name: 'settings.agent.tab',
    id: 'presets',
    order: 0,
    label: () => ctx.locale.bind('settings.agent')('tabPresets'),
    locale: 'settings.agentPreset',
    inject: sectionInjected,
  }, AgentPresetSection))

  const skillsInjected = (): SkillMapSectionInjected => ({
    listSkills: async (sessionId) => {
      const result = await ctx.remote.skills.list({ sessionId })
      if (!result.ok) {
        throw new Error(`skills/list failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value.skills
    },
  })

  ctx.slots.inject('settings.agent.tab', () => ctx.slots.register({
    name: 'settings.agent.tab',
    id: 'skills',
    order: 20,
    label: () => ctx.locale.bind('settings.agent')('tabSkills'),
    locale: 'settings.agent',
    inject: skillsInjected,
  }, SkillMapSection))

  const remotes = ctx.remote as unknown as {
    connectors?: { list: IntegrationsSectionInjected['listConnectors'] }
  }
  const integrationsInjected = (): IntegrationsSectionInjected => ({
    listModules: modules.list,
    listConnectors: remotes.connectors?.list ?? (async () => []),
    goPresets: () => { ctx.router.navigate(agentHubPath('presets')) },
    goPlugins: () => { ctx.router.navigate('/settings/plugins') },
    goModels: () => { ctx.router.navigate('/settings/models') },
    goConnectors: () => { ctx.router.navigate('/connectors') },
  })

  ctx.slots.inject('settings.agent.tab', () => ctx.slots.register({
    name: 'settings.agent.tab',
    id: 'integrations',
    order: 30,
    label: () => ctx.locale.bind('settings.agent')('tabIntegrations'),
    locale: 'settings.agent',
    inject: integrationsInjected,
  }, IntegrationsSection))
}
