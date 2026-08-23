/**
 * List-time validation gate for catalog entries: syntax checks that run on
 * every read, plus an npm-installability probe for GitHub-shaped sources
 * (topic always, awesome opt-in). Invalid and unproven entries are dropped at
 * the source so they never reach the wire; `findInstallable` applies the same
 * gate, so list filtering cannot be bypassed by installing a dropped name
 * directly.
 * @module @deepseek-ai/dsh-host-plugin-manager/validator
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { CATALOG_FETCH_TIMEOUT } from './manifest-client.ts'
import type { CatalogEntrySeed } from './catalog-sources.ts'
import type { PluginManagerCatalogSourceKind } from './types.ts'

/** Owner/repo-shaped public name: GitHub accepts 1-39 alphanumeric/dash owner
 * names; the repo part has no length constraint worth enforcing here. */
const OWNER_REPO_NAME = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]+$/

/** One `[a-zA-Z0-9][a-zA-Z0-9._-]*`-shaped path segment (owner, repo, scope, name). */
const SEGMENT = '[a-zA-Z0-9][a-zA-Z0-9._-]*'
/** Optional npm `@version`; conservative — no spaces, `<`, or `>` ranges. */
const VERSION = '(?:@[a-zA-Z0-9.^~*|=+-]+)?'
/** Optional `#branch-or-ref` fragment for GitHub shorthand. */
const REF = '(?:#[a-zA-Z0-9._/-]+)?'
/** Registry name (`lodash`), scoped name (`@scope/pkg`), or GitHub shorthand
 * (`user/repo`, `user/repo@v1`, `user/repo#branch`). */
const SAFE_NAME_SPEC = new RegExp(`^(?:${SEGMENT}|@${SEGMENT}/${SEGMENT}|${SEGMENT}/${SEGMENT})${VERSION}${REF}$`)

/**
 * Whether an npm install spec is on the safe allowlist. A hostile manifest
 * could otherwise turn `ref` into a host-local file read primitive
 * (`file:…`) or a private-transport fetch; only registry names, GitHub
 * shorthand, and public `http(s)` / `git+https` specs are installable.
 * @param ref - the package-manager install spec.
 * @returns whether the spec may be handed to the package manager.
 */
