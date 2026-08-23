/**
 * Configurable catalog sources for the plugin manager: an inline static list,
 * the awesome-dsh-plugin curated list (fetched as its repository tarball and
 * parsed locally), a GitHub topic search, and a generic manifest URL. Network
 * sources cache their parsed manifest under `$DSH_HOME/plugins/cache/<id>.json`
 * with a kind-specific TTL and serve stale entries on a re-fetch failure. This
 * module is pure — the gateway supplies fetch options, the cache directory, and
 * the cross-caller in-flight dedupe map.
 * @module @deepseek-ai/dsh-host-plugin-manager/catalog-sources
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'js-yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  catalogFetchError,
  fetchManifestJson,
  fetchTarballFiles,
  isCatalogFetchError,
  type ManifestFetchOptions,
} from './manifest-client.ts'
import type {
  PluginCatalogDescriptor,
  PluginManagerCatalogEntry,
  PluginManagerCatalogSourceDescriptor,
  PluginManagerCatalogSourceKind,
} from './types.ts'

/** A catalog entry before install-state resolution (computed per read). */
export type CatalogEntrySeed = Omit<PluginManagerCatalogEntry, 'installed'>

/** One source's refreshed runtime state. */
export interface CatalogSourceSnapshot {
  readonly id: string
  readonly kind: PluginManagerCatalogSourceKind
  /** `ok` = fresh, `stale` = served from cache after a re-fetch failure,
   * `error` = fetch failed with no usable cache, `offline` = network skipped. */
  readonly state: 'ok' | 'error' | 'stale' | 'offline'
  readonly entries: readonly CatalogEntrySeed[]
  /** Epoch millis of the last successful fetch. */
  readonly fetchedAt?: number
  /** One-line fetch failure detail for `error` / `stale` states. */
  readonly error?: string
}

/** Options for one {@link refreshSource} call. */
export interface RefreshSourceOptions extends ManifestFetchOptions {
  /** Skip network sources and serve only the cache (empty when absent). */
  readonly offline: boolean
  /** Directory the per-source cache lives under. */
  readonly cacheDir: string
  /** Override the kind default TTL in milliseconds. */
  readonly cacheTtlMs?: number
  /** Bypass the cache and re-fetch; still honors `offline`. */
  readonly force?: boolean
  /** Cross-caller dedupe: one in-flight fetch per source id. */
  readonly inFlight?: Map<string, Promise<CatalogSourceSnapshot>>
}

/** Default cache TTL per network kind: topic re-checks sparingly (its search
 * API and the installability probe share one tight anonymous rate budget), the
 * curated list and generic manifests are stable. */
const DEFAULT_CACHE_TTL_MS: Record<Exclude<PluginManagerCatalogSourceKind, 'static'>, number> = {
  topic: 15 * 60 * 1000,
  awesome: 60 * 60 * 1000,
  manifest: 60 * 60 * 1000,
}

/** A cached source manifest with its fetch time. */
interface CachedSource {
  readonly fetchedAt: number
  readonly entries: readonly CatalogEntrySeed[]
}

/**
 * Absolute cache directory, under the home plugins dir. Resolved per call.
 * @returns the absolute cache directory path.
 */
export function cacheDirectory(): string {
  return join(resolveDshHome(), 'plugins', 'cache')
}

/**
 * Refresh one catalog source to a snapshot. `static` sources resolve inline;
 * network sources serve the fresh cache, re-fetch when the cache is absent or
 * stale, serve `stale` on a re-fetch failure, and skip to the cache when
 * `offline`. A concurrent refresh for the same id shares one in-flight fetch.
 * @param source - the source descriptor.
 * @param opts - the fetch budget, offline switch, cache location, and dedupe map.
 * @returns the source snapshot.
 */
export async function refreshSource(
  source: PluginManagerCatalogSourceDescriptor,
  opts: RefreshSourceOptions,
): Promise<CatalogSourceSnapshot> {
  if (source.kind === 'static') {
    return { id: source.id, kind: 'static', state: 'ok', entries: staticSeeds(source.id, source.entries) }
  }
  if (opts.offline) {
    const cached = readCache(opts.cacheDir, source.id)
    return {
      id: source.id,
      kind: source.kind,
      state: 'offline',
      entries: cached?.entries ?? [],
      ...(cached === undefined ? {} : { fetchedAt: cached.fetchedAt }),
    }
  }
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS[source.kind]
  const cached = readCache(opts.cacheDir, source.id)
  if (cached !== undefined && !opts.force && Date.now() - cached.fetchedAt < ttl) {
    return { id: source.id, kind: source.kind, state: 'ok', entries: cached.entries, fetchedAt: cached.fetchedAt }
  }
  let pending = opts.inFlight?.get(source.id)
  if (pending === undefined) {
    pending = fetchAndCache(source, opts, cached)
    opts.inFlight?.set(source.id, pending)
  }
  try {
    return await pending
  } finally {
    opts.inFlight?.delete(source.id)
  }
}

