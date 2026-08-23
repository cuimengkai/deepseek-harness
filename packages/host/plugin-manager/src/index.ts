/**
 * Live online plugin install/uninstall for the Web console. The gateway edits
 * only the home-level user patch layer (`$DSH_HOME/cordis.patch.yml`); the
 * running Host's config-HMR watcher recomposes and the root Include mounts or
 * unmounts the fiber without a restart. Network installs land in a per-plugin
 * npm store under `$DSH_HOME/profiles/node_modules/.dsh-plugins/`, with a
 * symlink into the healed `profiles/node_modules` fallback so the plugin shares
 * the Host's single cordis; provenance is recorded in the ledger.
 * @module @deepseek-ai/dsh-host-plugin-manager
 */

import { join } from 'node:path'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import s from '@deepseek-ai/schemastery'
import { PROFILES_DIR } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { DEFAULT_SOURCES } from './catalog.ts'
import {
  cacheDirectory,
  refreshSource,
  type CatalogEntrySeed,
  type CatalogSourceSnapshot,
  type RefreshSourceOptions,
} from './catalog-sources.ts'
import {
  isManagedInsertFor,
  managedEntryId,
  readHomePatchRows,
  rowEntryNames,
  updateHomePatch,
  upsertDisabledOverride,
} from './home-patch.ts'
import { readLedger, updateLedger, type InstalledPluginRecord } from './ledger.ts'
import * as store from './store.ts'
import { validateSeeds, type ProbeVerdict } from './validator.ts'
import type {
  PluginCatalogDescriptor,
  PluginManagerCatalogEntry,
  PluginManagerCatalogSnapshot,
  PluginManagerCatalogSourceDescriptor,
  PluginManagerCatalogSourceStatus,
  PluginManagerEntryId,
  PluginManagerFiberPhase,
  PluginManagerInstallCapabilities,
  PluginManagerInstallRequest,
  PluginManagerInstallResult,
  PluginManagerUninstallRequest,
  PluginManagerUninstallResult,
  PluginManagerUninstallValue,
} from './types.ts'

export type * from './types.ts'

/** Default outbound manifest-fetch timeout in milliseconds. */
/** Default outbound manifest-fetch budget: the curated-list tarball is
 * multi-MB, so 10s was too tight for a cold codeload download. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000

/**
 * Module names the plugin manager executes on: the gateway itself, the
 * inventory it renders, and the API/typert gateways that carry its wire calls.
 * Disabling any of these would take the manager's own runtime base offline
 * in-process, so uninstall refuses them with `in-use`. This is a fixed security
 * invariant (the manager cannot delete the hand that holds it), not a tunable;
 * `include` and `hmr` rows are deliberately excluded — the include root is
 * created programmatically (not a patch row) and profile boot recreates a
 * watch-only HMR instance when the row is disabled.
 */
const IRREMOVABLE_MODULES = new Set([
  '@deepseek-ai/dsh-host-plugin-manager',
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-typert-registry',
])

/** Deployment policy: catalog sources and the network install surface. */
export interface Config {
  /** Catalog sources, merged in order. Defaults to the awesome curated list and
   * the GitHub `dsh-plugin` topic search. */
  readonly sources?: readonly PluginManagerCatalogSourceDescriptor[]
  /** Locally-resolvable catalog; normalized to a `static` source when `sources`
   * is absent. */
  readonly catalog?: readonly PluginCatalogDescriptor[]
  /** Skip all network fetches and installs; serve only cached and static entries. */
  readonly offline?: boolean
  /** Root network installs write under. Defaults to `$DSH_HOME/profiles`. */
  readonly installPrefix?: string
  /** Package-manager executable. Defaults to `npm`. */
  readonly packageManager?: string
  /** Outbound manifest-fetch timeout in milliseconds. Defaults to 30_000. */
  readonly fetchTimeoutMs?: number
  /** Cache TTL override in milliseconds for network sources. */
  readonly cacheTtlMs?: number
  /** Run network package-manager installs under the OS sandbox (a
   * `workspace-write` file policy); installs refuse when enabled but no sandbox
   * backend is usable. Defaults to `true`. */
  readonly installSandbox?: boolean
  /** Permit lifecycle scripts at all; the per-request `allowScripts` flag is
   * ANDed with this. Defaults to `false` (`--ignore-scripts` on every install). */
  readonly allowInstallScripts?: boolean
  /** Require an explicit `confirmed: true` on every network install. Defaults to
   * `true`. */
  readonly requireInstallConfirmation?: boolean
  /** How many uncached repos one catalog pass may probe for npm-installability.
   * Defaults to `10`. */
  readonly validationProbeBudget?: number
  /** How long a probe verdict stays fresh before a re-probe. Defaults to 24h. */
  readonly validationProbeTtlMs?: number
  /** Run the npm-installability probe on awesome-list entries too (the curated
   * list is trusted by default). Defaults to `false`. */
  readonly probeAwesome?: boolean
}

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginManagerEntryId(value: string): PluginManagerEntryId {
  return value as PluginManagerEntryId
}

