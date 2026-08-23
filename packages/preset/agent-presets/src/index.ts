/**
 * Agent presets: each session composes its model-facing plugin set from one
 * preset `cordis.yml`, mounted ONCE per preset under a standing scope and
 * joined by every agent that names it.
 *
 * The standing mount is what makes a preset one composition rather than one
 * per session: its plugin instances, tool registrations, prompt sections, and
 * projection units exist exactly once, keyed per session inside the plugins
 * themselves (they predate presets and were written for a shared world). An
 * agent joins by having its scope key parented to the mount's
 * ({@link bindScopeParent}), which makes the mount's registrations visible to
 * that agent's views and the mount's listeners receive that agent's events —
 * and a host reader with no agent at all (a cold transcript read) resolves
 * the same standing registrations by preset id.
 *
 * This package owns the preset vocabulary, filesystem discovery, and the
 * guarded standing mount. It does not decide when an agent is created — the
 * agent factory's `setup(agentCtx)` hook is the one supported call site,
 * because only there is the join installed while the agent is still
 * unpublished, so a rejected composition rolls the whole creation back.
 * @module @deepseek-ai/dsh-agent-presets
 */

import { stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import { bindScopeParent, createScope, scopeOf, type Scope, type ScopeKey, type ScopeParentBinding } from '@deepseek-ai/dsh-scope'
// Type-only: resolves the `agent/created` lifecycle event this service watches.
import type {} from '@deepseek-ai/dsh-agent'
import { settingsNamespace, type SettingsScope, type default as SettingsService } from '@deepseek-ai/dsh-settings'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { discoverPresets, USER_PRESET_DIR } from './discovery.ts'
import {
  ComposeModuleError, copyComposition, deleteComposition, parseComposition, PresetExistsError,
  PresetNotWritableError, readComposition, readCompositionGraph, replaceComposition, writableRoot,
  writeComposition,
} from './authoring.ts'
import { graphToRows, rowsToGraph } from './conversion.ts'
import { mountPreset, serviceForAgent, standingMountFor } from './mount.ts'
import type { PresetMetadata } from './metadata.ts'
import { PresetMountError, UnknownPresetError, type AgentPreset, type Config, type PresetRoot } from './preset.ts'
import type {} from './types.ts'

/** Settings namespace carrying the user's chosen default preset. */
export const SETTINGS_NAMESPACE = 'agent-presets'

/** The user-writable slice of this plugin's config. */
export interface AgentPresetSettings {
  /** Preset mounted when a session names none. */
  default?: string
}

/** Runtime schema for the user-writable slice. */
export const AgentPresetSettingsSchema: z<AgentPresetSettings> = z.object({
  default: z.string(),
})

/**
 * One composition row the composer authors.
 *
 * The JSON-safe subset of a loader entry that may cross the wire: `config`,
 * `disabled`, and `inject` pass through as structured values rather than being
 * edited, so arbitrary plugin config and a platform-conditional `!!js`
 * expression (`{ __jsExpr }`) round-trip unchanged. `group` is carried so a
 * group row survives editing. `id` is required by the composer (every row it
 * writes has one), but stays optional here because a shipped composition read
 * back for editing may contain an id-less row.
 */
export interface ComposeRow {
  /** Stable id inside the preset; unique across the rows of one preset. */
  id?: string
  /** Module specifier imported by the entry. */
  name: string
  /** Config passed to the plugin, carried verbatim. */
  config?: unknown
  /** Marks this row as a nested group, carried verbatim. */
  group?: boolean | null
  /** Enablement, carried verbatim (`!!js` expressions as `{ __jsExpr }`). */
  disabled?: unknown
  /** Required-service override, carried verbatim so an overwrite never drops it. */
  inject?: unknown
}

export { COMPOSITION_FILE, discoverPresets, scanRoot } from './discovery.ts'
export {
  METADATA_FILE, readPresetMetadata, renderPresetMetadata, type PresetMetadata,
} from './metadata.ts'
export {
  inactiveRows, leakedServices, livePresetMounts, mountPreset, serviceForAgent, standingMountFor,
  type JoinedPresetMount, type PresetMount,
} from './mount.ts'
export {
  ComposeModuleError, copyComposition, deleteComposition, InvalidPresetIdError,
  parseComposition, PresetExistsError, PresetNotWritableError, readComposition,
  readCompositionGraph, replaceComposition, writableRoot, writeComposition,
} from './authoring.ts'
export {
  graphRowsMatch, graphToRows, PRESET_GRAPH_FILE, PRESET_GRAPH_FORMAT_VERSION,
  PRESET_GRAPH_MAX_BYTES, rowsToGraph, type PresetGraphDocument,
} from './conversion.ts'
export { resolveSessionPreset, type PresetBearingSession } from './session.ts'
export { PresetMountError, UnknownPresetError } from './preset.ts'
export type { AgentPreset, Config, PresetRoot, PresetTrust } from './preset.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentPresets: AgentPresets
  }
}