/** Fetch a network source, cache the parsed result, and classify failures. */
async function fetchAndCache(
  source: Exclude<PluginManagerCatalogSourceDescriptor, { kind: 'static' }>,
  opts: RefreshSourceOptions,
  cached: CachedSource | undefined,
): Promise<CatalogSourceSnapshot> {
  const fetchedAt = Date.now()
  try {
    const entries = await fetchSource(source, opts)
    writeCache(opts.cacheDir, source.id, { fetchedAt, entries })
    return { id: source.id, kind: source.kind, state: 'ok', entries, fetchedAt }
  } catch (error) {
    const message = fetchErrorMessage(error)
    if (cached !== undefined) {
      return { id: source.id, kind: source.kind, state: 'stale', entries: cached.entries, fetchedAt: cached.fetchedAt, error: message }
    }
    return { id: source.id, kind: source.kind, state: 'error', entries: [], error: message }
  }
}

/** Dispatch one network source to its fetcher. */
function fetchSource(
  source: Exclude<PluginManagerCatalogSourceDescriptor, { kind: 'static' }>,
  opts: ManifestFetchOptions,
): Promise<readonly CatalogEntrySeed[]> {
  switch (source.kind) {
    case 'awesome':
      return fetchAwesome(source, opts)
    case 'topic':
      return fetchTopic(source, opts)
    case 'manifest':
      return fetchManifestSource(source, opts)
  }
}

/**
 * Fetch the awesome-dsh-plugin curated list as its repository tarball and parse
 * `data/plugins/*.yml` locally. Each plugin file is `{ url, name: <user>/<repo>,
 * category, description: {zh, en} }`; the `name` is the install spec GitHub
 * understands, so entries carry `installRef: name`.
 */