/** A composed-tree spine entry matched by module name, using its bare patch id. */
interface BundledEntry {
  /** Bare `options.id` the home patch targets (not the `include:`-prefixed id). */
  readonly id: string
  /** Module specifier the entry imports. */
  readonly name: string
  /** Effective Loader enablement. */
  readonly enabled: boolean
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginManagerFiberPhase>

/** Build a frozen success branch. */
function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return Object.freeze({ ok: true, value })
}

/** Build a frozen business-rejection branch. */
function rejected<E>(error: E): { readonly ok: false; readonly error: E } {
  return Object.freeze({ ok: false, error })
}

/**
 * A valid bare module specifier for a managed row: non-empty, no scheme or
 * `cordis:` prefix, not relative, and free of whitespace. The Loader remains
 * the authority on whether the module resolves.
 * @param name - the raw request name.
 * @returns the canonical specifier, or `undefined` when invalid.
 */
function validateInstallName(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed.includes(':') || trimmed.startsWith('.') || /\s/.test(trimmed)) {
    return undefined
  }
  return trimmed
}

/**
 * The configured sources: an explicit non-empty `sources`, else a non-empty
 * legacy `catalog` as one static source, else the shipped defaults. schemastery
 * defaults an absent array to `[]`, so a zero-length array means "not supplied"
 * and falls through to the next branch — an empty config therefore reaches the
 * awesome + topic defaults rather than an empty static source.
 */
function resolveSources(config: Config): readonly PluginManagerCatalogSourceDescriptor[] {
  if (config.sources !== undefined && config.sources.length > 0) return config.sources
  if (config.catalog !== undefined && config.catalog.length > 0) {
    return [{ id: 'catalog', kind: 'static', entries: config.catalog }]
  }
  return DEFAULT_SOURCES
}

/** Project one refreshed source onto the public status shape. */
function sourceStatus(refreshed: CatalogSourceSnapshot): PluginManagerCatalogSourceStatus {
  return {
    id: refreshed.id,
    kind: refreshed.kind,
    state: refreshed.state,
    entryCount: refreshed.entries.length,
    ...(refreshed.fetchedAt === undefined ? {} : { lastUpdated: new Date(refreshed.fetchedAt).toISOString() }),
    ...(refreshed.error === undefined ? {} : { error: refreshed.error }),
  }
}

/**
 * Best-effort rollback of a partially-completed network install: remove the
 * symlink (when the module was discovered), the store, and any ledger row.
 * Cleanup failures are swallowed — the original install failure is the reported
 * outcome, and a leftover store is an idempotently-cleanable orphan.
 */
async function rollbackNetwork(
  installPrefix: string,
  slugDir: string,
  name: string,
  moduleName: string | undefined,
): Promise<void> {
  try {
    if (moduleName !== undefined) store.removeModuleSymlink(installPrefix, moduleName)
    store.removeStoreDir(slugDir)
    await updateLedger((ledger) => { ledger.delete(name) })
  } catch {
    // Rollback is best-effort; the original failure is the reported outcome.
  }
}

/** Live install/uninstall gateway over the home-level user patch layer. */
export class PluginManagerGateway extends TypertRemoteService {
  static inject = ['loader']