/**
 * Registry over the deployment's agent presets.
 *
 * Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every
 * call so a preset authored while the process runs is visible immediately,
 * and a preset deleted underneath a picker disappears from the next read.
 */
export class AgentPresets extends Service {
  static inject = ['loader']

  /** Runtime schema for the preset roster. */
  static Config = z.object({
    default: z.string().required(),
    roots: z.array(z.object({
      path: z.string().required(),
      trust: z.union(['system', 'user'] as const).default('user'),
    })).default([]),
    includeUserRoot: z.boolean().default(true),
  }) as z<Config>

  /**
   * The roots discovery and authoring actually scan: every configured root in
   * order, then the harness-home user root unless `includeUserRoot` is false.
   *
   * Derived once, because a root set that changed between `list()` and the
   * `copy()` acting on its answer would author into a directory the caller
   * never saw. Appending rather than prepending keeps an earlier configured
   * root winning a duplicate id, so a shipped preset still shadows a
   * locally authored directory that claimed its name.
   */
  private readonly resolvedRoots: readonly PresetRoot[]

  /**
   * The user layer over `config.default`, present only while a settings
   * provider is composed. Held rather than snapshotted so a hot-reloaded
   * document takes effect without a restart.
   */
  private settings: SettingsScope<AgentPresetSettings> | undefined

  /**
   * The settings service behind {@link settings}, held for the one write this
   * service makes: clearing a user default it has just deleted.
   */
  private settingsService: SettingsService | undefined

