/**
 * List-time validation gate: the install-spec allowlist, per-kind syntax
 * checks, and the npm-installability probe (GitHub contents API) with its
 * persistent verdict cache, budget, and in-flight dedupe. Every GitHub fetch is
 * stubbed through the global `fetch`; nothing touches the network.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheDirectory, type CatalogEntrySeed } from '../src/catalog-sources.ts'
import {
  isSafeInstallRef,
  probeInstallability,
  validateEntrySyntax,
  validateSeeds,
  type ProbeOptions,
  type ProbeVerdict,
} from '../src/validator.ts'

let home: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-validator-'))
  process.env.DSH_HOME = home
  githubHandlers.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
  delete process.env.DSH_HOME
})

function probeOptions(extra: Partial<ProbeOptions> = {}): ProbeOptions {
  return {
    cacheDir: cacheDirectory(),
    budget: 10,
    ttlMs: 24 * 60 * 60 * 1000,
    fetchTimeoutMs: 1000,
    ...extra,
  }
}

function seed(name: string, extra: Partial<CatalogEntrySeed> = {}): CatalogEntrySeed {
  return { name, source: 'topic', installKind: 'network', installable: false, ...extra }
}

/** Registered GitHub contents responders, one URL per repo. Reset per test so
 * several `stubGithubContents` calls in one test share one global fetch. */
const githubHandlers = new Map<string, (input: string) => Response | Promise<Response>>()

/**
 * Stub the GitHub contents endpoint for one repo. A string `body` is the raw
 * root `package.json` (encoded to base64 content exactly like the real API); a
 * `{ status }` body replies with that status for a private/rate-limited repo.
 */
function stubGithubContents(fullName: string, body: string | { status: number }): void {
  const url = `https://api.github.com/repos/${fullName}/contents/package.json`
  githubHandlers.set(url, async (_input: string): Promise<Response> => {
    if (typeof body === 'string') {
      return new Response(JSON.stringify({ content: Buffer.from(body).toString('base64') }), { status: 200 })
    }
    return new Response(null, { status: body.status })
  })
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const handler = githubHandlers.get(input)
    return handler === undefined ? new Response(null, { status: 404 }) : handler(input)
  }))
}

/** Stub fetch as a spy that would succeed if probed, so tests can assert it was
 * never reached for `probe: false` passes. */
function stubUnreachableFetch(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => new Response(null, { status: 500 }))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('isSafeInstallRef', () => {
  it('accepts registry names, GitHub shorthand, and public URLs', () => {
    expect(isSafeInstallRef('lodash')).toBe(true)
    expect(isSafeInstallRef('@scope/pkg')).toBe(true)
    expect(isSafeInstallRef('user/repo')).toBe(true)
    expect(isSafeInstallRef('user/repo@1.0.0')).toBe(true)
    expect(isSafeInstallRef('user/repo#main')).toBe(true)
    expect(isSafeInstallRef('https://example.test/pkg.tgz')).toBe(true)
    expect(isSafeInstallRef('git+https://github.com/user/repo.git')).toBe(true)
    expect(isSafeInstallRef('github:user/repo')).toBe(true)
  })

  it('rejects local-path schemes, private transports, whitespace, and traversal', () => {
    expect(isSafeInstallRef('')).toBe(false)
    expect(isSafeInstallRef('file:/etc/passwd')).toBe(false)
    expect(isSafeInstallRef('git+file:../other')).toBe(false)
    expect(isSafeInstallRef('ssh://git@host/repo')).toBe(false)
    expect(isSafeInstallRef('git://host/repo')).toBe(false)
    expect(isSafeInstallRef('ftp://host/pkg')).toBe(false)
    expect(isSafeInstallRef('../relative')).toBe(false)
    expect(isSafeInstallRef('user/..')).toBe(false)
    expect(isSafeInstallRef('user/repo extra')).toBe(false)
  })
})

