/**
 * Agent-mode surface plugin, browser half — Agent hub Orchestration tab.
 * Session UI binds capabilities only; scenarios author and try-run here.
 */

import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-router/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AgentModeSection } from './AgentModeSection.tsx'
import type { AgentModeSectionInjected } from './AgentModeSection.tsx'
import { AgentModeSectionController } from './section-store.ts'
import { en, zh } from './locales.ts'

export type { AgentModeSectionInjected, AgentModeSectionProps } from './AgentModeSection.tsx'
export type { AgentModeSeatInjected, AgentModeSeatProps } from './AgentModeSeat.tsx'
export type { AgentModeLabelInjected, AgentModeLabelProps } from './AgentModeLabel.tsx'
export type { ScenarioDockInjected, ScenarioDockProps } from './ScenarioDock.tsx'
export type {
  AgentModeSectionState, ComposeDraft, CopyDraft, CreateDraft, ModeRow, PresetOption, TryRunState,
} from './section-store.ts'
export type { AgentModeSeatState, ScenarioOption } from './mode-seat-store.ts'
export type { ScenarioPhase, ScenarioRunState } from './scenario-run-store.ts'
export { copyBlocker, createBlocker, defaultBindPreset, slugifyModeId } from './section-store.ts'
export { scenarioLabel } from './mode-seat-store.ts'
export { AgentModeSeatController } from './mode-seat-store.ts'
export { ScenarioRunController } from './scenario-run-store.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'locale', 'remote', 'remote.agentModes', 'remote.agentPresets', 'router',
]

/**
 * Read one query value from a URL search string.
 * @param search - `location.search`.
 * @param key - parameter name.
 * @returns trimmed value, or undefined when absent/empty.
 */
function searchParam(search: string, key: string): string | undefined {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(key)
  if (raw === null || raw.trim() === '') return undefined
  return raw.trim()
}

