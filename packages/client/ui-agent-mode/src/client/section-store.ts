/**
 * Agent-mode settings section store: roster + orchestration draft + try-run.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { FlowGraph, FlowNode, FlowNodeStatus, FlowRunSnapshot } from '@deepseek-ai/dsh-flow/types'
import type { AgentModeRow, AgentModeRoster } from '@deepseek-ai/dsh-agent-modes/types'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-presets/types'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import {
  addAfter as graphAddAfter,
  addEdge as graphAddEdge,
  addNodeAt as graphAddNodeAt,
  insertBetween as graphInsertBetween,
  parseAggregateItems,
  parseAggregateMode,
  parseClassifyClasses,
  parseExtractParams,
  parseListOp,
  parsePlaceableType,
  removeEdge as graphRemoveEdge,
  removeNode as graphRemoveNode,
  type PlaceableNodeType,
} from './mode-graph.ts'

/** One roster row as the section renders it. */
export type ModeRow = AgentModeRow

/** One selectable agent preset for bind / child-preset pickers. */
export type PresetOption = Pick<AgentPresetRow, 'id' | 'trust' | 'isDefault' | 'name' | 'description' | 'broken'>

/** Copy dialog draft. */
export interface CopyDraft {
  readonly from: string
  id: string
  name: string
  busy: boolean
  error?: string
}

/** Create-new-mode dialog draft. */
export interface CreateDraft {
  id: string
  name: string
  description: string
  preset: string
  busy: boolean
  error?: string
}

/** Live try-run status painted on the canvas. */
export interface TryRunState {
  readonly runId: string
  readonly status: FlowRunSnapshot['status']
  readonly nodeStatuses: Readonly<Record<string, FlowNodeStatus>>
  readonly nodeOutputs?: FlowRunSnapshot['nodeOutputs']
  readonly nodeInputs?: FlowRunSnapshot['nodeInputs']
  readonly nodeDurationsMs?: FlowRunSnapshot['nodeDurationsMs']
  readonly error?: string
  readonly polling: boolean
}

/** Orchestration editor draft over one mode's entry flow. */
export interface ComposeDraft {
  readonly agentMode: string
  readonly trust: 'system' | 'user'
  preset: string
  name: string
  description: string
  bindDirty: boolean
  graph: FlowGraph
  selectedNodeId: string | null
  selectedEdgeId: string | null
  busy: boolean
  error?: string
  dirty: boolean
  tryRun?: TryRunState
  /**
   * Live structural findings for the current graph, refreshed after every
   * edit — the Checklist the composer shows before Publish. `undefined`
   * until the first check returns; an empty array means the graph is valid.
   */
  checklist?: readonly string[]
}

/** Section snapshot. */
export interface AgentModeSectionState {
  loading: boolean
  modes: ModeRow[]
  presets: PresetOption[]
  authorable: boolean
  error?: string
  copy?: CopyDraft
  create?: CreateDraft
  compose?: ComposeDraft
  /** User mode awaiting delete confirmation. */
  pendingDelete?: string
}

/** Remote face the section drives. */
export interface AgentModeRemoteFace {
  agentModes: {
    list(): Promise<{ ok: true; value: AgentModeRoster } | { ok: false; error: { code: string; message: string } }>
    read(agentMode: string): Promise<
      | {
        ok: true
        value: {
          agentMode: string
          trust: 'system' | 'user'
          entryGraph: FlowGraph
          bind: { preset: string; entryFlow: string }
          name?: string
          description?: string
        }
      }
      | { ok: false; error: { code: string; message: string } }
    >
    saveFlow(agentMode: string, graph: FlowGraph): Promise<
      | { ok: true; value: { agentMode: string } }
      | { ok: false; error: { code: string; message: string } }
    >
    create(id: string, preset: string, name?: string, description?: string): Promise<
      | { ok: true; value: { agentMode: string } }
      | { ok: false; error: { code: string; message: string } }
    >
    saveBind(agentMode: string, preset: string, name?: string, description?: string): Promise<
      | { ok: true; value: { agentMode: string } }
      | { ok: false; error: { code: string; message: string } }
    >
    copy(from: string, id: string, name?: string): Promise<
      | { ok: true; value: void }
      | { ok: false; error: { code: string; message: string } }
    >
    deleteMode(id: string): Promise<
      | { ok: true; value: void }
      | { ok: false; error: { code: string; message: string } }
    >
    validate(graph: FlowGraph): Promise<
      | { ok: true; value: { errors: readonly string[] } }
      | { ok: false; error: { code: string; message: string } }
    >
    tryRun(sessionId: SessionId, graph: FlowGraph, input?: unknown, seed?: Record<string, JsonValue>): Promise<
      | { ok: true; value: { runId: string } }
      | { ok: false; error: { code: string; message: string } }
    >
    getTryRun(runId: string): Promise<
      | { ok: true; value: { run: FlowRunSnapshot | null } }
      | { ok: false; error: { code: string; message: string } }
    >
  }
  agentPresets: {
    list(): Promise<
      | { ok: true; value: { presets: readonly AgentPresetRow[] } }
      | { ok: false; error: { code: string; message: string } }
    >
  }
}

