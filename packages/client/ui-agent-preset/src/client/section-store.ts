/**
 * Agent-preset management controller: the roster as a list, a copy dialog as
 * one way a preset is created, a drag-and-drop composer as the other, and a
 * read-only canvas view over the shipped compositions.
 *
 * The browser writes no composition text. Creation is either a host-side copy
 * of an existing preset (`{ from, id, name? }` is all that crosses the wire) or
 * a validated ROW LIST the composer assembles — each row names an installed
 * plugin module, the host re-checks that against its own inventory, and an
 * overwrite is refused for presets that ship with the deployment. Everything
 * else happens in the preset's own files, which is why the page's other job is
 * getting the user TO those files: open the directory where the host has a
 * desktop, show its path where it does not.
 *
 * The host stays the single fact source. Every mutation writes through the
 * wire and the page re-reads the roster afterwards, because a copy or a
 * composition changes more than the row it targeted.
 */

import type { IApiClient, ComposeRow } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { beginRosterRead, messageOf, writeDefaultPreset } from './settings-store.ts'

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
  /** The composition's rows, in chain order. */
  rows: ComposeRow[]
}

/**
 * The drag-and-drop composer: an agent as a list of plugin rows. Editing an
 * existing user preset keeps the full wire rows (so a preserved `config` or
 * `disabled` survives an overwrite); rows added from the palette carry none.
 */
