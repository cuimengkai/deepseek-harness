/**
 * Shipped catalog and default catalog sources for the plugin manager.
 * @module @deepseek-ai/dsh-host-plugin-manager/catalog
 */

import type { PluginCatalogDescriptor, PluginManagerCatalogSourceDescriptor } from './types.ts'

/**
 * Default catalog of plugins a surface may install without network access.
 *
 * v1 installs only modules the running Host already resolves (in-box bundles,
 * local packages, installed packages): there is no registry and no pnpm. The
 * default web/base composition mounts every Loader plugin in its closure, so
 * this shipped list is deliberately empty — a surface that curates its own
 * installable set (a product scenario set, a staged plugin set) overrides it
 * through the gateway Config `catalog` option, which is the documented
 * extension point.
 */
export const PLUGIN_MANAGER_CATALOG: readonly PluginCatalogDescriptor[] = Object.freeze([])

/**
 * Default network catalog sources when the gateway Config supplies neither
 * `sources` nor `catalog`: the awesome-dsh-plugin curated installable list and
 * the GitHub `dsh-plugin` topic search (browse-only repositories).
 */
export const DEFAULT_SOURCES: readonly PluginManagerCatalogSourceDescriptor[] = Object.freeze([
  Object.freeze({ id: 'awesome', kind: 'awesome' }),
  Object.freeze({ id: 'topic', kind: 'topic', topic: 'dsh-plugin' }),
])