describe('validateEntrySyntax', () => {
  it('keeps every operator-authored static seed', () => {
    expect(validateEntrySyntax(seed('anything/at all', { source: 'catalog', installKind: 'static' }), 'static')).toBe(true)
  })

  it('requires owner/repo shape for topic and awesome seeds', () => {
    expect(validateEntrySyntax(seed('user/repo'), 'topic')).toBe(true)
    expect(validateEntrySyntax(seed('@scope/pkg'), 'topic')).toBe(false)
    expect(validateEntrySyntax(seed('nodash'), 'topic')).toBe(false)
    expect(validateEntrySyntax(seed('user/../../repo'), 'awesome')).toBe(false)
  })

  it('keeps manifest entries with a safe ref and drops unsafe ones', () => {
    expect(validateEntrySyntax(seed('pkg', { source: 'market', installRef: 'https://example.test/a.tgz' }), 'manifest')).toBe(true)
    expect(validateEntrySyntax(seed('pkg', { source: 'market', installRef: 'file:/etc/passwd' }), 'manifest')).toBe(false)
    expect(validateEntrySyntax(seed('a b', { source: 'market' }), 'manifest')).toBe(false)
    expect(validateEntrySyntax(seed('../walk', { source: 'market' }), 'manifest')).toBe(false)
  })
})