  /** Loader validation for the catalog sources and network install surface. */
  static Config = s.object({
    sources: s.array(s.union([
      s.object({
        id: s.string().required(),
        kind: s.const('static'),
        entries: s.array(s.object({
          name: s.string().required(),
          description: s.string(),
        })),
      }),
      s.object({
        id: s.string().required(),
        kind: s.const('awesome'),
        owner: s.string(),
        repo: s.string(),
        branch: s.string(),
      }),
      s.object({
        id: s.string().required(),
        kind: s.const('topic'),
        topic: s.string().required(),
        perPage: s.number(),
      }),
      s.object({
        id: s.string().required(),
        kind: s.const('manifest'),
        url: s.string().required(),
      }),
    ])),
    catalog: s.array(s.object({
      name: s.string().required(),
      description: s.string(),
    })),
    offline: s.boolean(),
    installPrefix: s.string(),
    packageManager: s.string(),
    fetchTimeoutMs: s.number(),
    cacheTtlMs: s.number(),
    installSandbox: s.boolean(),
    allowInstallScripts: s.boolean(),
    requireInstallConfirmation: s.boolean(),
    validationProbeBudget: s.number(),
    validationProbeTtlMs: s.number(),
    probeAwesome: s.boolean(),
  })

  private readonly config: Config
  private readonly sources: readonly PluginManagerCatalogSourceDescriptor[]
  private readonly offline: boolean
  private readonly packageManager: string
  private readonly fetchTimeoutMs: number
  private readonly cacheTtlMs: number | undefined
  private readonly installSandbox: boolean
  private readonly allowInstallScripts: boolean
  private readonly requireInstallConfirmation: boolean
  private readonly validationProbeBudget: number
  private readonly validationProbeTtlMs: number
  private readonly probeAwesome: boolean
  /** One promise chain serializing every mutation inside this process. */
  private operationTail: Promise<unknown> = Promise.resolve()
  /** One in-flight fetch per network source id (dedupes parallel reads/installs). */
  private readonly refreshing = new Map<string, Promise<CatalogSourceSnapshot>>()
  /** One in-flight installability probe per repo (dedupes concurrent reads). */
  private readonly probeInFlight = new Map<string, Promise<ProbeVerdict>>()
  /** Whether a coalesced `plugin-manager/catalog-changed` emit is queued. */
  private catalogChangedQueued = false

  /**
   * @param ctx - Host context carrying the Loader.
   * @param config - catalog sources and install surface; defaults to the
   * awesome + topic sources and a live install prefix.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pluginManager')
    this.config = config
    this.sources = resolveSources(config)
    this.offline = config.offline ?? false
    this.packageManager = config.packageManager ?? 'npm'
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    this.cacheTtlMs = config.cacheTtlMs
    this.installSandbox = config.installSandbox ?? true
    this.allowInstallScripts = config.allowInstallScripts ?? false
    this.requireInstallConfirmation = config.requireInstallConfirmation ?? true
    this.validationProbeBudget = config.validationProbeBudget ?? 10
    this.validationProbeTtlMs = config.validationProbeTtlMs ?? 24 * 60 * 60 * 1000
    this.probeAwesome = config.probeAwesome ?? false
  }

  /** The install root: configured prefix, else the live home's profiles dir. */
  private installPrefixValue(): string {
    return this.config.installPrefix ?? join(resolveDshHome(), PROFILES_DIR)
  }

  /** Shared source-refresh options; `cacheTtlMs` is omitted unless configured. */
  private sourceOptions(force: boolean): RefreshSourceOptions {
    return {
      fetchTimeoutMs: this.fetchTimeoutMs,
      offline: this.offline,
      cacheDir: cacheDirectory(),
      force,
      inFlight: this.refreshing,
      ...(this.cacheTtlMs === undefined ? {} : { cacheTtlMs: this.cacheTtlMs }),
    }
  }

