/**
 * Catalog-source refresh behavior: static inline sources, the awesome curated
 * list (fetched as a repository tarball and parsed locally), a GitHub topic
 * search, and a generic manifest URL — plus the per-source cache, TTL, offline
 * mode, in-flight dedupe, and failure classification. Every network fetch is
 * stubbed through the global `fetch`; nothing touches the network.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as tar from 'tar'
import {
  cacheDirectory,
  refreshSource,
  type CatalogSourceSnapshot,
  type RefreshSourceOptions,
} from '../src/catalog-sources.ts'
import { catalogFetchError } from '../src/manifest-client.ts'

let home: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-catalog-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
  delete process.env.DSH_HOME
})

/** Build a gzipped tarball containing the given files, codeload-style. */
async function gzipTarball(files: Record<string, string>): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-tar-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, content)
    }
    const pack = tar.c({ cwd: dir, gzip: true }, Object.keys(files))
    const chunks: Buffer[] = []
    for await (const chunk of pack) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function options(extra: Partial<RefreshSourceOptions> = {}): RefreshSourceOptions {
  return {
    fetchTimeoutMs: 1000,
    offline: false,
    cacheDir: cacheDirectory(),
    force: false,
    ...extra,
  }
}

const AWESOME_SOURCE = { id: 'awesome', kind: 'awesome' } as const
const TOPIC_SOURCE = { id: 'topic', kind: 'topic', topic: 'dsh-plugin' } as const

describe('static sources', () => {
  it('projects an inline entry list without touching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const snapshot = await refreshSource(
      { id: 'builtin', kind: 'static', entries: [{ name: '@fixture/ping', description: 'Ping the fixture' }] },
      options(),
    )
    expect(snapshot).toEqual({
      id: 'builtin',
      kind: 'static',
      state: 'ok',
      entries: [
        { name: '@fixture/ping', description: 'Ping the fixture', source: 'builtin', installKind: 'static', installable: true },
      ],
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('awesome curated list', () => {
  it('parses data/plugins/*.yml entries from the codeload tarball', async () => {
    const body = await gzipTarball({
      'awesome-dsh-plugin-main/data/plugins/user__repo-a.yml': [
        'name: user/repo-a',
        'url: https://github.com/user/repo-a',
        'category: Chat',
        'description:',
        '  zh: 一个插件',
        '  en: A plugin',
        '',
      ].join('\n'),
      'awesome-dsh-plugin-main/README.md': 'not a plugin',
      'awesome-dsh-plugin-main/data/plugins/broken.yml': 'name: [unclosed',
    })
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array(body)))
    vi.stubGlobal('fetch', fetchSpy)
    const snapshot = await refreshSource(AWESOME_SOURCE, options())
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://codeload.github.com/awesome-dsh-plugin/awesome-dsh-plugin/tar.gz/refs/heads/main',
      expect.objectContaining({ signal: expect.anything() as unknown }),
    )
    expect(snapshot.state).toBe('ok')
    expect(snapshot.entries).toEqual([
      {
        name: 'user/repo-a',
        description: 'A plugin',
        source: 'awesome',
        category: 'Chat',
        url: 'https://github.com/user/repo-a',
        installKind: 'network',
        installRef: 'user/repo-a',
        installable: true,
      },
    ])
  })

  it('honors custom owner/repo/branch in the tarball URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(await gzipTarball({})))))
    await refreshSource({ id: 'awesome', kind: 'awesome', owner: 'acme', repo: 'plugins', branch: 'dev' }, options())
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://codeload.github.com/acme/plugins/tar.gz/refs/heads/dev',
      expect.anything(),
    )
  })
})

describe('GitHub topic search', () => {
  it('maps search items to browse-only entries with stars and home URLs', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      total_count: 1,
      items: [
        {
          full_name: 'acme/tool-a',
          description: 'A tool',
          html_url: 'https://github.com/acme/tool-a',
          stargazers_count: 42,
        },
        { full_name: '', html_url: 'https://github.com/x/y' },
      ],
    })))
    vi.stubGlobal('fetch', fetchSpy)
    const snapshot = await refreshSource(TOPIC_SOURCE, options())
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0])
    expect(calledUrl).toContain('api.github.com/search/repositories')
    expect(calledUrl).toContain(encodeURIComponent('topic:dsh-plugin'))
    expect(calledUrl).toContain('per_page=100')
    expect(snapshot.entries).toEqual([
      {
        name: 'acme/tool-a',
        description: 'A tool',
        source: 'topic',
        url: 'https://github.com/acme/tool-a',
        stars: 42,
        installKind: 'network',
        installable: false,
      },
    ])
  })

  it('classifies a missing items array as a parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ total_count: 0 }))))
    const snapshot = await refreshSource(TOPIC_SOURCE, options())
    expect(snapshot.state).toBe('error')
    expect(snapshot.entries).toEqual([])
    expect(snapshot.error).toContain('missing items array')
  })
})

