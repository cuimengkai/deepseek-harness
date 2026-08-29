/**
 * Agent modes: each product mode binds one agent preset to an executable
 * entry flow. Modes are a parallel roster to agent presets — they do not
 * mount plugins themselves; session creation resolves the bound preset and
 * records the mode id on the session header.
 * @module @deepseek-ai/dsh-agent-modes
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { validateFlow } from '@deepseek-ai/dsh-flow'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { FlowRunId, type FlowGraph, type FlowRunSnapshot } from '@deepseek-ai/dsh-flow/types'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { settingsNamespace, type SettingsScope, type default as SettingsService } from '@deepseek-ai/dsh-settings'
import type {
  AgentModeDocument, AgentModeErrorDetailsMap, AgentModeFlow, AgentModeRoster,
} from './types.ts'
import {
  blankEntryGraph, copyMode, DEFAULT_ENTRY_FLOW_ID, deleteMode,
  InvalidModeIdError, ModeExistsError, ModeNotWritableError,
  readModeFlow, writableRoot, writeMode, writeModeBindFile,
  writeModeFlow, writeModeMetadataFile,
} from './authoring.ts'
import { readModeBind, type ModeBind } from './bind.ts'
import { discoverModes, SHIPPED_MODE_ROOT, USER_MODE_DIR } from './discovery.ts'
import { type ModeMetadata } from './metadata.ts'
import {
  ModeInvalidError, ModeLockedError, UnknownModeError,
  type AgentMode, type Config, type ModeRoot,
} from './mode.ts'
import { agentModeProjectionDefinition, resolveSessionMode } from './session.ts'

export type * from './types.ts'
export { BIND_FILE, readModeBind, renderModeBind, type ModeBind } from './bind.ts'
export {
  discoverModes, FLOWS_DIR, scanRoot, SHIPPED_MODE_ROOT, USER_MODE_DIR,
} from './discovery.ts'
export {
  METADATA_FILE, readModeMetadata, renderModeMetadata, type ModeMetadata,
} from './metadata.ts'
export {
  blankEntryGraph, copyMode, DEFAULT_ENTRY_FLOW_ID, deleteMode,
  InvalidModeIdError, ModeExistsError, ModeNotWritableError,
  modeFlowPath, readModeFlow, writableRoot, writeMode, writeModeBindFile,
  writeModeFlow, writeModeMetadataFile,
} from './authoring.ts'
export { agentModeProjectionDefinition, resolveSessionMode, type ModeBearingSession } from './session.ts'
export { ModeInvalidError, ModeLockedError, UnknownModeError } from './mode.ts'
export type { AgentMode, Config, ModeRoot, ModeTrust } from './mode.ts'

/** Settings namespace carrying the user's chosen default mode. */
export const SETTINGS_NAMESPACE = 'agent-modes'

