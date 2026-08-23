/**
 * Plugin inventory Settings-tab store: one host-backed snapshot per face — the
 * Loader inventory and the installable catalog — refreshed on demand and on
 * forwarded Host events, but only while the tab is mounted. The host stays the
 * single fact source; every mutation writes through the wire and the tab
 * re-renders from the next read, pushed or refetched.
 */

import type {
  PluginInventorySnapshot,
  PluginManagerCatalogSnapshot,
  PluginManagerInstallRequest,
  PluginManagerInstallResult,
  PluginManagerUninstallRequest,
  PluginManagerUninstallResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** One face of the tab: the Loader inventory or the installable catalog. */
export type PluginInventoryFaceState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly stale: boolean; readonly snapshot: T }

/** Both faces of the tab, the single snapshot the component renders from. */
export interface PluginInventoryClientState {
  inventory: PluginInventoryFaceState<PluginInventorySnapshot>
  catalog: PluginInventoryFaceState<PluginManagerCatalogSnapshot>
}

/**
 * Host wire face the store reads and writes through. Transport failures
 * reject; business refusals arrive inside the returned install/uninstall
 * union. The tab's apply() builds the face over `ctx.remote`; component tests
 * substitute it wholesale. Property-style closures: the face never uses `this`,
 * so the store and tests can pass the members around unbound.
 */
export interface PluginInventoryWire {
  list: () => Promise<PluginInventorySnapshot>
  listAvailable: () => Promise<PluginManagerCatalogSnapshot>
  refreshCatalog: () => Promise<PluginManagerCatalogSnapshot>
  installPlugin: (request: PluginManagerInstallRequest) => Promise<PluginManagerInstallResult>
  uninstallPlugin: (request: PluginManagerUninstallRequest) => Promise<PluginManagerUninstallResult>
}

/** Whether a face needs a read to satisfy the current view: never loaded,
 * failed, or ready-but-stale (an invalidation arrived while unobserved). */
function needsLoad<T>(face: PluginInventoryFaceState<T>): boolean {
  return face.status === 'idle' || face.status === 'error' || (face.status === 'ready' && face.stale)
}

/** The plugin inventory tab controller (one per Settings surface). */
export class PluginInventoryClientStore {
  /** The snapshot the tab renders from (uSES-safe store). */
  readonly store: SnapshotStore<PluginInventoryClientState>

  /** Live subscribers; forwarded events refetch only while at least one lives. */
  private readonly liveSubscribers = new Set<() => void>()

  /** Latest load wins; an older response never overwrites a newer one. */
  private inventoryGeneration = 0
  private catalogGeneration = 0

  /**
   * @param wire - the host wire face (inventory list, catalog read/refresh, install/uninstall).
   */
  constructor(private readonly wire: PluginInventoryWire) {
    const base = createSnapshotStore<PluginInventoryClientState>({
      inventory: { status: 'idle' },
      catalog: { status: 'idle' },
    })
    this.store = {
      ...base,
      subscribe: (fn: () => void): (() => void) => {
        this.liveSubscribers.add(fn)
        const dispose = base.subscribe(fn)
        return () => {
          this.liveSubscribers.delete(fn)
          dispose()
        }
      },
    }
  }

  /** Number of live snapshot subscribers (the mounted tab). */
  get subscriberCount(): number {
    return this.liveSubscribers.size
  }

  /** Fetch every face that is not freshly ready: idle, failed, or stale. */
  ensureLoaded(): void {
    const state = this.store.getSnapshot()
    if (needsLoad(state.inventory)) void this.loadInventory()
    if (needsLoad(state.catalog)) void this.loadCatalog()
  }

  /** Force a fresh read of both faces (a new connection generation or a committed action). */
  load(): void {
    void this.loadInventory()
    void this.loadCatalog()
  }

  /** Re-read the inventory face, replacing the snapshot. */
  private async loadInventory(): Promise<void> {
    const generation = ++this.inventoryGeneration
    this.store.update((s) => { s.inventory = { status: 'loading' } })
    try {
      const snapshot = await this.wire.list()
      if (generation !== this.inventoryGeneration) return
      this.store.update((s) => { s.inventory = { status: 'ready', stale: false, snapshot } })
    } catch {
      if (generation !== this.inventoryGeneration) return
      this.store.update((s) => { s.inventory = { status: 'error' } })
    }
  }

  /** Re-read the catalog face, replacing the snapshot. */
  private async loadCatalog(): Promise<void> {
    const generation = ++this.catalogGeneration
    this.store.update((s) => { s.catalog = { status: 'loading' } })
    try {
      const snapshot = await this.wire.listAvailable()
      if (generation !== this.catalogGeneration) return
      this.store.update((s) => { s.catalog = { status: 'ready', stale: false, snapshot } })
    } catch {
      if (generation !== this.catalogGeneration) return
      this.store.update((s) => { s.catalog = { status: 'error' } })
    }
  }

  /**
   * A forwarded Host change reached the inventory face. Refetch now while the
   * tab is mounted; otherwise mark the cached snapshot stale so the next mount
   * refetches it instead of serving an outdated view.
   */
  invalidateInventory(): void {
    const face = this.store.getSnapshot().inventory
    if (face.status === 'idle' || face.status === 'loading') return
    if (this.liveSubscribers.size > 0) void this.loadInventory()
    else if (face.status === 'ready') {
      this.store.update((s) => { s.inventory = { status: 'ready', stale: true, snapshot: face.snapshot } })
    }
  }

  /** The forwarded catalog-change counterpart of {@link invalidateInventory}. */
  invalidateCatalog(): void {
    const face = this.store.getSnapshot().catalog
    if (face.status === 'idle' || face.status === 'loading') return
    if (this.liveSubscribers.size > 0) void this.loadCatalog()
    else if (face.status === 'ready') {
      this.store.update((s) => { s.catalog = { status: 'ready', stale: true, snapshot: face.snapshot } })
    }
  }

  /**
   * Re-fetch every network catalog source, bypassing the cache. The current
   * snapshot stays visible while the refresh is in flight; a failed refresh
   * lands the error face.
   */
  async refreshCatalog(): Promise<void> {
    const generation = ++this.catalogGeneration
    try {
      const snapshot = await this.wire.refreshCatalog()
      if (generation !== this.catalogGeneration) return
      this.store.update((s) => { s.catalog = { status: 'ready', stale: false, snapshot } })
    } catch {
      if (generation !== this.catalogGeneration) return
      this.store.update((s) => { s.catalog = { status: 'error' } })
    }
  }

  /**
   * Install one plugin through the wire. A committed install reloads both faces
   * at the commit point so the view never waits on the forwarded events.
   * @param name - public catalog name to install.
   * @param options - explicit trust confirmation and the optional scripts opt-in.
   * @returns the business result; transport failures reject.
   */
  async install(
    name: string,
    options: { readonly confirmed: boolean; readonly allowScripts?: boolean },
  ): Promise<PluginManagerInstallResult> {
    const request: PluginManagerInstallRequest = options.allowScripts === undefined
      ? { name, confirmed: options.confirmed }
      : { name, confirmed: options.confirmed, allowScripts: options.allowScripts }
    const result = await this.wire.installPlugin(request)
    if (result.ok) this.load()
    return result
  }

  /**
   * Uninstall one plugin through the wire. A committed uninstall reloads both
   * faces at the commit point.
   * @param name - public catalog name of the managed row to remove.
   * @returns the business result; transport failures reject.
   */
  async uninstall(name: string): Promise<PluginManagerUninstallResult> {
    const result = await this.wire.uninstallPlugin({ name })
    if (result.ok) this.load()
    return result
  }
}