  /** Queue one mutation behind this process's previous mutation. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => {}, () => {})
    return run
  }

  /** Module names currently mounted in the composed tree. */
  private composedModuleNames(): ReadonlySet<string> {
    const names = new Set<string>()
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      names.add(entry.options.name)
    }
    return names
  }

  /**
   * Match a module name to a composed-tree spine entry. Group rows are skipped,
   * and entries carrying the `dsh-managed-` ownership marker are skipped so a
   * plugin-manager install keeps routing to the managed-row path instead of
   * being treated as a bundled row.
   * @param name - the module specifier to look up.
   * @returns the bundled entry and its bare patch id, or `undefined`.
   */
  private findBundledEntry(name: string): BundledEntry | undefined {
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      if (entry.options.id.startsWith('dsh-managed-')) continue
      if (entry.options.name !== name) continue
      return {
        id: entry.options.id,
        name: entry.options.name,
        enabled: !entry.disabled,
      }
    }
    return undefined
  }

  /**
   * Module names declared in the home patch, tolerating an unreadable layer:
   * `listAvailable` is a read; a corrupt optional layer must not hide the
   * catalog, while a mutation still fails loud rather than rewrite it.
   */
  private homePatchDeclaredNames(): ReadonlySet<string> {
    const names = new Set<string>()
    let rows
    try {
      rows = readHomePatchRows()
    } catch {
      return names
    }
    for (const row of rows) {
      for (const name of rowEntryNames(row)) names.add(name)
    }
    return names
  }

  /**
   * Validate one refreshed source's seeds through the list-time gate: syntax
   * checks always, plus the npm-installability probe for `topic` and (opt-in)
   * `awesome` sources when online. Invalid and unproven entries are dropped so
   * they never reach the wire or an install path.
   * @param source - the refreshed source.
   * @returns the surviving seeds and how many the gate dropped.
   */
  private async validatedSource(
    source: CatalogSourceSnapshot,
  ): Promise<{ readonly entries: readonly CatalogEntrySeed[]; readonly droppedCount: number }> {
    return validateSeeds(source.kind, source.entries, {
      probe: !this.offline && (source.kind === 'topic' || (source.kind === 'awesome' && this.probeAwesome)),
      probeOptions: {
        cacheDir: cacheDirectory(),
        budget: this.validationProbeBudget,
        ttlMs: this.validationProbeTtlMs,
        fetchTimeoutMs: this.fetchTimeoutMs,
      },
      inFlight: this.probeInFlight,
    })
  }

  /**
   * The provenance projection for an installed network entry: the ledger's
   * resolved version and integrity, plus a re-verification of the store lockfile
   * against the record. Static and uninstalled entries project nothing.
   */
  private entryProvenance(
    seed: CatalogEntrySeed,
    ledger: ReadonlyMap<string, InstalledPluginRecord>,
  ): { readonly version?: string; readonly integrity?: string; readonly integrityStatus?: 'ok' | 'tampered' | 'missing' } {
    if (seed.installKind !== 'network') return {}
    const record = ledger.get(seed.name)
    if (record === undefined) return {}
    const integrityStatus = store.verifyStoreIntegrity(record, this.installPrefixValue())
    return {
      ...(record.version === '' ? {} : { version: record.version }),
      ...(record.integrity === '' ? {} : { integrity: record.integrity }),
      integrityStatus,
    }
  }

  /**
   * The installable-catalog surface for the client's trust UI: whether network
   * installs require an explicit confirmation, whether lifecycle scripts are
   * permitted at all, and how package-manager installs are contained.
   */
  private capabilities(): PluginManagerInstallCapabilities {
    const sandbox = this.installSandbox
      ? (this.ctx.get('sandbox') === undefined ? 'unavailable' : 'confined')
      : 'unconfined'
    return {
      networkConfirmation: this.requireInstallConfirmation,
      allowInstallScripts: this.allowInstallScripts,
      installSandbox: sandbox,
    }
  }

  /** Wrap a package-manager argv under the OS sandbox when enabled. Returns
   * `undefined` when confinement is requested but no backend is usable — the
   * caller must refuse to run npm unconfined. */
  private confinedInstallArgv(argv: readonly string[], slugDir: string): readonly string[] | undefined {
    if (!this.installSandbox) return argv
    try {
      const confined = this.ctx.get('sandbox')?.confine(argv, { mode: 'workspace-write', workspaceRoot: slugDir })
      if (confined === undefined) return undefined
      return confined.argv
    } catch (error) {
      if (error instanceof SandboxUnavailableError) return undefined
      throw error
    }
  }

  /** Emit `plugin-manager/catalog-changed` once per frame, coalescing an
   * install/uninstall/refresh burst into a single client nudge. */
  private catalogChanged(): void {
    if (this.catalogChangedQueued) return
    this.catalogChangedQueued = true
    queueMicrotask(() => {
      this.catalogChangedQueued = false
      this.ctx.emit('plugin-manager/catalog-changed')
    })
  }

  /**
   * Read the merged catalog with each entry's current install state. Static
   * entries are installed when mounted or declared; network entries when the
   * ledger records them (mounted names are resolved module names, which the
   * ledger owns). Each source runs the list-time validation gate first.
   * @returns the merged catalog snapshot.
   */
  private async snapshot(force: boolean): Promise<PluginManagerCatalogSnapshot> {
    const mounted = this.composedModuleNames()
    const declared = this.homePatchDeclaredNames()
    const ledger = readLedger()
    const sources: PluginManagerCatalogSourceStatus[] = []
    const seeds: CatalogEntrySeed[] = []
    for (const source of this.sources) {
      const refreshed = await refreshSource(source, this.sourceOptions(force))
      const { entries, droppedCount } = await this.validatedSource(refreshed)
      sources.push({
        ...sourceStatus(refreshed),
        ...(droppedCount > 0 ? { filteredCount: droppedCount } : {}),
      })
      for (const seed of entries) {
        if (!seeds.some(existing => existing.name === seed.name)) seeds.push(seed)
      }
    }
    const entries: PluginManagerCatalogEntry[] = seeds.map(seed => ({
      ...seed,
      installed: seed.installKind === 'static'
        ? mounted.has(seed.name) || declared.has(seed.name)
        : ledger.has(seed.name) || mounted.has(seed.name),
      ...this.entryProvenance(seed, ledger),
    }))
    return { entries, sources, capabilities: this.capabilities() }
  }

  /**
   * Read the merged catalog, serving network sources from cache.
   * @returns the catalog snapshot.
   */
  @Remote('listAvailable')
  async listAvailable(): Promise<PluginManagerCatalogSnapshot> {
    return this.snapshot(false)
  }

  /**
   * Re-fetch every network source bypassing the cache and return the fresh
   * snapshot.
   * @returns the refreshed catalog snapshot.
   */
  @Remote('refreshCatalog')
  async refreshCatalog(): Promise<PluginManagerCatalogSnapshot> {
    const snapshot = await this.snapshot(true)
    this.catalogChanged()
    return snapshot
  }

  /**
   * Install one plugin from the merged catalog: look the name up across sources,
   * then either commit a managed home-patch row for a locally-resolvable module
   * or run a real package-manager network install before committing the row. The
   * returned value is a point-in-time snapshot — the mount lands asynchronously,
   * and the console refreshes the inventory to observe the outcome.
   * @param request - the public catalog name to install.
   * @returns the committed row, or a business rejection. Storage failures throw
   * and fold to `internal` on the wire.
   */
  // Wire name avoids the client RemoteNamespaceService's reserved `install`
  // (the mount helper on its prototype); the host method keeps the short name.
  @Remote('installPlugin')
  async install(request: PluginManagerInstallRequest): Promise<PluginManagerInstallResult> {
    const name = validateInstallName(request.name)
    if (name === undefined) return rejected({ code: 'invalid-name', name: request.name })
    const result = await this.enqueue(() => this.installEnqueued(name, request))
    if (result.ok) this.catalogChanged()
    return result
  }

  /**
   * The enqueued install: find the entry, pre-check, then the kind-specific
   * path. A name in no catalog source falls through to the bundled spine path,
   * which reinstalls a disabled harness plugin by lifting its disable override.
   */
  private async installEnqueued(name: string, request: PluginManagerInstallRequest): Promise<PluginManagerInstallResult> {
    const entry = await this.findInstallable(name)
    if (entry !== undefined) {
      if (this.installed(name, entry)) return rejected({ code: 'already-installed', name })
      if (entry.installKind === 'static') return this.installStatic(name)
      if (this.offline) return rejected({ code: 'offline', name })
      if (this.requireInstallConfirmation && !request.confirmed) {
        return rejected({ code: 'confirmation-required', name })
      }
      return this.installNetwork(entry, name, request)
    }
    const bundled = this.findBundledEntry(name)
    if (bundled !== undefined) return this.installBundled(name, bundled)
    return rejected({ code: 'not-found', name })
  }

  /** Reinstall a disabled bundled spine plugin by clearing its disable override. */
  private async installBundled(name: string, entry: BundledEntry): Promise<PluginManagerInstallResult> {
    if (entry.enabled) return rejected({ code: 'already-installed', name })
    await updateHomePatch(rows => ({ applied: true, rows: upsertDisabledOverride(rows, entry.id, false) }))
    return this.installValue(name, entry.id)
  }

  /** Whether the catalog entry is already installed by any authoritative route. */
  private installed(name: string, entry: CatalogEntrySeed): boolean {
    if (this.composedModuleNames().has(name)) return true
    if (readLedger().has(name)) return true
    if (entry.installKind === 'static' && this.homePatchDeclaredNames().has(name)) return true
    return false
  }

  /**
   * Look one public catalog name up across the merged sources, applying the same
   * list-time validation gate as the snapshot so a dropped entry is not
   * installable by a direct call. Each source is refreshed on demand
   * (cache-served when fresh), so a not-found reflects the current catalog even
   * under network failures — a failed source contributes no entries.
   */
  private async findInstallable(name: string): Promise<CatalogEntrySeed | undefined> {
    for (const source of this.sources) {
      const refreshed = await refreshSource(source, this.sourceOptions(false))
      const { entries } = await this.validatedSource(refreshed)
      for (const seed of entries) {
        if (seed.name === name) return seed
      }
    }
    return undefined
  }

  /** Commit a managed row for a locally-resolvable module (the v1 path). */
  private async installStatic(name: string): Promise<PluginManagerInstallResult> {
    const entryId = managedEntryId(name)
    const mutation = await updateHomePatch<'already-installed'>((rows) => {
      if (rows.some(row => isManagedInsertFor(row, entryId, name))) {
        return { applied: false, code: 'already-installed' }
      }
      return { applied: true, rows: [...rows, { insert: [{ id: entryId, name }] }] }
    })
    if (!mutation.applied) return rejected({ code: mutation.code, name })
    return this.installValue(name, entryId)
  }

  /**
   * Install a network entry: build the store, run the package manager under the
   * sandbox (scripts disabled unless the deployment and request both opt in),
   * discover the resolved module name, symlink it into the healed fallback,
   * record provenance with its version and integrity, then commit the managed
   * row so HMR mounts it. Every pre-row failure rolls the store back; a collision
   * with an already-mounted or already-managed resolved module is reported as
   * `already-installed`.
   */
  private async installNetwork(
    entry: CatalogEntrySeed,
    name: string,
    request: PluginManagerInstallRequest,
  ): Promise<PluginManagerInstallResult> {
    const installPrefix = this.installPrefixValue()
    const { slugDir } = store.storePaths(installPrefix, name)
    const installRef = entry.installRef ?? name
    let moduleName: string | undefined
    try {
      store.ensureStoreDir(slugDir)
      const argv = [this.packageManager, ...store.installArgv(installRef, {
        ignoreScripts: !(this.allowInstallScripts && request.allowScripts === true),
        cacheDir: join(slugDir, '.npm-cache'),
      })]
      const invocation = this.confinedInstallArgv(argv, slugDir)
      if (invocation === undefined) {
        await rollbackNetwork(installPrefix, slugDir, name, undefined)
        return rejected({ code: 'sandbox-unavailable', name })
      }
      const [program, ...rest] = invocation
      if (program === undefined) {
        await rollbackNetwork(installPrefix, slugDir, name, undefined)
        return rejected({ code: 'install-failed', name, message: 'empty package-manager argv' })
      }
      const run = store.runPackageManager(program, rest, { cwd: slugDir })
      if (!run.ok) {
        await rollbackNetwork(installPrefix, slugDir, name, undefined)
        return rejected({
          code: 'install-failed',
          name,
          message: run.stderr !== '' ? run.stderr : `package manager exited ${run.status}`,
        })
      }
      try {
        moduleName = store.discoverInstalledModuleName(slugDir)
      } catch (error) {
        await rollbackNetwork(installPrefix, slugDir, name, undefined)
        return rejected({ code: 'install-failed', name, message: error instanceof Error ? error.message : String(error) })
      }
      // A const capture keeps the resolved name narrowed inside the closures
      // below, which TS refuses to narrow through a mutable `let` reference.
      const resolved = moduleName
      if (this.moduleCollides(resolved)) {
        await rollbackNetwork(installPrefix, slugDir, name, resolved)
        return rejected({ code: 'already-installed', name, message: `resolves to the managed module ${resolved}` })
      }
      const entryId = managedEntryId(resolved)
      store.ensureModuleSymlink(installPrefix, resolved, slugDir)
      const { version, integrity } = store.readInstalledIntegrity(slugDir, resolved)
      await updateLedger((ledger) => {
        ledger.set(name, {
          moduleName: resolved,
          slug: store.storeSlug(name),
          installRef,
          source: entry.source,
          installedAt: Date.now(),
          version,
          integrity,
        })
      })
      const mutation = await updateHomePatch<'already-installed'>((rows) => {
        if (rows.some(row => isManagedInsertFor(row, entryId, resolved))) {
          return { applied: false, code: 'already-installed' }
        }
        return { applied: true, rows: [...rows, { insert: [{ id: entryId, name: resolved }] }] }
      })
      if (!mutation.applied) {
        await rollbackNetwork(installPrefix, slugDir, name, resolved)
        return rejected({ code: 'already-installed', name, message: `resolves to the managed module ${resolved}` })
      }
      // `return await` keeps the install failure on this frame's stack for the
      // rollback `catch` below (error-handling-correctness-only).
      return await this.installValue(resolved, entryId)
    } catch (error) {
      // A storage failure mid-install left the store/symlink/ledger partial;
      // roll back best-effort and rethrow so the wire sees `internal`.
      await rollbackNetwork(installPrefix, slugDir, name, moduleName)
      throw error
    }
  }

  /** Whether the resolved module name collides with any mounted or managed module. */
  private moduleCollides(moduleName: string): boolean {
    if (this.composedModuleNames().has(moduleName)) return true
    if (this.homePatchDeclaredNames().has(moduleName)) return true
    for (const record of readLedger().values()) {
      if (record.moduleName === moduleName) return true
    }
    return false
  }

  /** Snapshot the committed row's composed-tree state, or predict the pending row. */
  private async installValue(name: string, entryId: string): Promise<PluginManagerInstallResult> {
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== name) continue
      const fiber = entry.fiber
      if (fiber === undefined) {
        return success({ entryId: pluginManagerEntryId(entry.id), moduleName: name, phase: null })
      }
      let mountError: string | undefined
      if (fiber.state === FIBER_STATE.FAILED) {
        try {
          await fiber.await()
        } catch (error) {
          mountError = error instanceof Error ? error.message : String(error)
        }
      }
      return success({
        entryId: pluginManagerEntryId(entry.id),
        moduleName: name,
        phase: FIBER_PHASE[fiber.state],
        ...mountError === undefined ? {} : { mountError },
      })
    }
    // HMR has not mounted the row yet; report the managed row as pending.
    return success({ entryId: pluginManagerEntryId(entryId), moduleName: name, phase: null })
  }

  /**
   * Uninstall a plugin installed through the plugin manager: a network install
   * removes its managed row, symlink, store, and ledger entry; a static install
   * removes its managed row only; a bundled harness plugin gets a persisted
   * `disabled: true` override (reversible through install). User-authored rows
   * and other modules are never touched.
   * @param request - the public catalog name of the managed row to remove.
   * @returns `absent` when removed (idempotent), or a `not-installed` /
   * `not-managed` / `remove-failed` / `in-use` rejection. Storage failures throw
   * and fold to `internal`.
   */
  @Remote('uninstallPlugin')
  async uninstall(request: PluginManagerUninstallRequest): Promise<PluginManagerUninstallResult> {
    const result = await this.enqueue(() => this.uninstallEnqueued(request.name))
    if (result.ok) this.catalogChanged()
    return result
  }

  /**
   * The enqueued uninstall: route by ledger presence (network install), then by
   * bundled spine presence (a harness plugin persisted-disable), then the
   * managed-row path. A bundled module on the irreplaceable set is refused with
   * `in-use`; every other bundled module gets a `disabled: true` override.
   */
  private async uninstallEnqueued(name: string): Promise<PluginManagerUninstallResult> {
    const record = readLedger().get(name)
    if (record !== undefined) return this.uninstallNetwork(name, record)
    const bundled = this.findBundledEntry(name)
    if (bundled !== undefined) return this.uninstallBundled(name, bundled)
    return this.uninstallStatic(name)
  }

  /** Persist a disable override for one bundled spine plugin (the reversible
   * "uninstall" for a row the patch layer cannot delete). */
  private async uninstallBundled(name: string, entry: BundledEntry): Promise<PluginManagerUninstallResult> {
    if (IRREMOVABLE_MODULES.has(name)) return rejected({ code: 'in-use', name })
    await updateHomePatch(rows => ({ applied: true, rows: upsertDisabledOverride(rows, entry.id, true) }))
    return success<PluginManagerUninstallValue>(Object.freeze({ absent: true }))
  }

  /** Remove the managed home-patch row for a static install. */
  private async uninstallStatic(name: string): Promise<PluginManagerUninstallResult> {
    const entryId = managedEntryId(name)
    const mutation = await updateHomePatch<'not-installed' | 'not-managed'>((rows) => {
      const managed = rows.filter(row => isManagedInsertFor(row, entryId, name))
      if (managed.length > 0) {
        return { applied: true, rows: rows.filter(row => !isManagedInsertFor(row, entryId, name)) }
      }
      if (rows.some(row => rowEntryNames(row).includes(name))) {
        return { applied: false, code: 'not-managed' }
      }
      return { applied: false, code: 'not-installed' }
    })
    if (!mutation.applied) return rejected({ code: mutation.code, name })
    return success<PluginManagerUninstallValue>(Object.freeze({ absent: true }))
  }

  /**
   * Uninstall a network install: remove the managed row first (unmounts the
   * fiber via HMR), then the symlink, store, and ledger entry. When the user
   * took over the module's row, the store and ledger are kept so provenance
   * survives. A cleanup failure after the row is gone returns `remove-failed`
   * and leaves an orphan a retry cleans.
   */
  private async uninstallNetwork(name: string, record: InstalledPluginRecord): Promise<PluginManagerUninstallResult> {
    const installPrefix = this.installPrefixValue()
    const { slugDir } = store.storePaths(installPrefix, name)
    const entryId = managedEntryId(record.moduleName)
    const mutation = await updateHomePatch<'not-installed' | 'not-managed'>((rows) => {
      const managed = rows.filter(row => isManagedInsertFor(row, entryId, record.moduleName))
      if (managed.length > 0) {
        return { applied: true, rows: rows.filter(row => !isManagedInsertFor(row, entryId, record.moduleName)) }
      }
      if (rows.some(row => rowEntryNames(row).includes(record.moduleName))) {
        return { applied: false, code: 'not-managed' }
      }
      return { applied: false, code: 'not-installed' }
    })
    if (!mutation.applied && mutation.code === 'not-managed') {
      // The user took over the module's row; keep the store and ledger so the
      // module keeps mounting and the provenance is preserved.
      return rejected({ code: 'not-managed', name })
    }
    // Tamper check before removal: a drifted store is still removed in full —
    // a possibly-compromised plugin should not be left on disk.
    if (store.verifyStoreIntegrity(record, installPrefix) === 'tampered') {
      this.ctx.logger.warn(`dsh plugin uninstall: store lockfile for ${name} drifted from the ledger record; removing anyway`)
    }
    try {
      store.removeModuleSymlink(installPrefix, record.moduleName)
      store.removeStoreDir(slugDir)
    } catch {
      // The row is gone but the store/ledger remain: retry cleans the orphan.
      return rejected({ code: 'remove-failed', name })
    }
    await updateLedger((ledger) => { ledger.delete(name) })
    return success<PluginManagerUninstallValue>(Object.freeze({ absent: true }))
  }
}

export default PluginManagerGateway
