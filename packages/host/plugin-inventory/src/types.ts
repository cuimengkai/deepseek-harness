import type { Branded } from '@deepseek-ai/dsh-brand'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The Loader plugin projection changed. Emitted after one frame of
     * `loader/entry-init`, `loader/partial-dispose`, `internal/plugin`, and
     * `internal/status` events coalesces and the recomputed projection differs
     * from the last one emitted; the client re-reads `pluginInventory/list`.
     * @mode emit
     */
    'plugin-inventory/changed'(): void
  }
}

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  /** Harness-native category from the spine metadata table, when known. */
  readonly category?: string
  /** One-line purpose from the spine metadata table, when known. */
  readonly description?: string
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}