/** Construct one typed mode failure for the Remote carrier. */
function remoteModeFailure<Code extends keyof AgentModeErrorDetailsMap>(
  code: Code,
  message: string,
  details: AgentModeErrorDetailsMap[Code],
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

/** Map one mode rejection to its stable Remote code and details. */
function modeFailure(error: unknown, agentMode: string): TypertRemoteFailure | undefined {
  if (error instanceof UnknownModeError) {
    return remoteModeFailure(
      'agent-mode-not-found',
      error.message,
      { agentMode: error.modeId, available: [...error.available] },
    )
  }
  if (error instanceof ModeInvalidError || error instanceof InvalidModeIdError
    || error instanceof ModeExistsError) {
    return remoteModeFailure(
      'agent-mode-invalid',
      error.message,
      { agentMode: error instanceof ModeInvalidError || error instanceof InvalidModeIdError
        || error instanceof ModeExistsError
        ? error.modeId
        : agentMode, reason: error.message },
    )
  }
  if (error instanceof ModeLockedError) {
    return remoteModeFailure(
      'agent-mode-locked',
      error.message,
      { agentMode: error.modeId, sessionId: error.sessionId },
    )
  }
  if (error instanceof ModeNotWritableError) {
    return remoteModeFailure(
      'agent-mode-read-only',
      error.message,
      { agentMode, reason: error.message },
    )
  }
  return undefined
}

/** Refuse an empty mode id before invoking a domain operation. */
function validateModeId(value: string, field = 'agentMode'): void {
  if (value.length === 0) {
    throw remoteModeFailure('bad-request', `${field} must be a non-empty string`, {})
  }
}

/** Throw the stable mode failure or the caller's operation-specific fallback. */
function rejectMode(error: unknown, agentMode: string, fallbackMessage: string): never {
  throw modeFailure(error, agentMode) ?? remoteModeFailure('internal', fallbackMessage, {})
}

/** The user-writable slice of this plugin's config. */
export interface AgentModeSettings {
  /** Mode resolved when a session names none and wants a mode. */
  default?: string
}

/** Runtime schema for the user-writable slice. */
export const AgentModeSettingsSchema: z<AgentModeSettings> = z.object({
  default: z.string(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentModes: AgentModes
  }
}

/**
 * Registry over the deployment's agent modes.
 *
 * Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every
 * call so a mode authored while the process runs is visible immediately.
 */
export class AgentModes extends TypertRemoteService {
  static inject = []

  /** Runtime schema for the mode roster. */
  static Config = z.object({
    default: z.string(),
    roots: z.array(z.object({
      path: z.string().required(),
      trust: z.union(['system', 'user'] as const).default('user'),
    })).default([]),
    includeShippedRoot: z.boolean().default(true),
    includeUserRoot: z.boolean().default(true),
  }) as unknown as z<Config>

  /** Roots discovery and authoring actually scan. */
  private readonly resolvedRoots: readonly ModeRoot[]

  /** The user layer over `config.default`, when settings are composed. */
  private settings: SettingsScope<AgentModeSettings> | undefined

  /** The settings service behind {@link settings}. */
  private settingsService: SettingsService | undefined

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'agentModes')
    const roots: ModeRoot[] = []
    if (config.includeShippedRoot) {
      roots.push({ path: SHIPPED_MODE_ROOT, trust: 'system' })
    }
    for (const root of config.roots) roots.push(root)
    if (config.includeUserRoot) {
      roots.push({ path: dshHomePath(USER_MODE_DIR), trust: 'user' })
    }
    this.resolvedRoots = roots

    ctx.inject(['settings'], (settingsCtx) => {
      this.settings = settingsCtx.settings.register(
        settingsNamespace(SETTINGS_NAMESPACE),
        AgentModeSettingsSchema,
        config.default === undefined ? {} : { base: { default: config.default } },
      )
      this.settingsService = settingsCtx.settings
      settingsCtx.effect(() => () => {
        this.settings = undefined
        this.settingsService = undefined
      }, 'agentModes.settings()')
    })

    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(agentModeProjectionDefinition)
    })
  }

  /** Resolved roots (not raw `config.roots`). */
  get roots(): readonly ModeRoot[] {
    return this.resolvedRoots
  }

  /** Whether any root accepts local authoring. */
  get authorable(): boolean {
    return writableRoot(this.resolvedRoots) !== undefined
  }

  /**
   * The effective default mode id: settings override, then config, then none.
   */
  get defaultId(): string | undefined {
    return this.settings?.get().default ?? this.config.default
  }

  /**
   * List every mode the roots supply.
   * @returns the roster.
   */
  async list(): Promise<AgentMode[]> {
    return discoverModes(this.resolvedRoots)
  }

  /**
   * Resolve one mode by id, or the default when omitted.
   * @param id - requested mode id, or undefined for the default.
   * @returns the mode row (may be broken).
   */
  async resolve(id?: string): Promise<AgentMode> {
    const modes = await this.list()
    const available = modes.map(mode => mode.id)
    const target = id ?? this.defaultId
    if (target === undefined) {
      throw new UnknownModeError('(default)', available)
    }
    const found = modes.find(mode => mode.id === target)
    if (found === undefined) throw new UnknownModeError(target, available)
    return found
  }

  /**
   * Resolve a healthy mode's bind contract.
   * @param id - requested mode id, or undefined for the default.
   * @returns the bind.
   */
  async resolveBind(id?: string): Promise<ModeBind & { readonly modeId: string }> {
    const mode = await this.resolveMountable(id)
    const bind = await readModeBind(mode.directory)
    if (!bind.ok) throw new ModeInvalidError(mode.id, bind.reason)
    return { modeId: mode.id, ...bind.bind }
  }

  /**
   * Read one mode's entry flow graph.
   * @param id - mode id.
   * @returns the entry flow graph.
   */
  async readEntryFlow(id: string): Promise<FlowGraph> {
    const mode = await this.resolveMountable(id)
    const bind = await readModeBind(mode.directory)
    if (!bind.ok) throw new ModeInvalidError(mode.id, bind.reason)
    try {
      return await readModeFlow(mode.directory, bind.bind.entryFlow)
    } catch (error) {
      throw new ModeInvalidError(
        mode.id,
        error instanceof Error ? error.message : String(error),
        { cause: error },
      )
    }
  }

  /**
   * Read one named flow under a mode.
   * @param id - mode id.
   * @param flowId - flow id under the mode's `flows/` directory.
   * @returns the flow graph.
   */
  async readFlow(id: string, flowId: string): Promise<FlowGraph> {
    const mode = await this.resolveMountable(id)
    try {
      return await readModeFlow(mode.directory, flowId)
    } catch (error) {
      throw new ModeInvalidError(
        mode.id,
        error instanceof Error ? error.message : String(error),
        { cause: error },
      )
    }
  }

  /**
   * Save one flow under a writable mode.
   * @param id - mode id.
   * @param graph - the flow to store.
   */
  async saveFlow(id: string, graph: FlowGraph): Promise<void> {
    const mode = await this.resolveWritable(id)
    try {
      await writeModeFlow(mode.directory, graph)
    } catch (error) {
      throw new ModeInvalidError(
        mode.id,
        error instanceof Error ? error.message : String(error),
        { cause: error },
      )
    }
  }

  /**
   * Copy a mode into the writable user root under a new id.
   * @param from - source mode id.
   * @param id - new mode id.
   * @param name - optional display name override.
   */
  async copy(from: string, id: string, name?: string): Promise<void> {
    const source = await this.resolve(from)
    if (source.broken !== undefined) throw new ModeInvalidError(from, source.broken)
    const root = writableRoot(this.resolvedRoots)
    if (root === undefined) {
      throw new ModeNotWritableError(id, 'no user root is configured')
    }
    try {
      await copyMode(
        source.directory,
        root,
        id,
        name === undefined ? undefined : { name },
      )
    } catch (error) {
      if (error instanceof InvalidModeIdError || error instanceof ModeExistsError) throw error
      throw new ModeInvalidError(id, error instanceof Error ? error.message : String(error), { cause: error })
    }
  }

  /**
   * Create a mode from bind + entry graph under the writable user root.
   * @param id - new mode id.
   * @param bind - bind contract.
   * @param entryGraph - entry flow graph.
   * @param metadata - optional display metadata.
   */
  async write(
    id: string,
    bind: ModeBind,
    entryGraph: FlowGraph,
    metadata?: ModeMetadata,
  ): Promise<void> {
    const root = writableRoot(this.resolvedRoots)
    if (root === undefined) {
      throw new ModeNotWritableError(id, 'no user root is configured')
    }
    try {
      await writeMode(root, id, bind, entryGraph, metadata)
    } catch (error) {
      if (error instanceof InvalidModeIdError || error instanceof ModeExistsError) throw error
      throw new ModeInvalidError(id, error instanceof Error ? error.message : String(error), { cause: error })
    }
  }

  /**
   * Create a blank user mode bound to a preset, with a starter entry graph.
   * @param id - new mode id (kebab-case).
   * @param preset - agent preset id to bind.
   * @param name - optional display name.
   * @param description - optional one-line description.
   */
  async create(
    id: string,
    preset: string,
    name?: string,
    description?: string,
  ): Promise<void> {
    const trimmedPreset = preset.trim()
    if (trimmedPreset === '') {
      throw new ModeInvalidError(id, 'preset must be a non-empty string')
    }
    const metadata: ModeMetadata | undefined = name === undefined && description === undefined
      ? undefined
      : {
        ...name === undefined ? {} : { name },
        ...description === undefined ? {} : { description },
      }
    await this.write(
      id,
      { preset: trimmedPreset, entryFlow: DEFAULT_ENTRY_FLOW_ID },
      blankEntryGraph(DEFAULT_ENTRY_FLOW_ID),
      metadata,
    )
  }

  /**
   * Update a user mode's bind (preset / defaultArgs) and optional display metadata.
   * Entry flow id is left unchanged so the existing graph file keeps its name.
   * @param id - mode id.
   * @param preset - agent preset id to bind.
   * @param name - optional display name (omit to leave unchanged; empty clears).
   * @param description - optional description (omit to leave unchanged; empty clears).
   * @param defaultArgs - optional flow default args (omit to leave unchanged).
   */
  async updateBind(
    id: string,
    preset: string,
    name?: string,
    description?: string,
    defaultArgs?: JsonValue,
  ): Promise<void> {
    const mode = await this.resolveWritable(id)
    const current = await readModeBind(mode.directory)
    if (!current.ok) throw new ModeInvalidError(mode.id, current.reason)
    const trimmedPreset = preset.trim()
    if (trimmedPreset === '') {
      throw new ModeInvalidError(id, 'preset must be a non-empty string')
    }
    const next: ModeBind = {
      preset: trimmedPreset,
      entryFlow: current.bind.entryFlow,
      ...defaultArgs === undefined
        ? current.bind.defaultArgs === undefined ? {} : { defaultArgs: current.bind.defaultArgs }
        : { defaultArgs },
    }
    await writeModeBindFile(mode.directory, next)
    if (name !== undefined || description !== undefined) {
      const nextName = name === undefined
        ? mode.name
        : (name.trim() === '' ? undefined : name.trim())
      const nextDescription = description === undefined
        ? mode.description
        : (description.trim() === '' ? undefined : description.trim())
      await writeModeMetadataFile(mode.directory, {
        ...nextName === undefined ? {} : { name: nextName },
        ...nextDescription === undefined ? {} : { description: nextDescription },
        ...mode.order === undefined ? {} : { order: mode.order },
      })
    }
  }

  /**
   * Delete a user-authored mode.
   * @param id - mode id.
   */
  async remove(id: string): Promise<void> {
    const mode = await this.resolveWritable(id)
    await deleteMode(mode.directory)
    if (this.settings?.get().default === id && this.settingsService !== undefined) {
      await this.settingsService.mutate(
        settingsNamespace(SETTINGS_NAMESPACE),
        [{ op: 'unset', path: ['default'] }],
      )
    }
  }

  /** Resolve a healthy mode or throw. */
  private async resolveMountable(id?: string): Promise<AgentMode> {
    const mode = await this.resolve(id)
    if (mode.broken !== undefined) throw new ModeInvalidError(mode.id, mode.broken)
    return mode
  }

  /** Resolve a writable user mode or throw. */
  private async resolveWritable(id: string): Promise<AgentMode> {
    const mode = await this.resolveMountable(id)
    if (mode.trust !== 'user') {
      throw new ModeNotWritableError(mode.id, 'shipped modes are read-only')
    }
    return mode
  }

  // ── Remote exports ──────────────────────────────────────────────────────

  /**
   * List the roster for the client.
   * @returns the path-free roster.
   */
  @Remote('list')
  async remoteExportList(): Promise<AgentModeRoster> {
    const modes = await this.list()
    const defaultId = this.defaultId
    const rows = await Promise.all(modes.map(async (mode) => {
      let preset: string | undefined
      let entryFlow: string | undefined
      if (mode.broken === undefined) {
        const bind = await readModeBind(mode.directory)
        if (bind.ok) {
          preset = bind.bind.preset
          entryFlow = bind.bind.entryFlow
        }
      }
      return {
        id: mode.id,
        trust: mode.trust,
        isDefault: mode.id === defaultId,
        ...mode.name === undefined ? {} : { name: mode.name },
        ...mode.description === undefined ? {} : { description: mode.description },
        ...preset === undefined ? {} : { preset },
        ...entryFlow === undefined ? {} : { entryFlow },
        ...mode.broken === undefined ? {} : { broken: mode.broken },
      }
    }))
    return { modes: rows, authorable: this.authorable }
  }

  /**
   * Read one mode's bind and entry flow.
   * @param agentMode - mode id.
   * @returns the document.
   */
  @Remote('read')
  async readDocument(agentMode: string): Promise<AgentModeDocument> {
    validateModeId(agentMode)
    try {
      const mode = await this.resolveMountable(agentMode)
      const bind = await readModeBind(mode.directory)
      if (!bind.ok) throw new ModeInvalidError(mode.id, bind.reason)
      const entryGraph = await readModeFlow(mode.directory, bind.bind.entryFlow)
      return {
        agentMode: mode.id,
        trust: mode.trust,
        bind: bind.bind,
        entryGraph,
        ...mode.name === undefined ? {} : { name: mode.name },
        ...mode.description === undefined ? {} : { description: mode.description },
      }
    } catch (error) {
      rejectMode(error, agentMode, `failed to read mode "${agentMode}"`)
    }
  }

  /**
   * Read one named flow under a mode.
   * @param agentMode - mode id.
   * @param flowId - flow id.
   * @returns the flow document.
   */
  @Remote('readFlow')
  async readFlowDocument(agentMode: string, flowId: string): Promise<AgentModeFlow> {
    validateModeId(agentMode)
    validateModeId(flowId, 'flowId')
    try {
      const mode = await this.resolveMountable(agentMode)
      const graph = await readModeFlow(mode.directory, flowId)
      return { agentMode: mode.id, trust: mode.trust, graph }
    } catch (error) {
      rejectMode(error, agentMode, `failed to read flow "${flowId}" of mode "${agentMode}"`)
    }
  }

  /**
   * Save one flow under a writable mode.
   * @param agentMode - mode id.
   * @param graph - the flow graph.
   * @returns the mode id.
   */
  @Remote('saveFlow')
  async saveFlowDocument(
    agentMode: string,
    graph: FlowGraph,
  ): Promise<{ readonly agentMode: string }> {
    validateModeId(agentMode)
    try {
      await this.saveFlow(agentMode, graph)
      return { agentMode }
    } catch (error) {
      rejectMode(error, agentMode, `failed to save flow of mode "${agentMode}"`)
    }
  }

  /**
   * Check a graph's structural findings without persisting it — the live
   * Checklist the composer polls while editing, before Publish attempts to
   * save. Read-only: never writes, so a broken draft can be checked freely.
   * @param graph - the canvas graph to check (may be unsaved).
   * @returns the findings; an empty list means the graph is valid.
   */
  @Remote('validate')
  async validateGraph(graph: FlowGraph): Promise<{ readonly errors: readonly string[] }> {
    const result = validateFlow(graph)
    return { errors: result.ok ? [] : result.errors }
  }

  /**
   * Copy a mode into the user root.
   * @param from - source mode id.
   * @param id - new mode id.
   * @param name - optional display name.
   */
  @Remote('copy')
  async remoteExportCopy(from: string, id: string, name?: string): Promise<void> {
    validateModeId(from, 'from')
    validateModeId(id, 'id')
    try {
      await this.copy(from, id, name)
    } catch (error) {
      rejectMode(error, id, `failed to copy mode "${from}" to "${id}"`)
    }
  }

  /**
   * Create a blank user mode bound to a preset.
   * @param id - new mode id.
   * @param preset - agent preset id to bind.
   * @param name - optional display name.
   * @param description - optional description.
   * @returns the created mode id.
   */
  @Remote('create')
  async remoteExportCreate(
    id: string,
    preset: string,
    name?: string,
    description?: string,
  ): Promise<{ readonly agentMode: string }> {
    validateModeId(id, 'id')
    try {
      await this.create(id, preset, name, description)
      return { agentMode: id }
    } catch (error) {
      rejectMode(error, id, `failed to create mode "${id}"`)
    }
  }

  /**
   * Update a user mode's bound preset and optional display fields.
   * @param agentMode - mode id.
   * @param preset - agent preset id to bind.
   * @param name - optional display name.
   * @param description - optional description.
   * @returns the mode id.
   */
  @Remote('saveBind')
  async remoteExportSaveBind(
    agentMode: string,
    preset: string,
    name?: string,
    description?: string,
  ): Promise<{ readonly agentMode: string }> {
    validateModeId(agentMode)
    try {
      await this.updateBind(agentMode, preset, name, description)
      return { agentMode }
    } catch (error) {
      rejectMode(error, agentMode, `failed to save bind of mode "${agentMode}"`)
    }
  }

  /**
   * Delete a user-authored mode.
   * @param id - mode id.
   */
  @Remote('deleteMode')
  async remoteExportDelete(id: string): Promise<void> {
    validateModeId(id, 'id')
    try {
      await this.remove(id)
    } catch (error) {
      rejectMode(error, id, `failed to delete mode "${id}"`)
    }
  }

  /**
   * Compose a blank session from a mode's bound preset and record the mode.
   * @param agent - the session's live agent, resolved from the wire identity.
   * @param agentMode - the mode to apply.
   * @returns the mode id that was recorded.
   */
  @Remote('select')
  async select(agent: Agent, agentMode: string): Promise<string> {
    validateModeId(agentMode)
    const queued = this.switches.get(agent.id) ?? Promise.resolve()
    const turn = queued.then(() => this.swap(agent, agentMode))
    const guard = turn.catch(() => undefined)
    this.switches.set(agent.id, guard)
    try {
      return await turn
    } catch (error: unknown) {
      return rejectMode(error, agentMode, `failed to select agent mode "${agentMode}": ${String(error)}`)
    } finally {
      if (this.switches.get(agent.id) === guard) this.switches.delete(agent.id)
    }
  }

  /**
   * Compile and start the draft graph under the session's agent (try-run).
   * @param agent - parent agent for every child node.
   * @param graph - the canvas graph to run (may be unsaved).
   * @param input - optional flow args.
   * @param seed - optional per-node output seed for a Variable Inspector re-run.
   * @returns the live run id for polling via {@link getTryRun}.
   */
  @Remote('tryRun')
  async tryRun(
    agent: Agent,
    graph: FlowGraph,
    input?: JsonValue,
    seed?: Record<string, JsonValue>,
  ): Promise<{ readonly runId: string }> {
    const flowEngine = this.ctx.get('flowEngine')
    if (flowEngine === undefined) {
      throw remoteModeFailure(
        'flow-unavailable',
        'flow engine is not configured in this deployment',
        {},
      )
    }
    try {
      const { runId } = flowEngine.run({
        graph,
        parent: agent,
        ...(input === undefined ? {} : { input }),
        ...(seed === undefined ? {} : { seed }),
      })
      return { runId }
    } catch (error: unknown) {
      rejectMode(error, graph.id, `failed to try-run flow "${graph.id}": ${String(error)}`)
    }
  }

  /**
   * Start the session's bound mode entry flow under the live parent agent.
   * Used when a scenario session begins (first user intent), not settings try-run.
   * @param agent - parent agent for every child node.
   * @param input - optional flow args (typically the user's opening text).
   * @returns the live run id for polling via {@link getTryRun}.
   */
  @Remote('startEntry')
  async startEntry(
    agent: Agent,
    input?: JsonValue,
  ): Promise<{ readonly runId: string; readonly agentMode: string }> {
    const agentMode = resolveSessionMode(agent.session)
    if (agentMode === undefined) {
      throw remoteModeFailure(
        'agent-mode-missing',
        'session has no agent mode; select a scenario before starting its entry flow',
        {},
      )
    }
    try {
      const mode = await this.resolveMountable(agentMode)
      const bind = await readModeBind(mode.directory)
      if (!bind.ok) throw new ModeInvalidError(mode.id, bind.reason)
      const graph = await readModeFlow(mode.directory, bind.bind.entryFlow)
      const { runId } = await this.tryRun(agent, graph, input)
      return { runId, agentMode: mode.id }
    } catch (error: unknown) {
      rejectMode(error, agentMode, `failed to start entry flow of mode "${agentMode}"`)
    }
  }

  /**
   * Read one try-run's live snapshot.
   * @param runId - the id returned by {@link tryRun}.
   * @returns the snapshot, or null when unknown/pruned.
   */
  @Remote('getTryRun')
  async getTryRun(runId: string): Promise<{ readonly run: FlowRunSnapshot | null }> {
    if (runId.length === 0) {
      throw remoteModeFailure('bad-request', 'runId must be a non-empty string', {})
    }
    const flowEngine = this.ctx.get('flowEngine')
    if (flowEngine === undefined) {
      throw remoteModeFailure(
        'flow-unavailable',
        'flow engine is not configured in this deployment',
        {},
      )
    }
    try {
      const run = flowEngine.getRun(FlowRunId(runId))
      return { run: run ?? null }
    } catch (error: unknown) {
      throw remoteModeFailure(
        'flow-run-not-found',
        error instanceof Error ? error.message : String(error),
        { runId },
      )
    }
  }

  /** Per-session queue for {@link select}, matching agent-presets. */
  private readonly switches = new Map<string, Promise<unknown>>()

  /** Resolve bind, recompose the bound preset, then log mode + preset. */
  private async swap(agent: Agent, agentMode: string): Promise<string> {
    if (agent.session.events.some(event => event.type === 'turn/start')) {
      throw new ModeLockedError(agent.id, agentMode)
    }
    const bind = await this.resolveBind(agentMode)
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) {
      throw new ModeInvalidError(
        agentMode,
        'agentPresets service is absent; cannot mount the bound preset',
      )
    }
    const preset = await presets.recompose(agent.ctx, bind.preset)
    agent.session.append('agent-preset/selected', { agentPreset: preset.id })
    agent.session.append('agent-mode/selected', { agentMode: bind.modeId })
    this.ctx.emit('agent-mode/selected', agent.id, bind.modeId)
    return bind.modeId
  }
}

export default AgentModes