  /**
   * The service's own untraced context. Methods invoked through the traceable
   * proxy see `this.ctx` rebound to the CALLER's context, which carries a
   * shadow; a subtree minted from it resolves every service through that
   * shadow's fiber instead of each entry's own inject store, so preset rows
   * would fail on the very services they declare. Standing mounts must hang
   * off the untraced original (the `jobs-local` selfCtx precedent).
   */
  private readonly selfCtx: Context

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'agentPresets')
    this.selfCtx = ctx
    this.resolvedRoots = config.includeUserRoot
      ? [...config.roots, { path: dshHomePath(USER_PRESET_DIR), trust: 'user' }]
      : [...config.roots]
    // Deliberately not `installSettingsSection`: that helper exists to re-judge
    // what a consumer DERIVED from the source — memoized resolutions,
    // registration-level facts — across attach, detach, and change. Nothing
    // here is derived. `defaultId` reads through on every call, so both of its
    // hooks would be no-ops and the source thunk would restate this field.
    ctx.inject(['settings'], (settingsCtx) => {
      this.settings = settingsCtx.settings.register(
        settingsNamespace(SETTINGS_NAMESPACE),
        AgentPresetSettingsSchema,
        { base: { default: config.default } },
      )
      this.settingsService = settingsCtx.settings
      settingsCtx.effect(() => () => {
        this.settings = undefined
        this.settingsService = undefined
      }, 'agentPresets.settings()')
    })

    // Advisory, not fatal: a synchronous `agent/created` listener that throws
    // VETOES publication, and this service must not, because composing an agent
    // outside the roster is legal — `recompose` binds exactly such a bare agent
    // below, and the ACP, SDK-server, and headless entry points all create one.
    // The invariant companion is the check that fails loud, at assembly. Why an
    // unjoined agent matters at all has one home: the [Agent
    // Note](../../../../.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.md).
    //
    // Known false positive: a session created bare and bound later by
    // `recompose` is warned about once, before its first bind. No shipped flow
    // does that today — the Web surface mounts in `setup` and children join
    // through `composeFrom` before publication.
    ctx.on('agent/created', ({ agent }) => {
      if (this.resolvedRoots.length === 0) return
      if (this.composedPreset(agent.ctx) !== undefined) return
      ctx.logger.warn(
        `agent "${agent.id}" was published without joining an agent preset; `
        + 'its tools, prompt sections, and skill catalog resolve against the empty global layer '
        + '(join through AgentPresets.mount() or composeFrom() in the agent factory setup)',
      )
    })

    // The durable record is the commit point. Its public notification carries
    // only the stable identity needed by clients, never the live Session.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'agent-preset/selected') return
      ctx.emit('agent-preset/selected', session.id, event.data.agentPreset)
    })
  }

  /**
   * The preset id mounted when a caller names none.
   *
   * Read per call rather than cached: the settings document is hot-reloaded, so
   * changing the default takes effect on the next session created and leaves
   * every running session on the preset it was composed from.
   */
  get defaultId(): string {
    return this.settings?.get().default ?? this.config.default
  }

  /**
   * Every preset the configured roots currently supply.
   * @returns the presets, first-root-wins per id.
   */
  async list(): Promise<AgentPreset[]> {
    return await discoverPresets(this.resolvedRoots)
  }

  /**
   * Resolve one preset by id.
   *
   * A broken preset resolves — deleting one, reading one, and reporting one
   * all need the row — and the mounting paths refuse it AFTER resolution
   * through {@link resolveMountable}.
   * @param id - the preset id, or `undefined` for {@link defaultId}.
   * @returns the resolved preset.
   * @throws when no configured root supplies that id.
   */
  async resolve(id?: string): Promise<AgentPreset> {
    const wanted = id ?? this.defaultId
    const presets = await this.list()
    const found = presets.find(preset => preset.id === wanted)
    if (found === undefined) {
      throw new UnknownPresetError(wanted, presets.map(preset => preset.id))
    }
    return found
  }

  /**
   * Resolve one preset that is about to compose an agent, refusing a broken
   * one with its discovery-reported reason. Failing here rather than inside
   * the loader keeps the answer the same for every unloadable shape — ghost
   * directory, unparsable YAML, rowless list — and spends no mount attempt
   * on a composition discovery already read as unusable.
   * @param id - the preset id, or `undefined` for {@link defaultId}.
   * @returns the resolved, mountable preset.
   * @throws when the preset is unknown or discovery reports it broken.
   */
  private async resolveMountable(id?: string): Promise<AgentPreset> {
    const preset = await this.resolve(id)
    if (preset.broken !== undefined) {
      throw new PresetMountError(preset.id, preset.broken)
    }
    return preset
  }

  /**
   * Standing mounts by preset id, single-flight so two agents racing the
   * first use of one preset share one composition. A settled failure is
   * removed so a later session retries a preset whose file has been fixed; a
   * settled success serves until the composition FILE visibly changes — each
   * generation records its file stamp, and a stale stamp starts the next
   * generation for sessions created afterwards. Sessions already joined keep
   * the generation they run on; a superseded one is never disposed while the
   * process lives (reclaimed only by whole-tree teardown), so editing files
   * is bounded by how often compositions change, not by session count.
   */
  private readonly standing = new Map<string, Promise<StandingMount>>()

  /**
   * Parent bindings of the agents this roster composed, keyed by the agent's
   * scope key. The binding is dsh-scope's only re-link capability; holding it
   * here makes this service the sole authority that can move an agent between
   * standing compositions. WeakMap: entries die with their agents.
   */
  private readonly bindings = new WeakMap<ScopeKey, ScopeParentBinding>()

  /**
   * Compose one agent from a preset: ensure the preset's standing mount, then
   * parent the agent's scope key to it so the mount's registrations and
   * listeners cover this agent.
   *
   * Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
   * the agent creation back, so a broken preset never yields a half-composed
   * session.
   * @param agentCtx - the agent's scope context.
   * @param id - the preset id, or `undefined` for {@link defaultId}.
   * @returns the preset that was composed, for the caller to record.
   * @throws when the preset is unknown or its composition is unusable.
   */
  async mount(agentCtx: Context, id?: string): Promise<AgentPreset> {
    const agentKey = scopeOf(agentCtx)
    if (agentKey === undefined) {
      throw new Error('agent-presets: refusing to compose an unscoped context; the scope key is what joins an agent to its preset')
    }
    const preset = await this.resolveMountable(id)
    const standing = await this.ensureStanding(preset)
    // The one bind of this agent's ancestry. The binding is the only re-link
    // authority, held privately so nothing outside this roster can move a
    // composed agent to another preset; a later recompose layer re-links
    // through it under the caller-owned blank-session contract.
    this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key))
    return preset
  }

  /**
   * Join one agent to the SAME standing composition another already runs on.
   *
   * This is how a child agent inherits its parent's capabilities. It is a bind,
   * not a mount: the parent's generation is already composed, so the child gets
   * that exact instance — the same plugin objects, the same tool registrations,
   * the same prompt sections. Re-resolving the parent's preset by id instead
   * would re-read the roster, and a composition file edited since the parent
   * started would hand the child a DIFFERENT generation than the one its
   * parent's history was produced under (and a preset deleted since would fail
   * the child outright while its parent keeps running).
   *
   * Synchronous, and with no composition failure mode of its own — it reads no
   * roster, mounts nothing, and touches no file — which is what lets a child
   * creation window use it: the two in-process subagent drivers compose their
   * children inside a synchronous `setup`. It still rejects a caller error, as
   * the `@throws` below record.
   *
   * A parent that joined no preset — a rosterless deployment — yields no join
   * and no error: there, the model-facing rows sit in the host composition and
   * the child already sees them through the global layer.
   * @param agentCtx - the joining agent's scope context.
   * @param parentCtx - the scope context of the agent whose composition to join.
   * @returns the preset id joined, or undefined when the parent joined none.
   * @throws when `agentCtx` carries no scope, or has already joined a preset.
   */
  composeFrom(agentCtx: Context, parentCtx: Context): string | undefined {
    const agentKey = scopeOf(agentCtx)
    if (agentKey === undefined) {
      throw new Error('agent-presets: refusing to compose an unscoped context; the scope key is what joins an agent to its preset')
    }
    const standing = standingMountFor(parentCtx)
    if (standing === undefined) return undefined
    this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key))
    return standing.presetId
  }

  /**
   * The preset one live agent runs on.
   *
   * Read from the live scope chain rather than from the session, so it answers
   * for an agent whose session has not recorded a preset yet — a child agent
   * whose durable header is being built from its parent's composition.
   * @param agentCtx - the agent's scope context.
   * @returns the preset id, or undefined when the agent joined none.
   */
  composedPreset(agentCtx: Context): string | undefined {
    return standingMountFor(agentCtx)?.presetId
  }

  /**
   * The roots this roster scans, which is not `config.roots`: it is every
   * configured root in order, then the harness-home user root unless
   * `includeUserRoot` is false. Read this — not the config field — to answer
   * whether a roster is composed at all, so one derivation decides it.
   */
  get roots(): readonly PresetRoot[] {
    return this.resolvedRoots
  }

  /** Whether this deployment has a root locally authored presets go to. */
  get authorable(): boolean {
    return this.resolvedRoots.some(root => root.trust === 'user')
  }

  /**
   * Read one preset's composition text.
   * @param id - the preset id.
   * @returns the composition exactly as stored.
   * @throws when no configured root supplies that id.
   */
  async read(id: string): Promise<string> {
    return await readComposition(await this.resolve(id))
  }

  /**
   * Create a locally authored preset by copying an existing one whole.
   *
   * Copy is the only authoring write. Composition text never crosses this
   * seam: the source is named by id and its directory is copied as it stands,
   * so the copy is exactly as loadable as its source and authoring grants no
   * capability the roster did not already carry. The copy is NOT mounted to
   * validate — a source that mounts today yields a copy that mounts today.
   * @param from - the preset the copy starts from; shipped presets are the
   * primary source, so any trust is accepted.
   * @param id - the new preset's id, which becomes its directory name.
   * @param name - display name for the copy; absent falls back to the id.
   * @throws when the source is unknown, the id is unusable or already taken,
   * or the deployment configures no writable root.
   */
  async copy(from: string, id: string, name?: string): Promise<void> {
    const source = await this.resolve(from)
    // The roster check refuses ids any root supplies — shipped ones included,
    // since a user directory named like a shipped preset is shadowed by it.
    // The disk check inside copyComposition only sees the writable root.
    if ((await this.list()).some(preset => preset.id === id)) {
      throw new PresetExistsError(id)
    }
    await copyComposition(this.resolvedRoots, source, id, name)
    // A settled mount under this id can only be stale (its preset was deleted
    // from disk outside `remove`); the new preset must not inherit it. Every
    // session already joined keeps the generation it runs on regardless.
    this.standing.delete(id)
  }

  /**
   * Write a locally authored preset from composition rows.
   *
   * The sanctioned exception to "no caller supplies composition text": the
   * platform preset assembler renders a validated tree and commits it through
   * this primitive. The caller owns render + static validation — this method
   * accepts the rows as given and refuses only a wrong id or an occupied slot.
   * The write is NOT mounted to validate; loader-level checks (`inactiveRows`
   * / `leakedServices`) run at mount.
   * @param id - the new preset's id, which becomes its directory name.
   * @param rows - the composition rows to persist.
   * @param meta - display metadata to publish beside the composition.
   * @throws when the id is unusable or already taken, or the deployment
   * configures no writable root.
   */
  async write(id: string, rows: readonly EntryOptions[], meta?: PresetMetadata): Promise<void> {
    // The roster check refuses ids any root supplies, mirroring `copy`.
    if ((await this.list()).some(preset => preset.id === id)) {
      throw new PresetExistsError(id)
    }
    await writeComposition(writableRoot(this.resolvedRoots), id, rows, meta)
    // A settled mount under this id can only be stale; the fresh preset must
    // not inherit it. Every session already joined keeps its generation.
    this.standing.delete(id)
  }

  /**
   * Read one preset's composition as rows, for the composer.
   *
   * The structured twin of `read`: the same composition, parsed with the
   * loader's own YAML dialect so a `!!js` `disabled` row survives. The browser
   * receives rows rather than YAML text because editing is a row operation —
   * parsing stays on the host.
   * @param id - the preset id.
   * @returns the composition's entry rows.
   * @throws when no configured root supplies that id or the composition does
   * not parse as an entry list.
   */
  async readRows(id: string): Promise<ComposeRow[]> {
    return await parseComposition(await readComposition(await this.resolve(id)))
  }

  /**
   * Write a locally authored preset's composition from rows, creating it or
   * replacing it in place.
   *
   * The browser-facing authoring write. Unlike `write` (rows accepted as given
   * by a trusted in-process caller), this method enforces the composition
   * invariants the preset domain owns — a non-empty row list, a plugin module
   * per row, unique row ids — and the "only installed plugins may be composed"
   * rule through a REQUIRED resolvability proof: `assertResolvable` returns
   * the module names the rows reference that are not installed, and a non-empty
   * answer refuses the whole composition with {@link ComposeModuleError}. The
   * wire layer supplies the inventory-backed proof, so no caller can bypass
   * it. `overwrite` selects replace-in-place over create: replacing refuses a
   * preset that ships with the deployment, because only a locally authored
   * preset is the user's to overwrite.
   * The write is NOT mounted to validate; loader-level checks (`inactiveRows`
   * / `leakedServices`) run at mount, as they do for every authored preset.
   * @param id - the preset id, which becomes its directory name.
   * @param rows - the composition rows to persist.
   * @param meta - display metadata to publish beside the composition.
   * @param options - create-vs-replace choice and the resolvability proof.
   * @throws when the id is unusable, the rows violate a composition invariant,
   * a module does not resolve, the deployment configures no writable root, or
   * (replacing) the preset does not exist or ships with the deployment.
   */
  async compose(
    id: string,
    rows: readonly ComposeRow[],
    meta: PresetMetadata | undefined,
    options: {
      /** Whether to replace an existing preset in place (false = create). */
      overwrite: boolean
      /**
       * Prove every module a row names is installed. Returns the unresolved
       * module names; a non-empty result refuses the composition.
       */
      assertResolvable: (rows: readonly ComposeRow[]) => readonly string[]
    },
  ): Promise<void> {
    await this.composeTo(id, rows, meta, options)
  }

  /**
   * Write a locally authored preset's composition AND companion graph from a
   * preset composition graph.
   *
   * The graph authoring write behind `agentPreset.saveGraph`. The graph is the
   * AUTHORING source: its agent nodes' `composition` fields project exactly the
   * rows that mount, so the rows are DERIVED here (`graphToRows`) and validated
   * exactly as {@link compose} validates them — non-empty, module-per-row,
   * unique ids, the resolvability proof — and one authoring primitive writes
   * both files: `agent.cordis.yml` from the derived rows and `agent.flow.json`
   * beside it holding the graph as authored. A graph with a condition or loop
   * node, an agent without a composition module, or a cycle is refused before
   * any write. The graph's display name and the preset's are one thing: a given
   * `meta.name` also becomes the stored graph's name, so the roster and the
   * canvas agree.
   * @param id - the preset id, which becomes its directory name.
   * @param graph - the preset composition graph to persist.
   * @param meta - display metadata to publish beside the composition.
   * @param options - create-vs-replace choice and the resolvability proof.
   * @throws when {@link compose} throws, or the graph does not project rows.
   */
  async composeGraph(
    id: string,
    graph: FlowGraph,
    meta: PresetMetadata | undefined,
    options: {
      /** Whether to replace an existing preset in place (false = create). */
      overwrite: boolean
      /**
       * Prove every module the projected rows name is installed. Returns the
       * unresolved module names; a non-empty result refuses the composition.
       */
      assertResolvable: (rows: readonly ComposeRow[]) => readonly string[]
    },
  ): Promise<void> {
    const rows = graphToRows(graph)
    const normalized = meta?.name === undefined ? graph : { ...graph, name: meta.name }
    await this.composeTo(id, rows, meta, options, normalized)
  }

  /**
   * Read one preset's composition graph, regenerating a stale or absent layout.
   *
   * The graph authoring read behind `agentPreset.readGraph`. The stored
   * `agent.flow.json` is a layout cache: it serves only while it still projects
   * exactly the rows parsed from the composition file (a hand edit or a legacy
   * rows-composer write wins), and otherwise the rows are re-projected as a
   * fresh chain graph. Backward compatible: an older preset with no graph file
   * regenerates on open.
   * @param id - the preset id.
   * @returns the preset's composition graph.
   * @throws when no configured root supplies that id, or the composition does
   * not parse.
   */
  async readGraph(id: string): Promise<FlowGraph> {
    const preset = await this.resolve(id)
    const rows = await parseComposition(await readComposition(preset))
    const stored = await readCompositionGraph(preset, rows)
    if (stored !== undefined) return stored
    return rowsToGraph(preset.id, preset.name ?? preset.id, rows)
  }

  /**
   * The shared rows-composition core behind {@link compose} and
   * {@link composeGraph}: validate the rows three ways, then write them through
   * the authoring primitive, carrying the companion graph when the caller
   * authors a preset graph so one write commits both files.
   */
  private async composeTo(
    id: string,
    rows: readonly ComposeRow[],
    meta: PresetMetadata | undefined,
    options: {
      overwrite: boolean
      assertResolvable: (rows: readonly ComposeRow[]) => readonly string[]
    },
    graph?: FlowGraph,
  ): Promise<void> {
    if (rows.length === 0) {
      throw new PresetNotWritableError(id, 'a composition needs at least one plugin row')
    }
    const seen = new Set<string>()
    for (const row of rows) {
      if (typeof row.name !== 'string' || row.name === '') {
        throw new PresetNotWritableError(id, 'every row must name a plugin module')
      }
      if (row.id !== undefined) {
        if (row.id === '') throw new PresetNotWritableError(id, 'every row id must be non-empty')
        if (seen.has(row.id)) throw new PresetNotWritableError(id, `row id "${row.id}" is repeated`)
        seen.add(row.id)
      }
    }
    const unresolved = options.assertResolvable(rows)
    if (unresolved.length > 0) throw new ComposeModuleError(id, unresolved)
    // The composition rows are the JSON-safe subset of a loader entry; the
    // YAML dump reads exactly the fields that subset carries.
    const entryRows = rows as readonly EntryOptions[]
    if (options.overwrite) {
      const preset = await this.resolve(id)
      if (preset.trust !== 'user') {
        throw new PresetNotWritableError(id, 'only a locally authored preset may be overwritten')
      }
      await replaceComposition(writableRoot(this.resolvedRoots), id, entryRows, meta, graph)
    } else {
      // The roster check refuses ids any root supplies, mirroring `write`.
      if ((await this.list()).some(preset => preset.id === id)) {
        throw new PresetExistsError(id)
      }
      await writeComposition(writableRoot(this.resolvedRoots), id, entryRows, meta, graph)
    }
    // A settled mount under this id can only be stale; the fresh preset must
    // not inherit it. Every session already joined keeps its generation.
    this.standing.delete(id)
  }

  /**
   * Delete a locally authored preset.
   * @param id - the preset id.
   * @throws when the preset is unknown or ships with the deployment.
   */
  async remove(id: string): Promise<void> {
    await deleteComposition(this.resolvedRoots, await this.resolve(id))
    // Sessions on the deleted preset keep their standing mount; only new
    // sessions see the roster without it.
    this.standing.delete(id)
    // Storing a default that does not exist YET is deliberate — the roster is a
    // live directory, so a name absent now may exist by the time a session asks
    // for it, and `resolve` reports it then. A default this call just deleted is
    // not that case: nothing will ever supply it again, and left in place every
    // session created without an explicit pick would fail to start. Clearing it
    // exposes the deployment's own default underneath, which is the layering.
    if (this.settings?.get().default !== id) return
    await this.settingsService?.mutate(
      settingsNamespace(SETTINGS_NAMESPACE),
      [{ op: 'unset', path: ['default'] }],
    )
  }

  /**
   * One agent's instance of a service its preset mounted.
   *
   * A preset publishes services behind `isolate` realms, which are invisible
   * outside the group that declares them — including to the host. This is how a
   * caller holding the agent reads one anyway: a request that is ABOUT a
   * session but arrives from outside it, which is every browser RPC.
   *
   * Read addressing only. A host row that `inject`s a service cannot use this,
   * because injection resolves before any session exists and has no agent to
   * key by; such a service belongs on the host plane instead.
   * @param agent - the agent whose composition to look inside.
   * @param name - the service name as the preset's rows resolve it.
   * @returns the agent's instance, or undefined when its preset mounts none.
   */
  serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined {
    return serviceForAgent(this.ctx, agent, name)
  }

  /**
   * Re-link one agent to a different preset's standing composition.
   *
   * Only valid while the agent has produced nothing: swapping tools mid
   * conversation would leave logged tool calls the new composition cannot
   * make. The CALLER owns that check — this method does not read session
   * history.
   *
   * The swap is a parent re-link, not an unmount: standing mounts are shared
   * and permanent, so the old composition stays for its other agents and the
   * new one is ensured BEFORE the link moves. An unknown or unusable preset
   * therefore throws with the agent exactly as it was — there is no torn-down
   * state to restore. The re-link runs through the binding this roster kept
   * from the agent's mount — dsh-scope's only re-link authority. An agent
   * that never composed one has nothing to re-link: the switch is then the
   * agent's first bind, exactly a mount.
   * @param agentCtx - the agent's scope context.
   * @param id - the preset to compose the agent from instead.
   * @returns the preset now installed.
   * @throws when the preset is unknown or its composition is unusable.
   */
  async recompose(agentCtx: Context, id: string): Promise<AgentPreset> {
    const agentKey = scopeOf(agentCtx)
    if (agentKey === undefined) {
      throw new Error('agent-presets: refusing to recompose an unscoped context')
    }
    const preset = await this.resolveMountable(id)
    const standing = await this.ensureStanding(preset)
    const binding = this.bindings.get(agentKey)
    if (binding === undefined) {
      this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key))
    } else {
      binding.rebind(standing.key)
    }
    return preset
  }

  /**
   * The standing scope key of one preset, for a host reader with no agent.
   *
   * A cold transcript read resolves tool presenters against the composition
   * the session recorded, and the standing mount makes that possible without
   * resuming anything: ensuring the mount composes plugins but starts no
   * agent, no session, and no turn.
   * @param id - the preset id, or `undefined` for {@link defaultId}.
   * @returns the standing scope key readers pass as a registry view scope.
   * @throws when the preset is unknown or its composition is unusable.
   */
  async standingKeyFor(id?: string): Promise<ScopeKey> {
    const preset = await this.resolveMountable(id)
    return (await this.ensureStanding(preset)).key
  }

  /** Resolve (or create, single-flight) the standing mount of one preset. */
  private async ensureStanding(preset: AgentPreset): Promise<StandingMount> {
    const pending = this.standing.get(preset.id)
    if (pending !== undefined) {
      const mounted = await pending
      // Files are the only composition editor (authoring is copy/delete), so
      // the stamp is what notices an edit: a changed file starts the next
      // generation here, for this and later sessions. An unreadable stamp
      // serves the current generation — a mount must survive its file
      // disappearing, and failing the session over a stat would not.
      const current = await compositionStamp(preset.path)
      if (current === undefined || sameStamp(mounted.stamp, current)) return mounted
      // TODO: reclaim the superseded generation once the last agent joined to
      // it is gone. The subtree is not inert — `dsh-skill-filesystem` watches its
      // roots — and the settings-page authoring flow turns "a composition
      // changed" into a per-save event. This needs a joined-agent count on
      // StandingMount, incremented in `mount`/`composeFrom`/`recompose` and
      // decremented when the agent's scope key dies.
      // Guarded delete: a caller that raced this one may have already started
      // the next generation, and dropping THAT pointer would fork a third.
      if (this.standing.get(preset.id) === pending) this.standing.delete(preset.id)
      return this.ensureStanding(preset)
    }
    const created = (async (): Promise<StandingMount> => {
      const key: ScopeKey = { agentPreset: preset.id }
      const scope = createScope(this.selfCtx, key)
      try {
        // Stamped before the file is read: an edit racing the mount makes the
        // stamp stale rather than silently current, so the next session
        // refreshes instead of trusting a composition older than its stamp.
        const stamp = await compositionStamp(preset.path)
        if (stamp === undefined) {
          throw new PresetMountError(preset.id, `composition file is unreadable: ${preset.path}`)
        }
        await mountPreset(scope.ctx, preset)
        return { key, scope, stamp }
      } catch (error) {
        this.standing.delete(preset.id)
        await scope.dispose()
        throw error
      }
    })()
    this.standing.set(preset.id, created)
    return created
  }
}

/** The composition file identity one standing generation was mounted from. */
interface CompositionStamp {
  /** Modification time in milliseconds, as `stat` reports it. */
  readonly mtimeMs: number
  /** File size in bytes, the tiebreak for edits within one mtime tick. */
  readonly size: number
}

/** Read one composition file's stamp, or undefined when it cannot be statted. */
async function compositionStamp(path: string): Promise<CompositionStamp | undefined> {
  try {
    const { mtimeMs, size } = await stat(path)
    return { mtimeMs, size }
  } catch {
    // Deleted, replaced by an unreadable entry, or otherwise unstattable all
    // mean the same to the caller: the file offers no identity to compare.
    return undefined
  }
}

/** Whether two stamps name the same file state. */
function sameStamp(a: CompositionStamp, b: CompositionStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size
}

/** One preset's standing composition. */
interface StandingMount {
  /** Scope key agents are parented to; also the mount's registration scope. */
  readonly key: ScopeKey
  /** Disposal boundary; held for whole-tree teardown, never per-session. */
  readonly scope: Scope
  /** Stamp of the composition file this generation was mounted from. */
  readonly stamp: CompositionStamp
}

export default AgentPresets