async function fetchAwesome(
  source: Extract<PluginManagerCatalogSourceDescriptor, { kind: 'awesome' }>,
  opts: ManifestFetchOptions,
): Promise<readonly CatalogEntrySeed[]> {
  const owner = source.owner ?? 'awesome-dsh-plugin'
  const repo = source.repo ?? 'awesome-dsh-plugin'
  const branch = source.branch ?? 'main'
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${branch}`
  const files = await fetchTarballFiles(
    url,
    opts,
    path => path.includes('/data/plugins/') && path.endsWith('.yml'),
  )
  const entries: CatalogEntrySeed[] = []
  for (const file of files) {
    let parsed: unknown
    try {
      parsed = yaml.load(file.content)
    } catch {
      // A malformed plugin file must not fail the whole curated list.
      continue
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const record = parsed as { name?: unknown; description?: unknown; category?: unknown; url?: unknown }
    const name = record.name
    if (typeof name !== 'string' || name.length === 0) continue
    const description = pickDescription(record.description)
    entries.push({
      name,
      ...(description === undefined ? {} : { description }),
      source: source.id,
      ...(typeof record.category === 'string' && record.category.length > 0 ? { category: record.category } : {}),
      ...(typeof record.url === 'string' && record.url.length > 0 ? { url: record.url } : {}),
      installKind: 'network',
      installRef: name,
      installable: true,
    })
  }
  return entries
}

/** The best description string from an awesome entry's `zh`/`en` pair. */
function pickDescription(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'object' && value !== null) {
    const pair = value as { en?: unknown; zh?: unknown }
    if (typeof pair.en === 'string' && pair.en.length > 0) return pair.en
    if (typeof pair.zh === 'string' && pair.zh.length > 0) return pair.zh
  }
  return undefined
}

/**
 * Fetch a GitHub topic repository search. Repositories are browse-only — a repo
 * is not necessarily an installable npm package — so entries are
 * `installable: false` and carry their star count and home URL.
 */
async function fetchTopic(
  source: Extract<PluginManagerCatalogSourceDescriptor, { kind: 'topic' }>,
  opts: ManifestFetchOptions,
): Promise<readonly CatalogEntrySeed[]> {
  const perPage = Math.min(Math.max(1, Math.floor(source.perPage ?? 100)), 100)
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${source.topic}`)}&sort=stars&per_page=${perPage}`
  const json = await fetchManifestJson(url, opts)
  const items = (json as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) throw catalogFetchError('parse', `GET ${url}: missing items array`)
  const entries: CatalogEntrySeed[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { full_name?: unknown; description?: unknown; html_url?: unknown; stargazers_count?: unknown }
    const name = record.full_name
    if (typeof name !== 'string' || name.length === 0) continue
    entries.push({
      name,
      ...(typeof record.description === 'string' && record.description.length > 0 ? { description: record.description } : {}),
      source: source.id,
      ...(typeof record.html_url === 'string' && record.html_url.length > 0 ? { url: record.html_url } : {}),
      ...(typeof record.stargazers_count === 'number' ? { stars: record.stargazers_count } : {}),
      installKind: 'network',
      installable: false,
    })
  }
  return entries
}

/**
 * Fetch a generic JSON manifest (an array of entries, or `{ entries: [...] }`).
 * Each entry carries the public `name`, an optional install `ref` (the
 * package-manager spec), and optional description/category/url/stars/installable.
 * A missing `ref` defaults the install spec to the name, and entries are
 * installable unless `installable: false` marks them browse-only.
 */
async function fetchManifestSource(
  source: Extract<PluginManagerCatalogSourceDescriptor, { kind: 'manifest' }>,
  opts: ManifestFetchOptions,
): Promise<readonly CatalogEntrySeed[]> {
  const json = await fetchManifestJson(source.url, opts)
  const rawEntries = Array.isArray(json) ? json : (json as { entries?: unknown } | null)?.entries
  if (!Array.isArray(rawEntries)) {
    throw catalogFetchError('parse', `GET ${source.url}: expected an array or { entries }`)
  }
  const entries: CatalogEntrySeed[] = []
  for (const raw of rawEntries) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as {
      name?: unknown
      ref?: unknown
      description?: unknown
      category?: unknown
      url?: unknown
      stars?: unknown
      installable?: unknown
    }
    const name = record.name
    if (typeof name !== 'string' || name.length === 0) continue
    const ref = typeof record.ref === 'string' && record.ref.length > 0 ? record.ref : undefined
    const installable = typeof record.installable === 'boolean' ? record.installable : true
    entries.push({
      name,
      ...(typeof record.description === 'string' && record.description.length > 0 ? { description: record.description } : {}),
      source: source.id,
      ...(typeof record.category === 'string' && record.category.length > 0 ? { category: record.category } : {}),
      ...(typeof record.url === 'string' && record.url.length > 0 ? { url: record.url } : {}),
      ...(typeof record.stars === 'number' ? { stars: record.stars } : {}),
      installKind: 'network',
      ...(installable ? { installRef: ref ?? name } : {}),
      installable,
    })
  }
  return entries
}

/** Project an inline static source's descriptors into catalog entry seeds. */
function staticSeeds(id: string, descriptors: readonly PluginCatalogDescriptor[]): readonly CatalogEntrySeed[] {
  return descriptors.map(descriptor => ({
    name: descriptor.name,
    ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
    source: id,
    installKind: 'static',
    installable: true,
  }))
}

/** The one-line message to surface from a failed source fetch. */
function fetchErrorMessage(error: unknown): string {
  if (isCatalogFetchError(error)) return error.message
  return error instanceof Error ? error.message : String(error)
}

/** FNV-1a over the source id; cache filenames avoid slashes and whitespace. */
function hashSourceId(id: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

function cachePath(cacheDir: string, id: string): string {
  return join(cacheDir, `${hashSourceId(id)}.json`)
}

/** Read one source cache; a missing or corrupt file is no cache. */
function readCache(cacheDir: string, id: string): CachedSource | undefined {
  let raw: string
  try {
    raw = readFileSync(cachePath(cacheDir, id), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; entries?: unknown }
    if (typeof parsed.fetchedAt === 'number' && Array.isArray(parsed.entries)) {
      return { fetchedAt: parsed.fetchedAt, entries: parsed.entries as readonly CatalogEntrySeed[] }
    }
  } catch {
    // A corrupt cache is regenerated on the next fetch.
  }
  return undefined
}

/** Write one source cache atomically enough for a crash: direct write after mkdir. */
function writeCache(cacheDir: string, id: string, value: CachedSource): void {
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cachePath(cacheDir, id), JSON.stringify(value))
}
