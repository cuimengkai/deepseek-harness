/**
 * Public request, value, and failure vocabulary for live plugin install/uninstall
 * over configurable catalog sources. This module contains types only so generated
 * Remote clients can consume it without importing Host runtime code.
 * @module @deepseek-ai/dsh-host-plugin-manager/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The installable catalog changed: a managed install or uninstall committed,
     * or the catalog was explicitly refreshed. Coalesced per frame; the client
     * re-reads `pluginManager/listAvailable`.
     * @mode emit
     */
    'plugin-manager/catalog-changed'(): void
  }
}

/** Stable Loader-tree identity of one managed plugin entry. */
export type PluginManagerEntryId = Branded<'PluginManagerEntryId'>

/** Lifecycle state of the managed entry's root Fiber, or null when unmounted. */
export type PluginManagerFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One catalog source kind: an inline list or a network manifest. */
export type PluginManagerCatalogSourceKind = 'static' | 'awesome' | 'topic' | 'manifest'

/**
 * A catalog source descriptor accepted by the gateway Config. `static` holds an
 * inline list of locally-resolvable modules; `awesome` fetches the
 * awesome-dsh-plugin curated list as its repository tarball; `topic` searches a
 * GitHub topic (browse-only, repositories are not installable npm packages);
 * `manifest` fetches a generic JSON manifest at `url`.
 */
export type PluginManagerCatalogSourceDescriptor =
  | {
    /** Source id surfaced in entry `source` fields and source status lines. */
    readonly id: string
    /** Inline static list of locally-resolvable modules. */
    readonly kind: 'static'
    /** Inline locally-resolvable modules, installed without any network step. */
    readonly entries: readonly PluginCatalogDescriptor[]
  }
  | {
    /** Source id surfaced in entry `source` fields and source status lines. */
    readonly id: string
    /** Curated awesome-dsh-plugin list, fetched as its repository tarball. */
    readonly kind: 'awesome'
    /** GitHub owner of the curated list; defaults to `awesome-dsh-plugin`. */
    readonly owner?: string
    /** GitHub repository of the curated list; defaults to `awesome-dsh-plugin`. */
    readonly repo?: string
    /** Branch of the curated list; defaults to `main`. */
    readonly branch?: string
  }
  | {
    /** Source id surfaced in entry `source` fields and source status lines. */
    readonly id: string
    /** GitHub topic search; repositories are browse-only. */
    readonly kind: 'topic'
    /** GitHub topic to search, e.g. `dsh-plugin`. */
    readonly topic: string
    /** Search page size; defaults to `100` and is capped at `100`. */
    readonly perPage?: number
  }
  | {
    /** Source id surfaced in entry `source` fields and source status lines. */
    readonly id: string
    /** Generic JSON manifest at `url`; the configurable extension point. */
    readonly kind: 'manifest'
    /** URL of the JSON manifest to fetch (an array or `{ entries }` object). */
    readonly url: string
  }

/** One plugin offered by a catalog source. */
export interface PluginManagerCatalogEntry {
  /** Public identity a client sees and passes back: the awesome `user/repo`, a
   * manifest entry name, or a locally-resolvable module specifier. */
  readonly name: string
  /** Optional source-authored purpose line shown in the console. */
  readonly description?: string
  /** Id of the source that contributed this entry. */
  readonly source: string
  /** Optional category, currently only from the awesome list. */
  readonly category?: string
  /** Optional link to the plugin's home (a repository or manifest link). */
  readonly url?: string
  /** Optional star count, currently only from topic search. */
  readonly stars?: number
  /** How the manager installs the entry: a locally-resolvable module (`static`)
   * or a package-manager network install (`network`). */
  readonly installKind: 'static' | 'network'
  /** The npm install spec for `network` entries (a GitHub `user/repo`, a
   * registry spec, or a tarball URL); absent for static entries. */
  readonly installRef?: string
  /** Whether the console may install the entry. Topic entries become
   * installable only after the npm-installability probe confirms the repo is a
   * non-private npm package; unverified and invalid repos stay browse-only. */
  readonly installable: boolean
  /** Whether the plugin is already active or installed through the manager. */
  readonly installed: boolean
  /** Resolved package version recorded in the provenance ledger for an
   * installed network entry, when one was captured at install time. */
  readonly version?: string
  /** npm integrity (`sha512-…`) recorded in the provenance ledger for an
   * installed network entry, when one was captured at install time. */
  readonly integrity?: string
  /** Re-verification of the store's lockfile against the ledger record for an
   * installed network entry: `ok` matches, `tampered` drifted, `missing` has
   * no lockfile or no recorded integrity to compare (a legacy row). */
  readonly integrityStatus?: 'ok' | 'tampered' | 'missing'
}

/** Per-source health for the catalog snapshot. */
export interface PluginManagerCatalogSourceStatus {
  readonly id: string
  readonly kind: PluginManagerCatalogSourceKind
  /** `ok` = fresh, `stale` = served from cache after a re-fetch failure,
   * `error` = fetch failed with no usable cache, `offline` = network skipped. */
  readonly state: 'ok' | 'error' | 'stale' | 'offline'
  readonly entryCount: number
  /** ISO timestamp of the last successful fetch. */
  readonly lastUpdated?: string
  /** One-line fetch failure detail for `error` / `stale` sources. */
  readonly error?: string
  /** How many entries the list-time validation gate dropped for this source
   * (syntactically invalid, or probed not-installable). Absent when none. */
  readonly filteredCount?: number
}