describe('probeInstallability', () => {
  it('classifies a repo with a public root package.json as installable', async () => {
    stubGithubContents('user/repo', JSON.stringify({ name: 'pkg', version: '1.0.0' }))
    const verdicts = await probeInstallability(['user/repo'], probeOptions())
    expect(verdicts.get('user/repo')).toBe('installable')
  })

  it('classifies private, missing, and malformed manifests as not-installable', async () => {
    stubGithubContents('user/private', JSON.stringify({ name: 'pkg', private: true }))
    stubGithubContents('user/no-name', JSON.stringify({ version: '1.0.0' }))
    stubGithubContents('user/missing', { status: 404 })
    stubGithubContents('user/corrupt', 'not json')
    const verdicts = await probeInstallability(['user/private', 'user/no-name', 'user/missing', 'user/corrupt'], probeOptions())
    expect(verdicts.get('user/private')).toBe('not-installable')
    expect(verdicts.get('user/no-name')).toBe('not-installable')
    expect(verdicts.get('user/missing')).toBe('not-installable')
    expect(verdicts.get('user/corrupt')).toBe('not-installable')
  })

  it('classifies rate limits and server errors as unknown, never installable', async () => {
    stubGithubContents('user/limited', { status: 403 })
    stubGithubContents('user/broken', { status: 500 })
    const verdicts = await probeInstallability(['user/limited', 'user/broken'], probeOptions())
    expect(verdicts.get('user/limited')).toBe('unknown')
    expect(verdicts.get('user/broken')).toBe('unknown')
  })

  it('classifies a transport failure as unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('ECONNREFUSED') }))
    const verdicts = await probeInstallability(['user/repo'], probeOptions())
    expect(verdicts.get('user/repo')).toBe('unknown')
  })

  it('serves a fresh cached verdict without re-fetching and persists the cache', async () => {
    stubGithubContents('user/repo', JSON.stringify({ name: 'pkg' }))
    const fetchMock = vi.mocked(fetch)
    await probeInstallability(['user/repo'], probeOptions())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const cachePath = join(cacheDirectory(), 'probes.json')
    expect(existsSync(cachePath)).toBe(true)
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, { verdict: string; checkedAt: number }>
    expect(cached['user/repo']?.verdict).toBe('installable')

    // A second pass within the TTL hits the cache only.
    await probeInstallability(['user/repo'], probeOptions())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-probes an expired verdict', async () => {
    stubGithubContents('user/repo', JSON.stringify({ name: 'pkg' }))
    const fetchMock = vi.mocked(fetch)
    await probeInstallability(['user/repo'], probeOptions({ ttlMs: -1 }))
    await probeInstallability(['user/repo'], probeOptions({ ttlMs: -1 }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caps uncached repos at the budget, marking the rest unknown', async () => {
    stubGithubContents('user/one', JSON.stringify({ name: 'pkg' }))
    stubGithubContents('user/two', JSON.stringify({ name: 'pkg' }))
    stubGithubContents('user/three', JSON.stringify({ name: 'pkg' }))
    const verdicts = await probeInstallability(['user/one', 'user/two', 'user/three'], probeOptions({ budget: 1 }))
    expect(verdicts.get('user/one')).toBe('installable')
    expect(verdicts.get('user/two')).toBe('unknown')
    expect(verdicts.get('user/three')).toBe('unknown')
  })

  it('dedupes concurrent probes of the same repo', async () => {
    stubGithubContents('user/repo', JSON.stringify({ name: 'pkg' }))
    const fetchMock = vi.mocked(fetch)
    // One shared in-flight map (as `validateSeeds` threads through a refresh)
    // so both passes await the same probe and issue a single fetch.
    const inFlight = new Map<string, Promise<ProbeVerdict>>()
    const [a, b] = await Promise.all([
      probeInstallability(['user/repo'], probeOptions(), inFlight),
      probeInstallability(['user/repo'], probeOptions(), inFlight),
    ])
    expect(a.get('user/repo')).toBe('installable')
    expect(b.get('user/repo')).toBe('installable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('validateSeeds', () => {
  it('passes static seeds through unchanged', async () => {
    const entries = [seed('a', { source: 'catalog', installKind: 'static' })]
    expect(await validateSeeds('static', entries, { probe: true, probeOptions: probeOptions() })).toEqual({
      entries,
      droppedCount: 0,
    })
  })

  it('keeps valid manifest entries without probing and drops syntax-invalid ones', async () => {
    const fetchMock = stubUnreachableFetch()
    const valid = seed('pkg', { source: 'market', installRef: 'https://example.test/a.tgz' })
    const invalidRef = seed('evil', { source: 'market', installRef: 'file:/etc/passwd' })
    const result = await validateSeeds('manifest', [valid, invalidRef], { probe: false, probeOptions: probeOptions() })
    expect(result.entries).toEqual([valid])
    expect(result.droppedCount).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('flips a confirmed topic repo to installable and drops the rest', async () => {
    stubGithubContents('user/confirmed', JSON.stringify({ name: 'pkg' }))
    stubGithubContents('user/private', JSON.stringify({ name: 'pkg', private: true }))
    stubGithubContents('user/limited', { status: 403 })
    const result = await validateSeeds('topic', [
      seed('user/confirmed'),
      seed('user/private'),
      seed('user/limited'),
      seed('badshape'),
    ], { probe: true, probeOptions: probeOptions() })
    expect(result.entries).toEqual([{
      ...seed('user/confirmed'),
      installable: true,
      installRef: 'user/confirmed',
    }])
    expect(result.droppedCount).toBe(3)
  })

  it('keeps curated awesome entries unprobed by default', async () => {
    const fetchMock = stubUnreachableFetch()
    const entries = [seed('user/curated'), seed('user/other')]
    const result = await validateSeeds('awesome', entries, { probe: false, probeOptions: probeOptions() })
    expect(result.entries).toEqual(entries)
    expect(result.droppedCount).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('drops not-installable awesome entries when probing is opted in', async () => {
    stubGithubContents('user/curated', JSON.stringify({ name: 'pkg' }))
    stubGithubContents('user/gone', { status: 404 })
    const result = await validateSeeds('awesome', [seed('user/curated'), seed('user/gone')], {
      probe: true,
      probeOptions: probeOptions(),
    })
    expect(result.entries.map(entry => entry.name)).toEqual(['user/curated'])
    expect(result.droppedCount).toBe(1)
  })
})
