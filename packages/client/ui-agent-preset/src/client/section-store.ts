/**
 * Agent-preset management controller: the roster as a list, a copy dialog as
 * one way a preset is created, a flow-graph composer as the other, and a
 * read-only canvas view over the shipped compositions.
 *
 * The browser writes no composition text. Creation is either a host-side copy
 * of an existing preset (`{ from, id, name? }` is all that crosses the wire) or
 * a validated COMPOSITION GRAPH the composer assembles — each agent node names
 * an installed plugin module, the host re-checks that against its own inventory
 * and derives the rows from the graph, and an overwrite is refused for presets
 * that ship with the deployment. Everything else happens in the preset's own
 * files, which is why the page's other job is getting the user TO those files:
 * open the directory where the host has a desktop, show its path where it does
 * not.
 *
 * The host stays the single fact source. Every mutation writes through the
 * wire and the page re-reads the roster afterwards, because a copy or a
 * composition changes more than the row it targeted.
 */

import type {
  IApiClient, ModelCatalogFailure, ModelKind, ModelProviderGroup,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  cascadePosition, chainAddModule, chainAgents, chainMoveIndex, chainMoveNode,
  chainRemoveNode, chainReorder, emptyChainGraph, graphLayoutEqual, graphRows, setAgentModelKind,
} from './preset-graph.ts'
import { beginRosterRead, messageOf, writeDefaultPreset } from './settings-store.ts'

export { rowIdFor } from './preset-graph.ts'

/** Ids a preset directory may be named, mirroring the host's own rule. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** One preset row the page renders. */
export interface PresetRow {
  /** Preset id and directory name; the display name falls back to it. */
  id: string
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
  /** Whether the preset ships with the deployment or was authored locally. */
  trust: 'system' | 'user'
  /** Whether a session that names no preset gets this one. */
  isDefault: boolean
  /**
   * Why the preset cannot compose a session, absent when it can. A broken
   * row renders marked and unselectable — its directory still occupies the
   * id, so deleting it (or fixing the files) is the way out, and this page
   * is where both of those live.
   */
  broken?: string
}

/** The copy dialog: a new id and optional display name over a fixed source. */
export interface CopyDraft {
  /** The preset being copied. */
  from: string
  /** Display name of the source, for the dialog title. */
  fromTitle: string
  /** New preset id being typed; the directory name, so it is required. */
  id: string
  /** Display name being typed; empty falls back to the id. */
  name: string
  /** Whether the copy is in flight. */
  saving: boolean
  /** The last copy failure, cleared by the next edit. */
  error: string | null
}

/** The read-only composition view over one shipped preset, on the canvas. */
export interface PresetView {
  /** The preset whose composition is shown. */
  id: string
  /** Display name, for the composer head. */
  title: string
  /** The composition's graph, as the host served it. */
  graph: FlowGraph
}

/**
 * The flow-graph composer: an agent as a chain of plugin nodes on the canvas.
 * Editing an existing user preset keeps the full graph (so a preserved `config`
 * or `disabled` survives an overwrite); nodes added from the palette carry
 * none.
 */
export interface ComposeDraft {
  /** Target preset id; a free id creates, a roster id overwrites. */
  id: string
  /** Display name being typed; empty falls back to the id. */
  name: string
  /** The composition graph being edited. */
  graph: FlowGraph
  /** Whether the compose is in flight. */
  saving: boolean
  /** The last compose failure, cleared by the next edit. */
  error: string | null
  /** What the composer opened with, so an untouched draft disables Save. */
  original: { id: string; name: string; graph: FlowGraph }
}

/**
 * One installed plugin the composer palette offers, annotated with what the
 * host inventory knows about it. The display name is derived client-side; the
 * `category`/`description` come over the wire for the deployment's built-in
 * spine modules and are absent for anything else.
 */
export interface PaletteModule {
  /** The exact module specifier the row mounts. */
  moduleName: string
  /** Human-readable display name derived from the module name. */
  displayName: string
  /** Spine taxonomy category, when the inventory knows one. */
  category?: string
  /** One sentence on what the module does, when the inventory knows one. */
  description?: string
}

/** The composer's palette: the deployment's installed plugin modules. */
export interface ComposePalette {
  status: 'loading' | 'ready' | 'unavailable'
  /** Installed modules, when the inventory answered. */
  modules: readonly PaletteModule[]
}