export function isSafeInstallRef(ref: string): boolean {
  if (ref.length === 0 || /\s/.test(ref)) return false
  // Local-path schemes and non-public transports are never installable.
  if (/^(?:file|git\+file|ssh|git\+ssh|git|ftp):/i.test(ref)) return false
  // Relative path segments would let `ref` walk the host filesystem.
  if (/(?:^|\/)\.\.(?:\/|$)/.test(ref)) return false
  if (/^https?:\/\/\S+$/i.test(ref)) return true
  if (/^git\+https:\/\/\S+$/i.test(ref)) return true
  if (/^github:[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*(?:#[a-zA-Z0-9._/-]+)?$/.test(ref)) return true
  return SAFE_NAME_SPEC.test(ref)
}

/**
 * Whether one catalog seed passes the kind's syntax gate. `static` seeds are
 * operator-authored and always pass; `topic`/`awesome` names must be
 * owner/repo-shaped; `manifest` names must be non-empty without whitespace or
 * path traversal, and an install `ref` (when present) must be on the safe
 * allowlist.
 * @param seed - the catalog entry seed.
 * @param kind - the source kind the seed came from.
 * @returns whether the seed survives the gate.
 */
export function validateEntrySyntax(seed: CatalogEntrySeed, kind: PluginManagerCatalogSourceKind): boolean {
  if (kind === 'static') return true
  if (kind === 'topic' || kind === 'awesome') return OWNER_REPO_NAME.test(seed.name)
  if (seed.name.length === 0 || /\s/.test(seed.name) || /(?:^|\/)\.\.(?:\/|$)/.test(seed.name)) return false
  return seed.installRef === undefined || isSafeInstallRef(seed.installRef)
}

/** One repository's npm-installability verdict. */
export type ProbeVerdict = 'installable' | 'not-installable' | 'unknown'

/** Budget, cache, and deadline for one {@link probeInstallability} pass. */
export interface ProbeOptions {
  /** Directory the persistent verdict cache lives under. */
  readonly cacheDir: string
  /** How many uncached repos one pass may probe; beyond it verdicts are
   * `unknown`. GitHub's anonymous contents API is tightly rate-limited. */
  readonly budget: number
  /** How long a cached verdict stays fresh before a re-probe. */
  readonly ttlMs: number
  /** Deadline applied to each probe fetch. */
  readonly fetchTimeoutMs: number
}

/** A cached probe verdict with its check time. */
interface CachedVerdict {
  readonly verdict: ProbeVerdict
  readonly checkedAt: number
}

/** Absolute path of the verdict cache, under the plugins cache directory. */
function probeCachePath(cacheDir: string): string {
  return join(cacheDir, 'probes.json')
}

/** Read the verdict cache; a missing or corrupt file is an empty cache. */
function readProbeCache(cacheDir: string): Map<string, CachedVerdict> {
  let raw: string
  try {
    raw = readFileSync(probeCachePath(cacheDir), 'utf8')
  } catch {
    return new Map()
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return new Map()
    const cache = new Map<string, CachedVerdict>()
    for (const [repo, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object') continue
      const record = value as { verdict?: unknown; checkedAt?: unknown }
      if (typeof record.verdict === 'string' && typeof record.checkedAt === 'number') {
        cache.set(repo, { verdict: record.verdict as ProbeVerdict, checkedAt: record.checkedAt })
      }
    }
    return cache
  } catch {
    return new Map()
  }
}

/** Persist the verdict cache; a crash loses only the newest verdicts. */
function writeProbeCache(cacheDir: string, cache: Map<string, CachedVerdict>): void {
  mkdirSync(cacheDir, { recursive: true })
  const object: Record<string, CachedVerdict> = {}
  for (const [repo, value] of cache) object[repo] = value
  writeFileSync(probeCachePath(cacheDir), JSON.stringify(object))
}

/**
 * Probe whether one GitHub repository is an installable npm package: it has a
 * root `package.json` with a non-empty `name` and is not private. Classification
 * is conservative — only a confirmed 200 with a valid public manifest is
 * `installable`; a 404 (no manifest, or a private repo) is `not-installable`;
 * rate limits, server errors, and transport failures are `unknown`.
 * @param fullName - `owner/repo`.
 * @param fetchTimeoutMs - deadline applied to the fetch.
 * @returns the verdict.
 */
async function probeRepo(fullName: string, fetchTimeoutMs: number): Promise<ProbeVerdict> {
  const url = `https://api.github.com/repos/${fullName}/contents/package.json`
  using d = deadline(undefined, fetchTimeoutMs, CATALOG_FETCH_TIMEOUT)
  let response: Response
  try {
    response = await fetch(url, { signal: d.signal })
  } catch {
    return 'unknown'
  }
  if (timeoutOf(d.signal, CATALOG_FETCH_TIMEOUT) !== undefined) return 'unknown'
  if (response.status === 404) return 'not-installable'
  if (!response.ok) return 'unknown'
  let json: unknown
  try {
    json = await response.json()
  } catch {
    return 'not-installable'
  }
  const content = (json as { content?: unknown } | null)?.content
  if (typeof content !== 'string') return 'not-installable'
  let pkg: unknown
  try {
    pkg = JSON.parse(Buffer.from(content, 'base64').toString('utf8'))
  } catch {
    return 'not-installable'
  }
  if (typeof pkg !== 'object' || pkg === null) return 'not-installable'
  const record = pkg as { name?: unknown; private?: unknown }
  if (typeof record.name !== 'string' || record.name.length === 0) return 'not-installable'
  if (record.private === true) return 'not-installable'
  return 'installable'
}

/** Probe one repo and persist its verdict for the next pass. */
async function probeAndCache(
  fullName: string,
  opts: ProbeOptions,
  cache: Map<string, CachedVerdict>,
): Promise<ProbeVerdict> {
  const verdict = await probeRepo(fullName, opts.fetchTimeoutMs)
  cache.set(fullName, { verdict, checkedAt: Date.now() })
  writeProbeCache(opts.cacheDir, cache)
  return verdict
}

/**
 * Resolve npm-installability for a set of GitHub repositories, bounded by the
 * probe budget and served from the persistent verdict cache. Repos with a fresh
 * cached verdict cost nothing; the first `budget` uncached repos are probed
 * sequentially (GitHub's anonymous API rate limits bursts), and everything
 * beyond the budget is `unknown`. Concurrent passes share one in-flight probe
 * per repo.
 * @param repos - `owner/repo` names to resolve.
 * @param opts - budget, cache, and deadline.
 * @param inFlight - cross-caller dedupe map; a fresh map when omitted.
 * @returns the verdict by repo, always populated for every input.
 */
export async function probeInstallability(
  repos: readonly string[],
  opts: ProbeOptions,
  inFlight: Map<string, Promise<ProbeVerdict>> = new Map(),
): Promise<ReadonlyMap<string, ProbeVerdict>> {
  const now = Date.now()
  const cache = readProbeCache(opts.cacheDir)
  const verdicts = new Map<string, ProbeVerdict>()
  let budgetLeft = opts.budget
  for (const repo of repos) {
    const hit = cache.get(repo)
    if (hit !== undefined && now - hit.checkedAt < opts.ttlMs) {
      verdicts.set(repo, hit.verdict)
      continue
    }
    if (budgetLeft <= 0) {
      verdicts.set(repo, 'unknown')
      continue
    }
    budgetLeft -= 1
    let pending = inFlight.get(repo)
    if (pending === undefined) {
      pending = probeAndCache(repo, opts, cache)
      inFlight.set(repo, pending)
    }
    try {
      verdicts.set(repo, await pending)
    } finally {
      inFlight.delete(repo)
    }
  }
  return verdicts
}

/** One {@link validateSeeds} pass's outcome. */
export interface ValidationResult {
  readonly entries: readonly CatalogEntrySeed[]
  /** How many seeds the gate dropped (syntax-invalid, probed
   * `not-installable`, or probed `unknown`). */
  readonly droppedCount: number
}

/** Options for one {@link validateSeeds} pass. */
export interface ValidateOptions {
  /** Whether to run the npm-installability probe. `topic` seeds always probe;
   * `awesome` probes only when the deployment opts in. */
  readonly probe: boolean
  readonly probeOptions: ProbeOptions
  /** Cross-caller in-flight dedupe for concurrent probes. */
  readonly inFlight?: Map<string, Promise<ProbeVerdict>>
}

/**
 * Run the list-time validation gate over one source's seeds. `static` seeds
 * pass through unchanged; `manifest` seeds pass the syntax gate only; `topic`
 * and (opt-in) `awesome` seeds additionally probe npm-installability, with
 * only confirmed repositories kept — `topic` entries become installable with
 * their `owner/repo` as the install spec, while `not-installable` and `unknown`
 * (unverified, rate-limited, budget-exhausted) entries are dropped. Dropped
 * entries never appear on the wire and never install.
 * @param kind - the source kind the seeds came from.
 * @param seeds - the source's entry seeds.
 * @param options - probe switch, budget/cache/deadline, and in-flight dedupe.
 * @returns the surviving entries and the dropped count.
 */
export async function validateSeeds(
  kind: PluginManagerCatalogSourceKind,
  seeds: readonly CatalogEntrySeed[],
  options: ValidateOptions,
): Promise<ValidationResult> {
  if (kind === 'static') return { entries: seeds, droppedCount: 0 }
  const syntacticallyValid = seeds.filter(seed => validateEntrySyntax(seed, kind))
  let droppedCount = seeds.length - syntacticallyValid.length
  // Only `topic` (always) and opt-in `awesome` probe npm-installability;
  // `manifest` entries pass the syntax gate only. Offline sources skip the
  // probe and stay on the wire browse-only.
  if (!options.probe) return { entries: syntacticallyValid, droppedCount }
  const verdicts = await probeInstallability(
    syntacticallyValid.map(seed => seed.name),
    options.probeOptions,
    options.inFlight,
  )
  const entries: CatalogEntrySeed[] = []
  for (const seed of syntacticallyValid) {
    if (verdicts.get(seed.name) !== 'installable') {
      droppedCount += 1
      continue
    }
    entries.push(kind === 'topic' ? { ...seed, installable: true, installRef: seed.name } : seed)
  }
  return { entries, droppedCount }
}