/** How the section learns the current session for try-run. */
export type CurrentSessionId = () => SessionId | undefined

const TRY_RUN_POLL_MS = 800

/** Debounce before re-checking the Checklist after an edit. */
const CHECKLIST_DEBOUNCE_MS = 400

/** Same containment rule the Host enforces for mode directory names. */
const MODE_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Turn free-form text into a mode id the Host accepts.
 * CamelCase, spaces, and underscores become kebab-case; other characters drop.
 * @param raw - whatever the user typed or pasted.
 * @returns a kebab-case candidate (may still be empty).
 */
export function slugifyModeId(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Why create cannot submit yet, as a locale key.
 * @param draft - the open create dialog.
 * @param modes - roster, for collision checks.
 * @returns the blocking reason, or undefined when submittable.
 */
export function createBlocker(
  draft: CreateDraft,
  modes: readonly ModeRow[],
): 'idRequired' | 'idInvalid' | 'idTaken' | 'presetRequired' | undefined {
  const id = draft.id.trim()
  if (id === '') return 'idRequired'
  if (!MODE_ID.test(id)) return 'idInvalid'
  if (modes.some(mode => mode.id === id)) return 'idTaken'
  if (draft.preset.trim() === '') return 'presetRequired'
  return undefined
}

/**
 * Why copy cannot submit yet, as a locale key.
 * @param draft - the open copy dialog.
 * @param modes - roster, for collision checks.
 * @returns the blocking reason, or undefined when submittable.
 */
export function copyBlocker(
  draft: CopyDraft,
  modes: readonly ModeRow[],
): 'idRequired' | 'idInvalid' | 'idTaken' | undefined {
  const id = draft.id.trim()
  if (id === '') return 'idRequired'
  if (!MODE_ID.test(id)) return 'idInvalid'
  if (modes.some(mode => mode.id === id)) return 'idTaken'
  return undefined
}

/**
 * Pick the preset a new mode should bind by default.
 * @param presets - the loaded roster.
 * @returns a healthy default id, or empty when none are usable.
 */
export function defaultBindPreset(presets: readonly PresetOption[]): string {
  const healthy = presets.filter(preset => preset.broken === undefined)
  return healthy.find(preset => preset.isDefault)?.id
    ?? healthy.find(preset => preset.id === 'standard')?.id
    ?? healthy[0]?.id
    ?? ''
}

/** Controller for the agent-mode settings section. */
export class AgentModeSectionController {
  readonly store: SnapshotStore<AgentModeSectionState>

  private pollTimer: ReturnType<typeof setInterval> | undefined
  private checklistTimer: ReturnType<typeof setTimeout> | undefined
  /** Guards a checklist response against a graph edited since the request went out. */
  private checklistGeneration = 0

  constructor(
    private readonly remote: AgentModeRemoteFace,
    private readonly onRosterChange: () => void,
    private readonly currentSessionId: CurrentSessionId = () => undefined,
  ) {
    this.store = createSnapshotStore<AgentModeSectionState>({
      loading: false,
      modes: [],
      presets: [],
      authorable: false,
    })
  }

  /** Load the mode roster and the preset picker options. */
  async load(): Promise<void> {
    this.store.update((draft) => {
      draft.loading = true
      delete draft.error
    })
    const [modesResult, presetsResult] = await Promise.all([
      this.remote.agentModes.list(),
      this.remote.agentPresets.list(),
    ])
    if (!modesResult.ok) {
      this.store.update((draft) => {
        draft.loading = false
        draft.error = modesResult.error.message
      })
      return
    }
    const presets = presetsResult.ok
      ? presetsResult.value.presets.map((preset): PresetOption => ({
        id: preset.id,
        trust: preset.trust,
        isDefault: preset.isDefault,
        ...preset.name === undefined ? {} : { name: preset.name },
        ...preset.description === undefined ? {} : { description: preset.description },
        ...preset.broken === undefined ? {} : { broken: preset.broken },
      }))
      : []
    this.store.update((draft) => {
      draft.loading = false
      draft.modes = modesResult.value.modes as ModeRow[]
      draft.presets = presets
      draft.authorable = modesResult.value.authorable
      delete draft.error
    })
  }

  /** Open the create dialog. */
  beginCreate(): void {
    const presets = this.store.getSnapshot().presets
    this.store.update((draft) => {
      draft.create = {
        id: '',
        name: '',
        description: '',
        preset: defaultBindPreset(presets),
        busy: false,
      }
    })
  }

  /** Close the create dialog. */
  cancelCreate(): void {
    this.store.update((draft) => { delete draft.create })
  }

  /** Edit create-dialog fields. Mode ids are slugified as the user types. */
  setCreateField(field: 'id' | 'name' | 'description' | 'preset', value: string): void {
    this.store.update((draft) => {
      if (draft.create === undefined) return
      if (field === 'id') {
        draft.create.id = slugifyModeId(value)
        return
      }
      draft.create[field] = value
    })
  }

  /** Confirm create. */
  async confirmCreate(): Promise<void> {
    const state = this.store.getSnapshot()
    const draft = state.create
    if (draft === undefined || draft.busy) return
    if (createBlocker(draft, state.modes) !== undefined) return
    this.store.update((next) => {
      if (next.create !== undefined) {
        next.create.busy = true
        delete next.create.error
      }
    })
    const name = draft.name.trim()
    const description = draft.description.trim()
    const result = await this.remote.agentModes.create(
      draft.id.trim(),
      draft.preset.trim(),
      name === '' ? undefined : name,
      description === '' ? undefined : description,
    )
    if (!result.ok) {
      this.store.update((state) => {
        if (state.create !== undefined) {
          state.create.busy = false
          state.create.error = result.error.message
        }
      })
      return
    }
    const createdId = result.value.agentMode
    this.store.update((state) => { delete state.create })
    await this.load()
    this.onRosterChange()
    await this.beginCompose(createdId)
  }

  /** Open the copy dialog. */
  beginCopy(from: string): void {
    this.store.update((draft) => {
      draft.copy = { from, id: `${from}-copy`, name: '', busy: false }
    })
  }

  /** Close the copy dialog. */
  cancelCopy(): void {
    this.store.update((draft) => { delete draft.copy })
  }

  /** Edit the copy id (slugified). */
  setCopyId(id: string): void {
    this.store.update((draft) => {
      if (draft.copy !== undefined) draft.copy.id = slugifyModeId(id)
    })
  }

  /** Edit the copy display name. */
  setCopyName(name: string): void {
    this.store.update((draft) => {
      if (draft.copy !== undefined) draft.copy.name = name
    })
  }

  /** Confirm the copy. */
  async confirmCopy(): Promise<void> {
    const state = this.store.getSnapshot()
    const draft = state.copy
    if (draft === undefined || draft.busy) return
    if (copyBlocker(draft, state.modes) !== undefined) return
    this.store.update((next) => {
      if (next.copy !== undefined) {
        next.copy.busy = true
        delete next.copy.error
      }
    })
    const name = draft.name.trim()
    const result = await this.remote.agentModes.copy(
      draft.from,
      draft.id.trim(),
      name === '' ? undefined : name,
    )
    if (!result.ok) {
      this.store.update((state) => {
        if (state.copy !== undefined) {
          state.copy.busy = false
          state.copy.error = result.error.message
        }
      })
      return
    }
    this.store.update((state) => { delete state.copy })
    await this.load()
    this.onRosterChange()
  }

  /** Stage or dismiss delete confirmation. */
  confirmDelete(id: string | null): void {
    this.store.update((draft) => {
      if (id === null) delete draft.pendingDelete
      else draft.pendingDelete = id
    })
  }

  /** Delete the mode awaiting confirmation. */
  async remove(): Promise<void> {
    const id = this.store.getSnapshot().pendingDelete
    if (id === undefined) return
    const result = await this.remote.agentModes.deleteMode(id)
    if (!result.ok) {
      this.store.update((draft) => {
        draft.error = result.error.message
        delete draft.pendingDelete
      })
      return
    }
    this.store.update((draft) => { delete draft.pendingDelete })
    await this.load()
    this.onRosterChange()
  }

  /** Open the orchestration canvas for a mode's entry flow. */
  async beginCompose(agentMode: string): Promise<void> {
    this.stopPolling()
    const result = await this.remote.agentModes.read(agentMode)
    if (!result.ok) {
      this.store.update((draft) => { draft.error = result.error.message })
      return
    }
    this.store.update((draft) => {
      draft.compose = {
        agentMode: result.value.agentMode,
        trust: result.value.trust,
        preset: result.value.bind.preset,
        name: result.value.name ?? '',
        description: result.value.description ?? '',
        bindDirty: false,
        graph: result.value.entryGraph,
        selectedNodeId: null,
        selectedEdgeId: null,
        busy: false,
        dirty: false,
      }
      delete draft.error
    })
    void this.refreshChecklist()
  }

  /** Edit the bound preset while composing. */
  setComposePreset(preset: string): void {
    this.store.update((draft) => {
      if (draft.compose === undefined || draft.compose.trust !== 'user') return
      draft.compose.preset = preset
      draft.compose.bindDirty = true
    })
  }

  /** Edit display name while composing. */
  setComposeName(name: string): void {
    this.store.update((draft) => {
      if (draft.compose === undefined || draft.compose.trust !== 'user') return
      draft.compose.name = name
      draft.compose.bindDirty = true
    })
  }

  /** Edit description while composing. */
  setComposeDescription(description: string): void {
    this.store.update((draft) => {
      if (draft.compose === undefined || draft.compose.trust !== 'user') return
      draft.compose.description = description
      draft.compose.bindDirty = true
    })
  }

  /** Persist bind + display metadata. */
  async saveBind(): Promise<boolean> {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.busy || draft.trust !== 'user' || !draft.bindDirty) {
      return false
    }
    this.store.update((state) => {
      if (state.compose !== undefined) {
        state.compose.busy = true
        delete state.compose.error
      }
    })
    const result = await this.remote.agentModes.saveBind(
      draft.agentMode,
      draft.preset.trim(),
      draft.name,
      draft.description,
    )
    if (!result.ok) {
      this.store.update((state) => {
        if (state.compose !== undefined) {
          state.compose.busy = false
          state.compose.error = result.error.message
        }
      })
      return false
    }
    this.store.update((state) => {
      if (state.compose !== undefined) {
        state.compose.busy = false
        state.compose.bindDirty = false
      }
    })
    await this.load()
    this.onRosterChange()
    return true
  }

  /** Close the orchestration canvas. */
  closeCompose(): void {
    this.stopPolling()
    this.stopChecklistTimer()
    this.store.update((draft) => { delete draft.compose })
  }

  /** Select a node on the canvas. */
  selectNode(id: string | null): void {
    this.store.update((draft) => {
      if (draft.compose === undefined) return
      draft.compose.selectedNodeId = id
      draft.compose.selectedEdgeId = null
    })
  }

  /** Select an edge on the canvas. */
  selectEdge(id: string | null): void {
    this.store.update((draft) => {
      if (draft.compose === undefined) return
      draft.compose.selectedEdgeId = id
      draft.compose.selectedNodeId = null
    })
  }

  /** Move a node. */
  moveNode(id: string, position: { x: number; y: number }): void {
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map(node => node.id === id ? { ...node, position } : node),
    }))
  }

  /**
   * Drop a palette node onto the canvas.
   * @param data - placeable type payload.
   * @param position - drop position.
   * @returns the new node id, or undefined when refused.
   */
  addNodeAt(data: string, position: { x: number; y: number }): string | undefined {
    const type = parsePlaceableType(data)
    if (type === undefined) return undefined
    let created: string | undefined
    this.patchGraph((graph) => {
      const result = graphAddNodeAt(graph, type, position)
      created = result.nodeId
      return result.graph
    })
    if (created !== undefined) this.selectNode(created)
    return created
  }

  /**
   * Draw an edge between two nodes.
   * @param from - source node id.
   * @param to - target node id.
   */
  addEdge(from: string, to: string): void {
    this.patchGraph(graph => graphAddEdge(graph, from, to))
  }

  /**
   * Remove a placeable node (start/end are refused).
   * @param id - node id.
   */
  removeNode(id: string): void {
    this.patchGraph(graph => graphRemoveNode(graph, id))
    const draft = this.store.getSnapshot().compose
    if (draft?.selectedNodeId === id) this.selectNode(null)
  }

  /**
   * Remove an edge.
   * @param id - edge id.
   */
  removeEdge(id: string): void {
    this.patchGraph(graph => graphRemoveEdge(graph, id))
    const draft = this.store.getSnapshot().compose
    if (draft?.selectedEdgeId === id) this.selectEdge(null)
  }

  /**
   * Insert a placeable node after an anchor (node "+" control).
   * @param afterId - anchor node.
   * @param type - placeable kind.
   * @returns the new node id, or undefined when refused.
   */
  addAfter(afterId: string, type: PlaceableNodeType): string | undefined {
    let created: string | undefined
    this.patchGraph((graph) => {
      const result = graphAddAfter(graph, afterId, type)
      if (result === undefined) return graph
      created = result.nodeId
      return result.graph
    })
    if (created !== undefined) this.selectNode(created)
    return created
  }

  /**
   * Insert a placeable node on an edge (edge midpoint "+").
   * @param from - edge source.
   * @param to - edge target.
   * @param type - placeable kind.
   * @returns the new node id, or undefined when refused.
   */
  insertBetween(from: string, to: string, type: PlaceableNodeType): string | undefined {
    let created: string | undefined
    this.patchGraph((graph) => {
      const result = graphInsertBetween(graph, from, to, type)
      if (result === undefined) return graph
      created = result.nodeId
      return result.graph
    })
    if (created !== undefined) this.selectNode(created)
    return created
  }

  /** Update the selected agent node's prompt. */
  setSelectedPrompt(prompt: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'agent') return node
        return { ...node, prompt }
      }),
    }))
  }

  /**
   * Update the selected agent node's optional system prompt.
   * Empty string clears the property (legacy graphs omit it).
   * @param systemPrompt - SYSTEM text, or '' to omit.
   */
  setSelectedSystemPrompt(systemPrompt: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'agent') return node
        if (systemPrompt === '') {
          if (node.systemPrompt === undefined) return node
          const { systemPrompt: _drop, ...rest } = node
          return rest
        }
        return { ...node, systemPrompt }
      }),
    }))
  }

  /** Update the selected agent node's model. */
  setSelectedModel(model: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'agent') return node
        const trimmed = model.trim()
        if (trimmed === '') {
          if (node.agentOptions === undefined) return node
          const { model: _drop, ...rest } = node.agentOptions
          if (Object.keys(rest).length === 0) {
            const { agentOptions: _opts, ...without } = node
            return without
          }
          return { ...node, agentOptions: rest }
        }
        return {
          ...node,
          agentOptions: { ...node.agentOptions, model: trimmed },
        }
      }),
    }))
  }

  /** Update the selected agent node's provider. */
  setSelectedProvider(provider: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'agent') return node
        const trimmed = provider.trim()
        if (trimmed === '') {
          if (node.agentOptions === undefined) return node
          const { provider: _drop, ...rest } = node.agentOptions
          if (Object.keys(rest).length === 0) {
            const { agentOptions: _opts, ...without } = node
            return without
          }
          return { ...node, agentOptions: rest }
        }
        return {
          ...node,
          agentOptions: { ...node.agentOptions, provider: trimmed },
        }
      }),
    }))
  }

  /** Update the selected agent node's childPresetId. */
  setSelectedChildPresetId(childPresetId: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'agent') return node
        const trimmed = childPresetId.trim()
        if (trimmed === '') {
          const { childPresetId: _drop, ...rest } = node
          return rest
        }
        return { ...node, childPresetId: trimmed }
      }),
    }))
  }

  /** Update the selected condition node's expression. */
  setSelectedExpression(expression: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'condition') return node
        return { ...node, expression }
      }),
    }))
  }

  /** Update the selected loop node's iterable expression. */
  setSelectedIterable(iterable: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'loop') return node
        return { ...node, iterable }
      }),
    }))
  }

  /** Update the selected loop node's variable name. */
  setSelectedVariable(variable: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'loop') return node
        return { ...node, variable }
      }),
    }))
  }

  /** Update the selected http node's request URL. */
  setSelectedUrl(url: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'http') return node
        return { ...node, url }
      }),
    }))
  }

  /** Update the selected template node's template source. */
  setSelectedTemplate(template: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'template') return node
        return { ...node, template }
      }),
    }))
  }

  /** Update the selected aggregate node's items from inspector textarea text. */
  setSelectedAggregateItems(text: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    const items = parseAggregateItems(text)
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'aggregate') return node
        return { ...node, items }
      }),
    }))
  }

  /** Update the selected aggregate node's combine mode. */
  setSelectedAggregateMode(mode: string): void {
    const parsed = parseAggregateMode(mode)
    const draft = this.store.getSnapshot().compose
    if (parsed === undefined || draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'aggregate') return node
        return { ...node, mode: parsed }
      }),
    }))
  }

  /** Update the selected list node's source expression. */
  setSelectedListSource(source: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'list') return node
        return { ...node, source }
      }),
    }))
  }

  /** Update the selected list node's operator. */
  setSelectedListOp(op: string): void {
    const parsed = parseListOp(op)
    const draft = this.store.getSnapshot().compose
    if (parsed === undefined || draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'list') return node
        return { ...node, op: parsed }
      }),
    }))
  }

  /** Update the selected classify node's query. */
  setSelectedClassifyQuery(query: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'classify') return node
        return { ...node, query }
      }),
    }))
  }

  /** Update the selected classify node's classes from inspector textarea text. */
  setSelectedClassifyClasses(text: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    const classes = parseClassifyClasses(text)
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'classify') return node
        return { ...node, classes }
      }),
    }))
  }

  /** Update the selected extract node's query. */
  setSelectedExtractQuery(query: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'extract') return node
        return { ...node, query }
      }),
    }))
  }

  /** Update the selected extract node's parameters from inspector textarea text. */
  setSelectedExtractParams(text: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    const parameters = parseExtractParams(text)
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'extract') return node
        return { ...node, parameters }
      }),
    }))
  }

  /** Update the selected code node's program source. */
  setSelectedSource(source: string): void {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.selectedNodeId === null) return
    const selectedId = draft.selectedNodeId
    this.patchGraph(graph => ({
      ...graph,
      nodes: graph.nodes.map((node): FlowNode => {
        if (node.id !== selectedId || node.type !== 'code') return node
        return { ...node, source }
      }),
    }))
  }

  /** Persist the draft graph. */
  async saveCompose(): Promise<boolean> {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.busy || draft.trust !== 'user') return false
    this.store.update((state) => {
      if (state.compose !== undefined) {
        state.compose.busy = true
        delete state.compose.error
      }
    })
    const result = await this.remote.agentModes.saveFlow(draft.agentMode, draft.graph)
    if (!result.ok) {
      this.store.update((state) => {
        if (state.compose !== undefined) {
          state.compose.busy = false
          state.compose.error = result.error.message
        }
      })
      return false
    }
    this.store.update((state) => {
      if (state.compose !== undefined) {
        state.compose.busy = false
        state.compose.dirty = false
      }
    })
    return true
  }

  /**
   * Persist bind metadata and/or the entry flow when either side is dirty.
   * @returns true when every dirty side saved (or nothing was dirty).
   */
  async saveAll(): Promise<boolean> {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.busy || draft.trust !== 'user') return false
    if (draft.bindDirty) {
      if (!await this.saveBind()) return false
    }
    const afterBind = this.store.getSnapshot().compose
    if (afterBind === undefined) return false
    if (afterBind.dirty) {
      if (!await this.saveCompose()) return false
    }
    return true
  }

  /**
   * Try-run the draft graph under the current session's agent.
   * @param seed - optional Variable Inspector seed (skip seeded nodes).
   * @returns once the run started or refused.
   */
  async tryRun(seed?: Record<string, JsonValue>): Promise<void> {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined || draft.busy) return
    const sessionId = this.currentSessionId()
    if (sessionId === undefined) {
      this.store.update((state) => {
        if (state.compose !== undefined) {
          state.compose.error = 'try-run needs an open session to attribute child agents'
        }
      })
      return
    }
    this.stopPolling()
    this.store.update((state) => {
      if (state.compose !== undefined) {
        state.compose.busy = true
        delete state.compose.error
        delete state.compose.tryRun
      }
    })
    const result = await this.remote.agentModes.tryRun(
      sessionId,
      draft.graph,
      undefined,
      seed,
    )
    if (!result.ok) {
      this.store.update((state) => {
        if (state.compose !== undefined) {
          state.compose.busy = false
          state.compose.error = result.error.message
        }
      })
      return
    }
    this.store.update((state) => {
      if (state.compose !== undefined) {
        state.compose.busy = false
        state.compose.tryRun = {
          runId: result.value.runId,
          status: 'running',
          nodeStatuses: {},
          polling: true,
        }
      }
    })
    this.startPolling(result.value.runId)
  }

  private startPolling(runId: string): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => {
      void this.pollTryRun(runId)
    }, TRY_RUN_POLL_MS)
    void this.pollTryRun(runId)
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return
    clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  private async pollTryRun(runId: string): Promise<void> {
    const result = await this.remote.agentModes.getTryRun(runId)
    if (!result.ok) {
      this.stopPolling()
      this.store.update((state) => {
        if (state.compose?.tryRun?.runId !== runId) return
        state.compose.tryRun = {
          ...state.compose.tryRun,
          polling: false,
          error: result.error.message,
        }
      })
      return
    }
    const run = result.value.run
    if (run === null) {
      this.stopPolling()
      this.store.update((state) => {
        if (state.compose?.tryRun?.runId !== runId) return
        state.compose.tryRun = {
          ...state.compose.tryRun,
          polling: false,
          error: 'try-run snapshot was pruned',
        }
      })
      return
    }
    const settled = run.status !== 'running'
    if (settled) this.stopPolling()
    this.store.update((state) => {
      if (state.compose?.tryRun?.runId !== runId) return
      state.compose.tryRun = {
        runId,
        status: run.status,
        nodeStatuses: run.nodeStatuses,
        polling: !settled,
        ...run.error === undefined ? {} : { error: run.error },
        ...run.nodeOutputs === undefined ? {} : { nodeOutputs: run.nodeOutputs },
        ...run.nodeInputs === undefined ? {} : { nodeInputs: run.nodeInputs },
        ...run.nodeDurationsMs === undefined ? {} : { nodeDurationsMs: run.nodeDurationsMs },
      }
    })
  }

  private patchGraph(map: (graph: FlowGraph) => FlowGraph): void {
    this.store.update((draft) => {
      if (draft.compose === undefined || draft.compose.trust !== 'user') return
      draft.compose.graph = map(draft.compose.graph)
      draft.compose.dirty = true
    })
    this.scheduleChecklist()
  }

  /** Debounce a Checklist re-check after a burst of edits. */
  private scheduleChecklist(): void {
    this.stopChecklistTimer()
    this.checklistTimer = setTimeout(() => {
      this.checklistTimer = undefined
      void this.refreshChecklist()
    }, CHECKLIST_DEBOUNCE_MS)
  }

  private stopChecklistTimer(): void {
    if (this.checklistTimer === undefined) return
    clearTimeout(this.checklistTimer)
    this.checklistTimer = undefined
  }

  /** Re-check the current draft graph and record its findings. */
  private async refreshChecklist(): Promise<void> {
    const draft = this.store.getSnapshot().compose
    if (draft === undefined) return
    const generation = ++this.checklistGeneration
    const result = await this.remote.agentModes.validate(draft.graph)
    if (generation !== this.checklistGeneration) return // superseded by a later edit
    this.store.update((state) => {
      if (state.compose === undefined) return
      state.compose.checklist = result.ok ? result.value.errors : [`checklist unavailable: ${result.error.message}`]
    })
  }
}