/**
 * Mount the Agent hub Orchestration tab (scenarios author here; sessions bind capabilities).
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  let creatorDraft: (() => void) | undefined
  let useForSession: ((modeId: string) => void) | undefined
  let cordisAvailable = false

  const section = new AgentModeSectionController(
    ctx.remote,
    () => undefined,
    () => ctx.get('sessions')?.list.getSnapshot().current,
  )

  ctx.effect(() => ctx.locale.register('settings.agentMode', { zh, en }), 'ui-agent-mode: dictionaries')

  // Deep-link `?tab=modes&mode=` opens the orchestration canvas (and strips
  // `mode` so a refresh does not re-open after the user closes it).
  ctx.effect(() => {
    let opening = false
    const consume = (): void => {
      if (opening) return
      const snap = ctx.router.getSnapshot()
      if (snap.pathname !== '/settings/agent') return
      if (searchParam(snap.search, 'tab') !== 'modes') return
      const modeId = searchParam(snap.search, 'mode')
      if (modeId === undefined) return
      opening = true
      void (async () => {
        try {
          await section.load()
          if (section.store.getSnapshot().modes.some(mode => mode.id === modeId)) {
            await section.beginCompose(modeId)
          }
          ctx.router.navigate('/settings/agent?tab=modes', { replace: true })
        } finally {
          opening = false
        }
      })()
    }
    consume()
    return ctx.router.subscribe(consume)
  }, 'ui-agent-mode: mode deep link')

  // Creator handoff + "use for new session" need sessions / workspace.
  // Sessions bind capabilities only; scenarios stay in settings and stage the
  // mode's bound preset onto a new blank session.
  ctx.inject(['sessions', 'uiWorkspace', 'remote.agentPresets', 'remote.agentModes'], (scope) => {
    const refreshCordis = (): void => {
      void scope.remote.agentPresets.list().then((result) => {
        cordisAvailable = result.ok && result.value.presets.some(preset => preset.id === 'cordis')
      })
    }
    refreshCordis()
    scope.effect(() => {
      const onReset = scope.on('connection/reset', refreshCordis)
      creatorDraft = () => {
        if (!cordisAvailable) return
        const before = scope.sessions.list.getSnapshot().current
        const stop = scope.sessions.list.subscribe(() => {
          const state = scope.sessions.list.getSnapshot()
          if (state.current === undefined || state.current === before) return
          const summary = state.byId[state.current]
          if (summary === undefined || !summary.blank) return
          stop()
          void scope.remote.agentPresets.select(summary.id, 'cordis')
        })
        scope.uiWorkspace.startSession()
      }
      useForSession = (modeId: string) => {
        const before = scope.sessions.list.getSnapshot().current
        const stop = scope.sessions.list.subscribe(() => {
          const state = scope.sessions.list.getSnapshot()
          if (state.current === undefined || state.current === before) return
          const summary = state.byId[state.current]
          if (summary === undefined || !summary.blank) return
          stop()
          // Stamp agentMode and mount the bound preset together — preset-only
          // select would leave orchestration unbound for startEntry.
          void scope.remote.agentModes.select(summary.id, modeId)
        })
        scope.uiWorkspace.startSession()
        ctx.router.navigate('/')
      }
      return () => {
        onReset()
        creatorDraft = undefined
        useForSession = undefined
      }
    }, 'ui-agent-mode: creator handoff and use-for-session')
  })

  const sectionInjected = (): AgentModeSectionInjected => ({
    hooks: { agentModeSection: section.store },
    load: () => section.load(),
    beginCreate: () =>{  section.beginCreate() },
    cancelCreate: () =>{  section.cancelCreate() },
    setCreateField: (field, value) =>{  section.setCreateField(field, value) },
    confirmCreate: () => section.confirmCreate(),
    beginCopy: (id) =>{  section.beginCopy(id) },
    cancelCopy: () =>{  section.cancelCopy() },
    setCopyId: (id) =>{  section.setCopyId(id) },
    setCopyName: (name) =>{  section.setCopyName(name) },
    confirmCopy: () => section.confirmCopy(),
    confirmDelete: (id) =>{  section.confirmDelete(id) },
    remove: () => section.remove(),
    beginCompose: id => section.beginCompose(id),
    closeCompose: () =>{  section.closeCompose() },
    setComposePreset: (preset) =>{  section.setComposePreset(preset) },
    setComposeName: (name) =>{  section.setComposeName(name) },
    setComposeDescription: (description) =>{  section.setComposeDescription(description) },
    saveBind: () => section.saveBind(),
    selectNode: (id) =>{  section.selectNode(id) },
    selectEdge: (id) =>{  section.selectEdge(id) },
    moveNode: (id, position) =>{  section.moveNode(id, position) },
    addNodeAt: (data, position) => section.addNodeAt(data, position),
    addEdge: (from, to) =>{  section.addEdge(from, to) },
    removeNode: (id) =>{  section.removeNode(id) },
    removeEdge: (id) =>{  section.removeEdge(id) },
    addAfter: (afterId, type) => section.addAfter(afterId, type),
    insertBetween: (from, to, type) => section.insertBetween(from, to, type),
    setSelectedPrompt: (prompt) =>{  section.setSelectedPrompt(prompt) },
    setSelectedSystemPrompt: (systemPrompt) =>{  section.setSelectedSystemPrompt(systemPrompt) },
    setSelectedModel: (model) =>{  section.setSelectedModel(model) },
    setSelectedProvider: (provider) =>{  section.setSelectedProvider(provider) },
    setSelectedChildPresetId: (id) =>{  section.setSelectedChildPresetId(id) },
    setSelectedExpression: (expression) =>{  section.setSelectedExpression(expression) },
    setSelectedIterable: (iterable) =>{  section.setSelectedIterable(iterable) },
    setSelectedVariable: (variable) =>{  section.setSelectedVariable(variable) },
    setSelectedUrl: (url) =>{  section.setSelectedUrl(url) },
    setSelectedTemplate: (template) =>{  section.setSelectedTemplate(template) },
    setSelectedSource: (source) =>{  section.setSelectedSource(source) },
    setSelectedAggregateItems: (text) =>{  section.setSelectedAggregateItems(text) },
    setSelectedAggregateMode: (mode) =>{  section.setSelectedAggregateMode(mode) },
    setSelectedListSource: (source) =>{  section.setSelectedListSource(source) },
    setSelectedListOp: (op) =>{  section.setSelectedListOp(op) },
    setSelectedClassifyQuery: (query) =>{  section.setSelectedClassifyQuery(query) },
    setSelectedClassifyClasses: (text) =>{  section.setSelectedClassifyClasses(text) },
    setSelectedExtractQuery: (query) =>{  section.setSelectedExtractQuery(query) },
    setSelectedExtractParams: (text) =>{  section.setSelectedExtractParams(text) },
    saveCompose: () => section.saveCompose(),
    saveAll: () => section.saveAll(),
    tryRun: seed => section.tryRun(seed),
    openBoundPreset: (presetId: string) => {
      ctx.router.navigate(`/settings/agent?tab=presets&preset=${encodeURIComponent(presetId)}`)
    },
    ...useForSession === undefined
      ? {}
      : {
        useForSession: (modeId: string) => {
          useForSession?.(modeId)
        },
      },
    ...(!cordisAvailable || creatorDraft === undefined)
      ? {}
      : { startCreatorDraft: creatorDraft },
  })

  ctx.slots.inject('settings.agent.tab', () => ctx.slots.register({
    name: 'settings.agent.tab',
    id: 'modes',
    order: 10,
    label: () => ctx.locale.bind('settings.agentMode')('section.tabLabel'),
    locale: 'settings.agentMode',
    inject: sectionInjected,
  }, AgentModeSection))
}