/** The gateway's current network-install surface, for the client's trust UI. */
export interface PluginManagerInstallCapabilities {
  /** Whether the gateway requires an explicit `confirmed: true` on network
   * installs (`requireInstallConfirmation`). */
  readonly networkConfirmation: boolean
  /** Whether the deployment permits lifecycle scripts at all
   * (`allowInstallScripts`); the per-request `allowScripts` flag is ANDed. */
  readonly allowInstallScripts: boolean
  /** How network installs are contained: `confined` runs the package manager
   * under the OS sandbox, `unconfined` was configured off, `unavailable` means
   * `installSandbox: true` but no sandbox backend is present (installs refuse). */
  readonly installSandbox: 'confined' | 'unconfined' | 'unavailable'
}

/** Catalog read by the plugin-manager `listAvailable` Remote. */
export interface PluginManagerCatalogSnapshot {
  readonly entries: readonly PluginManagerCatalogEntry[]
  /** Per-source status lines, in the configured source order. */
  readonly sources: readonly PluginManagerCatalogSourceStatus[]
  /** The current network-install surface, for the client's trust UI. */
  readonly capabilities: PluginManagerInstallCapabilities
}

/** Install one plugin from the merged catalog. */
export interface PluginManagerInstallRequest {
  /** Public catalog name to install, e.g. `user/repo` or a manifest entry name. */
  readonly name: string
  /** Explicit trust confirmation. The gateway refuses a network install without
   * it when `requireInstallConfirmation` is set (host-enforced; bypassing the
   * UI still hits the check). */
  readonly confirmed: boolean
  /** Opt in to running the package's lifecycle scripts for this install; only
   * honored when the deployment also permits scripts (`allowInstallScripts`). */
  readonly allowScripts?: boolean
}

/** Successful install: the managed row is committed to the user home patch. */
export interface PluginManagerInstallValue {
  /** Loader entry id the managed home-patch row will mount under. */
  readonly entryId: PluginManagerEntryId
  /** Exact module specifier committed to the user home patch (the resolved
   * package name for network installs, the request name for static ones). */
  readonly moduleName: string
  /** Point-in-time composed-tree phase; usually `null` until HMR mounts. */
  readonly phase: PluginManagerFiberPhase
  /** Startup error captured when the managed entry is already present and failed. */
  readonly mountError?: string
}

/** An install the manager refused before committing any row. */
export interface PluginManagerInstallRejected {
  readonly ok: false
  readonly error: {
    /** `not-found` = the name is in no catalog source, `offline` = network
     * installs disabled, `install-failed` = the package manager or store setup
     * failed, `confirmation-required` = a network install arrived without the
     * explicit trust confirmation, `sandbox-unavailable` = `installSandbox` is
     * on but no sandbox backend is usable (the package manager never ran),
     * `already-installed` / `invalid-name` as in v1. */
    readonly code:
      | 'invalid-name'
      | 'already-installed'
      | 'not-found'
      | 'offline'
      | 'install-failed'
      | 'confirmation-required'
      | 'sandbox-unavailable'
    readonly name: string
    /** One-line detail (npm stderr tail, resolved module name) when useful. */
    readonly message?: string
  }
}

/** Result returned by the plugin-manager `install` Remote. */
export type PluginManagerInstallResult =
  | { readonly ok: true; readonly value: PluginManagerInstallValue }
  | PluginManagerInstallRejected

/** Uninstall a plugin installed through the plugin manager. */
export interface PluginManagerUninstallRequest {
  /** Public catalog name of the managed row to remove. */
  readonly name: string
}

/** Idempotent removal acknowledgement. */
export interface PluginManagerUninstallValue {
  /** Stable postcondition shared by the first removal and every retry. */
  readonly absent: true
}

/** An uninstall the manager refused: nothing to remove, the row is user-owned,
 * or the module is part of the manager's own runtime base. */
export interface PluginManagerUninstallRejected {
  readonly ok: false
  readonly error: {
    /** `remove-failed` = the store/symlink/ledger cleanup failed after the row
     * was removed (an orphan a retry cleans), `in-use` = the module is part of
     * the plugin-manager runtime base and cannot be disabled in-process, others
     * as in v1. */
    readonly code: 'not-installed' | 'not-managed' | 'remove-failed' | 'in-use'
    readonly name: string
    readonly message?: string
  }
}

/** Result returned by the plugin-manager `uninstall` Remote. */
export type PluginManagerUninstallResult =
  | { readonly ok: true; readonly value: PluginManagerUninstallValue }
  | PluginManagerUninstallRejected

/** Maintainer-authored catalog descriptor accepted by the gateway Config. */
export interface PluginCatalogDescriptor {
  /** Exact module specifier the managed row would import. */
  readonly name: string
  /** Optional purpose line shown in the console. */
  readonly description?: string
}