describe('manifest URL', () => {
  it('accepts a bare array of entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { name: 'pkg-a', ref: 'https://example.test/a.tgz', description: 'A', installable: true },
    ]))))
    const snapshot = await refreshSource({ id: 'market', kind: 'manifest', url: 'https://example.test/plugins.json' }, options())
    expect(snapshot.entries).toEqual([
      {
        name: 'pkg-a',
        description: 'A',
        source: 'market',
        installKind: 'network',
        installRef: 'https://example.test/a.tgz',
        installable: true,
      },
    ])
  })

  it('accepts an object with an entries field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      entries: [{ name: 'pkg-b' }],
    }))))
    const snapshot = await refreshSource({ id: 'market', kind: 'manifest', url: 'https://example.test/plugins.json' }, options())
    expect(snapshot.entries[0]).toEqual({
      name: 'pkg-b',
      source: 'market',
      installKind: 'network',
      installRef: 'pkg-b',
      installable: true,
    })
  })

  it('classifies a non-array, non-entries document as a parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ not: 'a manifest' }))))
    const snapshot = await refreshSource({ id: 'market', kind: 'manifest', url: 'https://example.test/plugins.json' }, options())
    expect(snapshot.state).toBe('error')
    expect(snapshot.error).toContain('expected an array or { entries }')
  })
})

describe('cache and TTL', () => {
  it('serves a fresh cache without refetching', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ items: [] })))
    vi.stubGlobal('fetch', fetchSpy)
    const first = await refreshSource(TOPIC_SOURCE, options({ cacheTtlMs: 60_000 }))
    expect(first.state).toBe('ok')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockImplementation(async () => { throw new Error('network went away') })
    const second = await refreshSource(TOPIC_SOURCE, options({ cacheTtlMs: 60_000 }))
    expect(second.state).toBe('ok')
    expect(second.entries).toEqual(first.entries)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('bypasses a fresh cache when force is set', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ items: [] })))
    vi.stubGlobal('fetch', fetchSpy)
    await refreshSource(TOPIC_SOURCE, options({ cacheTtlMs: 60_000 }))
    await refreshSource(TOPIC_SOURCE, options({ cacheTtlMs: 60_000, force: true }))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('serves stale cached entries when a re-fetch fails', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      items: [{ full_name: 'acme/tool-a', html_url: 'https://github.com/acme/tool-a' }],
    })))
    vi.stubGlobal('fetch', fetchSpy)
    const first = await refreshSource(TOPIC_SOURCE, options({ cacheTtlMs: 0 }))
    expect(first.state).toBe('ok')
    // Age the written cache beyond the TTL so the next read re-fetches.
    const [file] = readdirSync(cacheDirectory())
    const cached = JSON.parse(readFileSync(join(cacheDirectory(), file!), 'utf8')) as { entries: unknown }
    writeFileSync(join(cacheDirectory(), file!), JSON.stringify({ fetchedAt: Date.now() - 100_000, entries: cached.entries }))
    fetchSpy.mockImplementation(async () => { throw new Error('search API rate limited') })
    const stale = await refreshSource(TOPIC_SOURCE, options({ cacheTtlMs: 60_000 }))
    expect(stale.state).toBe('stale')
    expect(stale.entries[0]!.name).toBe('acme/tool-a')
    expect(stale.error).toBe('search API rate limited')
  })

  it('returns offline with cached entries and no fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ items: [] })))
    vi.stubGlobal('fetch', fetchSpy)
    await refreshSource(TOPIC_SOURCE, options({ cacheTtlMs: 60_000 }))
    const offline = await refreshSource(TOPIC_SOURCE, options({ offline: true }))
    expect(offline.state).toBe('offline')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns offline with an empty entry list when there is no cache', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const offline = await refreshSource(TOPIC_SOURCE, options({ offline: true }))
    expect(offline.state).toBe('offline')
    expect(offline.entries).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent refreshes of the same source', async () => {
    const deferred = Promise.withResolvers<Response>()
    const fetchSpy = vi.fn(() => deferred.promise)
    vi.stubGlobal('fetch', fetchSpy)
    const inFlight = new Map<string, Promise<CatalogSourceSnapshot>>()
    const shared = options({ cacheTtlMs: 60_000, inFlight })
    const first = refreshSource(TOPIC_SOURCE, shared)
    const second = refreshSource(TOPIC_SOURCE, shared)
    deferred.resolve(new Response(JSON.stringify({ items: [] })))
    await Promise.all([first, second])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('failure classification', () => {
  it('maps an HTTP error status to an error state with the status in the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 403 })))
    const snapshot = await refreshSource(TOPIC_SOURCE, options())
    expect(snapshot.state).toBe('error')
    expect(snapshot.error).toContain('403')
  })

  it('classifies a deadline expiry as a timeout error', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    }))
    const snapshot = await refreshSource(TOPIC_SOURCE, options({ fetchTimeoutMs: 25 }))
    expect(snapshot.state).toBe('error')
    expect(snapshot.error).toContain('PLUGIN_CATALOG_FETCH_TIMEOUT')
  })

  it('passes a pre-classified fetch error through its own message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw catalogFetchError('parse', 'GET x: invalid JSON') }))
    const snapshot = await refreshSource(TOPIC_SOURCE, options())
    expect(snapshot.state).toBe('error')
    expect(snapshot.error).toBe('GET x: invalid JSON')
  })

  it('rejects an oversized manifest document as a size error', async () => {
    const oversized = `{"pad":"${'x'.repeat(1024 * 1024)}"}`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(oversized)))
    const snapshot = await refreshSource(TOPIC_SOURCE, options())
    expect(snapshot.state).toBe('error')
    expect(snapshot.error).toContain('exceeds')
  })
})

describe('cache directory', () => {
  it('resolves under the home plugins dir', () => {
    expect(cacheDirectory()).toBe(join(home!, 'plugins', 'cache'))
  })
})
