/** Read-only projection of the current Cordis Loader plugin entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { spineMeta } from './spine-meta.ts'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'
export { CATEGORIES, SPINE_META, spineMeta } from './spine-meta.ts'
export type { SpineCategory, SpineMetaEntry } from './spine-meta.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The deployment's Loader plugin projection, for host callers that must prove what is installed. */
    pluginInventory: PluginInventoryGateway
  }
}

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
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
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  /** Serialized form of the last emitted projection, for change detection. */
  private lastProjection: string | undefined
  /** Whether a coalesced changed emit is already queued this frame. */
  private changedQueued = false

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
    // Live-update nudge: coalesce one frame of loader events, then emit only
    // when the recomputed projection actually differs — internal/status fires
    // on every fiber transition, which would otherwise flood the wire.
    ctx.on('loader/entry-init', this.scheduleChanged)
    ctx.on('loader/partial-dispose', this.scheduleChanged)
    ctx.on('internal/plugin', this.scheduleChanged)
    ctx.on('internal/status', this.scheduleChanged)
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    return this.projection()
  }

  /** The current non-group Loader entries in Loader order. */
  private projection(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      const meta = spineMeta(entry.options.name)
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
        ...(meta === undefined ? {} : { category: meta.category, description: meta.description }),
      })
    }
    return { entries }
  }

  /** Coalesce one frame of loader events into a single changed emit. */
  private scheduleChanged = (): void => {
    if (this.changedQueued) return
    this.changedQueued = true
    queueMicrotask(() => {
      this.changedQueued = false
      const serialized = JSON.stringify(this.projection())
      if (serialized === this.lastProjection) return
      this.lastProjection = serialized
      this.ctx.emit('plugin-inventory/changed')
    })
  }
}

export default PluginInventoryGateway