/**
 * The configured model catalog the composer's model-kind picker reads over
 * `llm.models`. Each kind's row filters the groups by the kinds the models
 * declare, so the picker offers the models Settings actually configures rather
 * than free text.
 */
export interface ModelCatalog {
  status: 'loading' | 'ready' | 'unavailable'
  /** Provider groups in catalog order, when the host answered. */
  groups: readonly ModelProviderGroup[]
  /** Providers whose catalog lookup failed, when any did. */
  failures: readonly ModelCatalogFailure[]
}

/** Installed-plugin source for the composer palette (host inventory over RPC). */
export interface ModuleSource {
  /**
   * Installed modules in catalog order. Throws when the deployment mounts no
   * plugin inventory, so the palette degrades gracefully without disturbing an
   * edit already in progress.
   */
  list(): Promise<readonly PaletteModule[]>
}

/** Page snapshot. */
export interface AgentPresetSectionState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** Whole-load failure text; a copy failure stays on the dialog. */
  error: string | null
  /** Whether the deployment configures a root new presets can be written to. */
  authorable: boolean
  /** Whether the host can open a preset directory on a native desktop. */
  hasDocument: boolean
  /** Every preset the deployment currently supplies. */
  rows: readonly PresetRow[]
  /** The open copy dialog, or null. */
  copy: CopyDraft | null
  /** The open read-only viewer, or null. */
  view: PresetView | null
  /** The open flow-graph composer, or null. */
  composer: ComposeDraft | null
  /** The composer palette's last load; null while the composer is closed. */
  palette: ComposePalette | null
  /**
   * The model catalog for the composer's model-kind picker; null while no
   * composer overlay is open.
   */
  modelCatalog: ModelCatalog | null
  /** The preset awaiting delete confirmation. */
  pendingDelete: string | null
  /** Whether a delete is in flight. */
  deleting: boolean
  /**
   * Preset directories shown as text because the host has no desktop opener
   * — the answer `openDocument` gives instead of opening.
   */
  revealedPaths: Readonly<Record<string, string>>
}

const INITIAL: AgentPresetSectionState = {
  status: 'idle',
  error: null,
  authorable: false,
  hasDocument: false,
  rows: [],
  copy: null,
  view: null,
  composer: null,
  palette: null,
  modelCatalog: null,
  pendingDelete: null,
  deleting: false,
  revealedPaths: {},
}

/**
 * Why this copy cannot be submitted yet, as a locale key, or undefined when
 * it can. Client-side only: the host re-checks the id and its answer is what
 * the dialog reports on failure.
 * @param draft - the open copy dialog.
 * @param rows - the roster, for the collision check.
 * @returns the blocking reason's locale key, or undefined when submittable.
 */
export function draftBlocker(
  draft: CopyDraft,
  rows: readonly PresetRow[],
): 'idRequired' | 'idInvalid' | 'idTaken' | undefined {
  if (draft.id === '') return 'idRequired'
  if (!PRESET_ID.test(draft.id)) return 'idInvalid'
  // A copy never overwrites: landing on a name already in use would replace
  // something the user did not open.
  if (rows.some(row => row.id === draft.id)) return 'idTaken'
  return undefined
}

/**
 * Derive a plugin module's display name from its specifier: strip any `@scope/`
 * prefix and the `dsh-`/`tool-` prefixes, then split on `-` and title-case each
 * word. A subpath keeps its `/` (`dsh-web-app/startup` → `Web App/Startup`); an
 * empty result means nothing recognizable remained, and the call site falls
 * back to the module name.
 * @param moduleName - the exact module specifier.
 * @returns the display name, or '' when nothing remains after stripping.
 */