export interface ComposeDraft {
  /** Target preset id; a free id creates, a roster id overwrites. */
  id: string
  /** Display name being typed; empty falls back to the id. */
  name: string
  /** The composition being built, in display order. */
  rows: ComposeRow[]
  /** Whether the compose is in flight. */
  saving: boolean
  /** The last compose failure, cleared by the next edit. */
  error: string | null
  /** What the composer opened with, so an untouched draft disables Save. */
  original: { id: string; name: string; rows: ComposeRow[] }
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
  /** The open drag-and-drop composer, or null. */
  composer: ComposeDraft | null
  /** The composer palette's last load; null while the composer is closed. */
  palette: ComposePalette | null
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
 * Derive a composition row id from an installed module name: strip the
 * `@deepseek-ai/` and `dsh-` prefixes (so `@deepseek-ai/dsh-tool-bash` reads
 * as `tool-bash`), then append `-2`/`-3` until the id is free.
 * @param moduleName - the exact module specifier the row mounts.
 * @param rows - the rows already in the composition, for the conflict check.
 * @returns an id no row in the composition already uses.
 */
export function rowIdFor(moduleName: string, rows: readonly ComposeRow[]): string {
  const base = moduleName.replace(/^@deepseek-ai\//, '').replace(/^dsh-/, '')
  const used = new Set(rows.map(row => row.id))
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${String(n)}`
    if (!used.has(candidate)) return candidate
  }
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
 * Insert a plugin module into the composition at a slot. A module already in
 * the composition is refused — one agent runs one instance of a plugin.
 * @param rows - the rows before the insertion.
 * @param moduleName - the module being dropped from the palette.
 * @param index - the slot it lands in, clamped to the list bounds.
 * @returns the rows with the new row inserted, or the same rows on a duplicate.
 */
export function insertRowAt(rows: readonly ComposeRow[], moduleName: string, index: number): ComposeRow[] {
  if (rows.some(row => row.name === moduleName)) return rows as ComposeRow[]
  const next = [...rows]
  next.splice(Math.min(Math.max(index, 0), rows.length), 0, {
    id: rowIdFor(moduleName, rows),
    name: moduleName,
  })
  return next
}

/**
 * Add a plugin module to the composition, at the end. A module already in the
 * composition is refused — one agent runs one instance of a plugin.
 * @param rows - the rows before the addition.
 * @param moduleName - the module being dragged in from the palette.
 * @returns the rows with the new row appended, or the same rows on a duplicate.
 */
export function addRow(rows: readonly ComposeRow[], moduleName: string): ComposeRow[] {
  return insertRowAt(rows, moduleName, rows.length)
}

/**
 * Remove a row from the composition.
 * @param rows - the rows before the removal.
 * @param id - the row id being removed.
 * @returns the rows without that id.
 */
export function removeRow(rows: readonly ComposeRow[], id: string): ComposeRow[] {
  return rows.filter(row => row.id !== id)
}

/**
 * Reorder the composition: move one row so it lands before the element
 * originally at `toIndex` (or at the end when `toIndex` is past the last one).
 * @param rows - the rows before the move.
 * @param fromIndex - the row being dragged.
 * @param toIndex - the target slot, clamped to the list bounds.
 * @returns the reordered rows, or the same rows when `fromIndex` is out of range.
 */
export function moveRow(rows: readonly ComposeRow[], fromIndex: number, toIndex: number): ComposeRow[] {
  if (fromIndex < 0 || fromIndex >= rows.length) return rows as ComposeRow[]
  const next = [...rows]
  // fromIndex was range-checked above, so the removal yields exactly one row.
  const moved = next.splice(fromIndex, 1)[0]
  if (moved === undefined) return rows as ComposeRow[]
  next.splice(Math.min(Math.max(toIndex, 0), next.length), 0, moved)
  return next
}

/**
 * Map a drop's coordinate along an axis to an insertion slot: before the first
 * element whose midpoint lies past the pointer on that axis, or at the end. The
 * axis is the caller's — the component measures either `rect.top + height/2`
 * (the old vertical list) or `rect.left + width/2` (the pipeline canvas).
 * @param point - the pointer's client coordinate along the axis at drop time.
 * @param midpoints - each element's midpoint along the same axis, in display order.
 * @returns the slot the dragged row lands in.
 */
export function insertionIndexFor(point: number, midpoints: readonly number[]): number {
  for (let i = 0; i < midpoints.length; i++) {
    const midpoint = midpoints[i]
    if (midpoint !== undefined && point < midpoint) return i
  }
  return midpoints.length
}

/** Whether two compositions differ in the fields the composer edits. */
function rowsEqual(a: readonly ComposeRow[], b: readonly ComposeRow[]): boolean {
  if (a.length !== b.length) return false
  // a.length === b.length, so every index over `a` is defined in `b`.
  return a.every((row, index) => {
    const other = b[index]
    return other !== undefined && row.id === other.id && row.name === other.name
  })
}

/** Whether the draft differs from what the composer opened with. */
export function composeDirty(draft: ComposeDraft): boolean {
  const { original } = draft
  return draft.id !== original.id
    || draft.name !== original.name
    || !rowsEqual(draft.rows, original.rows)
}

/**
 * Why this composition cannot be saved yet, as a locale key, or undefined when
 * it can. Client-side only: the host re-checks the id, the row structure, and
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
  if (draft.rows.length === 0) return 'noRows'
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
  if (draft.rows.length === 0) return 'noRows'
  if (draft.original.id !== draft.id && rows.some(row => row.id === draft.id)) return 'idTaken'
  return undefined
}

/** Reads the roster and drives the copy dialog, viewer, and location reveals. */
export class AgentPresetSectionController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSectionState> = createSnapshotStore(INITIAL)

  constructor(
    private readonly api: Pick<IApiClient, 'agentPresets' | 'settings'>,
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
      // composer keeps its rows, and only new drags lose the list.
      this.set({ palette: { status: 'unavailable', modules: [] } })
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
    try {
      const response = await this.api.agentPresets.read({ agentPreset: id })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      const { name, rows } = response.result.value
      this.set({ view: { id, title: name ?? id, rows: [...rows] } })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /** Close the read-only composition view. */
  closeView(): void {
    this.set({ view: null, palette: null })
  }

  /**
   * Open the drag-and-drop composer. A null id starts a new preset from an
   * empty composition; an id opens that preset's rows for in-place editing.
   * Either way the palette starts loading and any other overlay closes.
   * @param id - the user preset to edit, or null to create.
   * @returns once an existing preset's rows loaded or the failure is on the page.
   */
  async beginCompose(id: string | null): Promise<void> {
    this.set({ error: null, copy: null, view: null, palette: { status: 'loading', modules: [] } })
    void this.loadPalette()
    if (id === null) {
      this.set({ composer: { id: '', name: '', rows: [], saving: false, error: null, original: { id: '', name: '', rows: [] } } })
      return
    }
    const row = this.store.getSnapshot().rows.find(candidate => candidate.id === id)
    try {
      const response = await this.api.agentPresets.read({ agentPreset: id })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      const { name, rows } = response.result.value
      const title = name ?? row?.name ?? id
      this.set({
        composer: {
          id,
          name: title,
          rows: [...rows],
          saving: false,
          error: null,
          original: { id, name: title, rows: [...rows] },
        },
      })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /** Close the composer, discarding whatever was assembled. */
  closeComposer(): void {
    this.set({ composer: null, palette: null })
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
   * Add a plugin to the composition from the palette. A module already in the
   * composition is refused (see {@link addRow}).
   * @param moduleName - the module dragged in.
   */
  addRow(moduleName: string): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({ rows: addRow(composer.rows, moduleName), error: null })
  }

  /**
   * Insert a plugin into the composition from the palette at a slot. A module
   * already in the composition is refused (see {@link insertRowAt}).
   * @param moduleName - the module dropped onto the canvas.
   * @param index - the slot it lands in.
   */
  insertRowAt(moduleName: string, index: number): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({ rows: insertRowAt(composer.rows, moduleName, index), error: null })
  }

  /**
   * Remove one row from the composition.
   * @param id - the row id being removed.
   */
  removeRow(id: string): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({ rows: removeRow(composer.rows, id), error: null })
  }

  /**
   * Reorder the composition in place.
   * @param fromIndex - the row being dragged.
   * @param toIndex - where it lands.
   */
  moveRow(fromIndex: number, toIndex: number): void {
    const composer = this.store.getSnapshot().composer
    if (composer === null) return
    this.patchComposer({ rows: moveRow(composer.rows, fromIndex, toIndex), error: null })
  }

  /**
   * Save the composition, re-read the roster, and announce the directory
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
      const response = await this.api.agentPresets.compose({
        agentPreset: draft.id,
        rows: draft.rows,
        ...name === '' ? {} : { name },
        overwrite: this.store.getSnapshot().rows.some(row => row.id === draft.id),
      })
      if (!response.result.ok) {
        this.patchComposer({ saving: false, error: response.result.error.message })
        return false
      }
      this.set({ composer: null, palette: null })
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