export function displayNameFor(moduleName: string): string {
  const stem = moduleName.replace(/^@[^/]+\//, '').replace(/^dsh-/, '').replace(/^tool-/, '')
  return stem
    .split('-')
    .filter(word => word !== '')
    .map(word => word.replace(/[^/]+/g, segment => segment.charAt(0).toUpperCase() + segment.slice(1)))
    .join(' ')
}

/**
 * Whether the draft differs from what the composer opened with.
 * @param draft - the composer draft to compare.
 * @returns true when any edited field — the id, name, composition, or layout —
 * differs from the original.
 */
export function composeDirty(draft: ComposeDraft): boolean {
  const { original } = draft
  return draft.id !== original.id
    || draft.name !== original.name
    || !graphLayoutEqual(draft.graph, original.graph)
}

/**
 * Why this composition cannot be saved yet, as a locale key, or undefined when
 * it can. Client-side only: the host re-checks the id, the graph's rows, and
 * module installability, and its answer is what the composer reports.
 * @param draft - the open composer.
 * @param rows - the roster, for the create/id-collision check.
 * @returns the blocking reason's locale key, or undefined when submittable.
 */
export function composeBlocker(
  draft: ComposeDraft,
  rows: readonly PresetRow[],
): 'idRequired' | 'idInvalid' | 'noRows' | 'idTaken' | 'unchanged' | undefined {
  if (draft.id === '') return 'idRequired'
  if (!PRESET_ID.test(draft.id)) return 'idInvalid'
  if (graphRows(draft.graph).length === 0) return 'noRows'
  if (!composeDirty(draft)) return 'unchanged'
  // A create must not land on an id the roster already supplies. Editing an
  // existing preset keeps its own id (which is on the roster by definition),
  // so the check only fires when the id was changed onto a live one.
  if (draft.original.id !== draft.id && rows.some(row => row.id === draft.id)) return 'idTaken'
  return undefined
}

/**
 * Why a composition cannot yet be handed to Creator mode, as a locale key, or
 * undefined when it can. Unlike {@link composeBlocker}, an unchanged existing
 * preset is handoff-ready: it is already saved, so the handoff skips the save
 * and starts the draft directly.
 * @param draft - the open composer.
 * @param rows - the roster, for the create/id-collision check.
 * @returns the blocking reason's locale key, or undefined when handoff-ready.
 */
export function handoffBlocker(
  draft: ComposeDraft,
  rows: readonly PresetRow[],
): 'idRequired' | 'idInvalid' | 'noRows' | 'idTaken' | undefined {
  if (draft.id === '') return 'idRequired'
  if (!PRESET_ID.test(draft.id)) return 'idInvalid'
  if (graphRows(draft.graph).length === 0) return 'noRows'
  if (draft.original.id !== draft.id && rows.some(row => row.id === draft.id)) return 'idTaken'
  return undefined
}

/** Reads the roster and drives the copy dialog, viewer, and location reveals. */
export class AgentPresetSectionController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSectionState> = createSnapshotStore(INITIAL)

  constructor(
    private readonly api: Pick<IApiClient, 'agentPresets' | 'settings' | 'llm'>,
    /**
     * Called after this page changes the roster DIRECTORY, so the other
     * surfaces reading the same roster re-read it. A settings field moving is
     * already announced by the host through the forwarded
     * `settings/document-updated`; a directory copied or deleted here is not,
     * and the new-session chip has no other way to learn a preset it should
     * offer now exists.
     */
    private readonly rosterChanged: () => void = () => {},
    /** The deployment's installed plugin modules, for the composer palette. */
    private readonly modules: ModuleSource = { list: () => Promise.resolve([]) },
  ) {}

  private set(patch: Partial<AgentPresetSectionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private patchCopy(patch: Partial<CopyDraft>): void {
    const { copy } = this.store.getSnapshot()
    if (copy === null) return
    this.set({ copy: { ...copy, ...patch } })
  }

  private patchComposer(patch: Partial<ComposeDraft>): void {
    const { composer } = this.store.getSnapshot()
    if (composer === null) return
    this.set({ composer: { ...composer, ...patch } })
  }

  /** Load the composer palette from the host inventory, degrading to unavailable. */
  private async loadPalette(): Promise<void> {
    try {
      const modules = await this.modules.list()
      this.set({ palette: { status: 'ready', modules } })
    } catch {
      // The palette is an offering, not a gate: an edit already in the
      // composer keeps its graph, and only new drags lose the list.
      this.set({ palette: { status: 'unavailable', modules: [] } })
    }
  }

  /**
   * Load the configured model catalog for the composer's model-kind picker,
   * degrading to unavailable without disturbing an edit in progress. One load
   * stays in flight until it settles; a later event still triggers a fresh one.
   */
  async loadModelCatalog(): Promise<void> {
    const before = this.store.getSnapshot().modelCatalog
    if (before !== null && before.status === 'loading') return
    this.set({ modelCatalog: { status: 'loading', groups: [], failures: [] } })
    try {
      const response = await this.api.llm.models({})
      if (!response.result.ok) {
        this.set({ modelCatalog: { status: 'unavailable', groups: [], failures: [] } })
        return
      }
      const { groups, failures } = response.result.value
      this.set({ modelCatalog: { status: 'ready', groups, failures } })
    } catch {
      // The catalog is an offering, not a gate: an edit already in the
      // composer keeps its graph, and only the picker loses the list.
      this.set({ modelCatalog: { status: 'unavailable', groups: [], failures: [] } })
    }
  }

  /**
   * Load the roster. An empty roster means the deployment composes no
   * presets, which is a valid deployment rather than a failure — the section
   * reports `unavailable` and renders nothing.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const roster = await beginRosterRead(this.api, this.store)
    if (roster === undefined) return
    const { presets, authorable, hasDocument } = roster
    if (presets.length === 0) {
      // Nothing to manage leaves nothing to keep a dialog open over.
      this.set({ status: 'unavailable', rows: [], authorable, hasDocument, copy: null, view: null })
      return
    }
    // A reveal outlives a reload but not its preset: a path for a row the
    // roster no longer lists would be a claim about a directory that is gone.
    const revealed = this.store.getSnapshot().revealedPaths
    const kept = Object.fromEntries(
      Object.entries(revealed).filter(([id]) => presets.some(preset => preset.id === id)))
    this.set({
      status: 'ready',
      error: null,
      authorable,
      hasDocument,
      rows: presets.map(preset => ({ ...preset })),
      revealedPaths: kept,
    })
  }

  /**
   * Open one shipped preset's composition in the read-only canvas view. The
   * palette loads too, so the nodes carry the same badges and descriptions an
   * editable composition shows.
   * @param id - the preset to view.
   * @returns once the composition loaded or the failure is on the page.
   */
  async view(id: string): Promise<void> {
    this.set({ error: null, copy: null, composer: null })
    void this.loadPalette()
    void this.loadModelCatalog()
    try {
      const response = await this.api.agentPresets.readGraph({ agentPreset: id })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      const { name, graph } = response.result.value
      this.set({ view: { id, title: name ?? id, graph } })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /** Close the read-only composition view. */
  closeView(): void {
    this.set({ view: null, palette: null, modelCatalog: null })
  }

  /**
   * Open the flow-graph composer. A null id starts a new preset from an empty
   * chain graph; an id opens that preset's graph for in-place editing.
   * Either way the palette starts loading and any other overlay closes.
   * @param id - the user preset to edit, or null to create.
   * @returns once an existing preset's graph loaded or the failure is on the page.
   */
  async beginCompose(id: string | null): Promise<void> {
    this.set({ error: null, copy: null, view: null, palette: { status: 'loading', modules: [] } })
    void this.loadPalette()
    void this.loadModelCatalog()
    if (id === null) {
      const graph = emptyChainGraph('', '')
      this.set({
        composer: { id: '', name: '', graph, saving: false, error: null, original: { id: '', name: '', graph } },
      })
      return
    }
    const row = this.store.getSnapshot().rows.find(candidate => candidate.id === id)
    try {
      const response = await this.api.agentPresets.readGraph({ agentPreset: id })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      const { name, graph } = response.result.value
      const title = name ?? row?.name ?? id
      this.set({
        composer: {
          id,
          name: title,
          graph,
          saving: false,
          error: null,
          original: { id, name: title, graph },
        },
      })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /** Close the composer, discarding whatever was assembled. */
  closeComposer(): void {
    this.set({ composer: null, palette: null, modelCatalog: null })
  }

  /**
   * Name the preset the composition lands on. Free ids create, ids already on
   * the roster overwrite.
   * @param id - the id typed into the composer.
   */
  setComposerId(id: string): void {
    this.patchComposer({ id, error: null })
  }

  /**
   * Name the composed preset's display name.
   * @param name - the display name typed into the composer.
   */
  setComposerName(name: string): void {
    this.patchComposer({ name, error: null })
  }

  /**
   * Add a plugin module to the composition from the palette's click path. A
   * module already in the composition is refused (see {@link chainAddModule}).
   * @param moduleName - the module being added.
   * @returns the new node's canvas id, or undefined when refused.
   */
  addRow(moduleName: string): string | undefined {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return undefined
    const added = chainAddModule(composer.graph, moduleName, cascadePosition(chainAgents(composer.graph).length))
    if (added === undefined) return undefined
    this.patchComposer({ graph: added.graph, error: null })
    return added.nodeId
  }

  /**
   * Add a plugin module to the composition from the palette's drop path, at
   * the graph position it landed on. A module already in the composition is
   * refused (see {@link chainAddModule}).
   * @param moduleName - the module being dropped.
   * @param position - the graph position the node lands at.
   * @returns the new node's canvas id, or undefined when refused.
   */
  addNodeAt(moduleName: string, position: { x: number; y: number }): string | undefined {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return undefined
    const added = chainAddModule(composer.graph, moduleName, position)
    if (added === undefined) return undefined
    this.patchComposer({ graph: added.graph, error: null })
    return added.nodeId
  }

  /**
   * Remove one node from the composition by its composition row id — the
   * inspector's remove, which knows the row, not the canvas node id.
   * @param rowId - the row id (`composition.id`, falling back to the module).
   */
  removeRow(rowId: string): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    const node = chainAgents(composer.graph).find(agent =>
      (agent.composition?.id ?? agent.composition?.module) === rowId)
    if (node === undefined) return
    this.patchComposer({ graph: chainRemoveNode(composer.graph, node.id), error: null })
  }

  /**
   * Remove one node from the composition by its canvas id — the delete key.
   * @param nodeId - the canvas node id being removed.
   */
  removeNode(nodeId: string): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({ graph: chainRemoveNode(composer.graph, nodeId), error: null })
  }

  /**
   * Reorder the composition in place by chain index — the inspector's move
   * buttons, which know the position, not the canvas node id.
   * @param fromIndex - the agent node being moved.
   * @param toIndex - where it lands.
   */
  moveRow(fromIndex: number, toIndex: number): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({ graph: chainMoveIndex(composer.graph, fromIndex, toIndex), error: null })
  }

  /**
   * Move one node's canvas position — the drag gesture.
   * @param nodeId - the node being dragged.
   * @param position - the new graph position.
   */
  moveNode(nodeId: string, position: { x: number; y: number }): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({ graph: chainMoveNode(composer.graph, nodeId, position), error: null })
  }

  /**
   * Bind one model kind's route on one composition node — the inspector's
   * model-kind picker. The edit lands on the draft graph in place, so it is
   * part of the composition an overwrite writes and wakes the save button.
   * @param nodeId - the canvas node id the row selected.
   * @param kind - the model kind being bound.
   * @param field - which side of the binding is edited.
   * @param value - the provider or model id, or '' to clear that side.
   */
  updateAgentModelKind(nodeId: string, kind: ModelKind, field: 'provider' | 'model', value: string): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({
      graph: setAgentModelKind(composer.graph, nodeId, kind, field, value),
      error: null,
    })
  }

  /**
   * Reorder the composition so one node runs right after another — the connect
   * gesture.
   * @param fromNodeId - the node the dragged port came from.
   * @param toNodeId - the node being moved after it.
   */
  reorderNode(fromNodeId: string, toNodeId: string): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({ graph: chainReorder(composer.graph, fromNodeId, toNodeId), error: null })
  }

  /**
   * Save the composition graph, re-read the roster, and announce the directory
   * change. A free id creates the preset; an id already on the roster
   * overwrites it in place.
   * @returns true when the composition saved, false when it was blocked,
   * failed, or no composer is open.
   */
  async confirmCompose(): Promise<boolean> {
    const draft = this.store.getSnapshot().composer
    if (draft === null || draft.saving) return false
    if (composeBlocker(draft, this.store.getSnapshot().rows) !== undefined) return false
    this.patchComposer({ saving: true, error: null })
    try {
      const name = draft.name.trim()
      const response = await this.api.agentPresets.saveGraph({
        agentPreset: draft.id,
        // The graph is stored beside the preset it belongs to, so its own id
        // follows the target rather than the id the draft opened under.
        graph: { ...draft.graph, id: draft.id },
        ...name === '' ? {} : { name },
        overwrite: this.store.getSnapshot().rows.some(row => row.id === draft.id),
      })
      if (!response.result.ok) {
        this.patchComposer({ saving: false, error: response.result.error.message })
        return false
      }
      this.set({ composer: null, palette: null, modelCatalog: null })
      await this.load()
      this.rosterChanged()
      return true
    } catch (error) {
      this.patchComposer({ saving: false, error: messageOf(error) })
      return false
    }
  }

  /**
   * Open the copy dialog over one preset.
   * @param from - the preset the copy will start from.
   */
  beginCopy(from: string): void {
    const row = this.store.getSnapshot().rows.find(candidate => candidate.id === from)
    this.set({
      error: null,
      copy: { from, fromTitle: row?.name ?? from, id: '', name: '', saving: false, error: null },
    })
  }

  /** Close the copy dialog, discarding whatever was typed. */
  cancelCopy(): void {
    this.set({ copy: null })
  }

  /**
   * Name the preset the copy creates.
   * @param id - the id typed into the dialog.
   */
  setCopyId(id: string): void {
    this.patchCopy({ id, error: null })
  }

  /**
   * Name the copy's display name.
   * @param name - the display name typed into the dialog.
   */
  setCopyName(name: string): void {
    this.patchCopy({ name, error: null })
  }

  /**
   * Submit the copy, re-read the roster, then take the user to the new
   * preset's files — the directory opens where the host has a desktop, and
   * its path appears on the new row where it does not.
   * @returns once the copy settled and the page reflects it.
   */
  async confirmCopy(): Promise<void> {
    const draft = this.store.getSnapshot().copy
    if (draft === null || draft.saving) return
    if (draftBlocker(draft, this.store.getSnapshot().rows) !== undefined) return
    this.patchCopy({ saving: true, error: null })
    try {
      const name = draft.name.trim()
      const response = await this.api.agentPresets.copy({
        from: draft.from,
        agentPreset: draft.id,
        ...name === '' ? {} : { name },
      })
      if (!response.result.ok) {
        this.patchCopy({ saving: false, error: response.result.error.message })
        return
      }
      this.set({ copy: null })
      await this.load()
      this.rosterChanged()
      // A preset is its files from here on (the dialog collected nothing
      // else), so landing in them is the completion, not a follow-up.
      await this.openLocation(draft.id)
    } catch (error) {
      this.patchCopy({ saving: false, error: messageOf(error) })
    }
  }

  /**
   * Open one preset's directory on the host desktop, or reveal its path on
   * the row where the deployment has no opener to hand it to.
   * @param id - the preset whose files the user wants.
   * @returns once the host answered and the page reflects it.
   */
  async openLocation(id: string): Promise<void> {
    try {
      const response = await this.api.agentPresets.openDocument({ agentPreset: id })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      if (response.result.value.opened) return
      const { path } = response.result.value
      this.set({ revealedPaths: { ...this.store.getSnapshot().revealedPaths, [id]: path } })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /**
   * Ask for confirmation before deleting one preset.
   * @param id - the preset to delete, or null to dismiss the confirmation.
   */
  confirmDelete(id: string | null): void {
    if (this.store.getSnapshot().deleting) return
    this.set({ pendingDelete: id })
  }

  /**
   * Delete the preset awaiting confirmation, then re-read the roster.
   *
   * A session already composed from it keeps running: its composition was
   * mounted at creation and nothing re-reads the file.
   * @returns once the delete settled and the page reflects it.
   */
  async remove(): Promise<void> {
    const { pendingDelete, deleting } = this.store.getSnapshot()
    if (pendingDelete === null || deleting) return
    this.set({ deleting: true, error: null })
    try {
      const response = await this.api.agentPresets.remove({ agentPreset: pendingDelete })
      if (!response.result.ok) {
        this.set({ deleting: false, pendingDelete: null, error: response.result.error.message })
        return
      }
      this.set({ deleting: false, pendingDelete: null })
      await this.load()
      this.rosterChanged()
    } catch (error) {
      this.set({ deleting: false, pendingDelete: null, error: messageOf(error) })
    }
  }

  /**
   * Make one preset the default for sessions created later. Running sessions
   * keep the composition they began with, so this never disturbs work.
   * @param id - the preset to make default.
   * @returns once the write settled and the roster was re-read.
   */
  async makeDefault(id: string): Promise<void> {
    const failure = await writeDefaultPreset(this.api, id)
    if (failure !== undefined) {
      this.set({ error: failure })
      return
    }
    await this.load()
  }
}
