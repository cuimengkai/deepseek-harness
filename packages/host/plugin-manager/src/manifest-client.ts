/**
 * Outbound manifest transport for the plugin manager's network catalog sources:
 * bounded JSON fetches and gzipped-tarball extraction. Both read the whole
 * payload under a byte cap and classify deadline expiry through
 * @deepseek-ai/dsh-timeout; catalog-sources.ts translates failures into
 * per-source status lines. This module is pure — the gateway supplies the fetch
 * budget.
 * @module @deepseek-ai/dsh-host-plugin-manager/manifest-client
 */

import { gunzipSync } from 'node:zlib'
import { Parser, type ReadEntry } from 'tar'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

/** Deadline code stamped on every outbound catalog fetch. */
export const CATALOG_FETCH_TIMEOUT = 'PLUGIN_CATALOG_FETCH_TIMEOUT'

/** Largest gzipped curated-list tarball this surface will accept. */
export const MAX_TARBALL_BYTES = 16 * 1024 * 1024

/** Largest manifest JSON document this surface will accept. */
export const MAX_MANIFEST_JSON_BYTES = 1024 * 1024

/** How an outbound catalog fetch failed, surfaced in the source status line. */
export type CatalogFetchErrorKind = 'timeout' | 'http' | 'size' | 'parse' | 'fetch'

/**
 * A classified outbound catalog fetch failure. It extends `Error` so the
 * transport boundary throws a real error value; `kind` discriminates the
 * classification and `isCatalogFetchError` still recognizes structurally
 * equivalent plain objects from callers.
 */
export class CatalogFetchError extends Error {
  override name = 'CatalogFetchError'

  /**
   * @param kind - the failure classification.
   * @param message - one-line detail surfaced in the source status line.
   */
  constructor(readonly kind: CatalogFetchErrorKind, message: string) {
    super(message)
  }
}

/** Build a classified fetch failure. */
export function catalogFetchError(kind: CatalogFetchErrorKind, message: string): CatalogFetchError {
  return new CatalogFetchError(kind, message)
}

/** Whether a thrown value is one of this transport's classified failures. */
export function isCatalogFetchError(value: unknown): value is CatalogFetchError {
  return typeof value === 'object'
    && value !== null
    && 'kind' in value
    && typeof value.kind === 'string'
    && 'message' in value
    && typeof value.message === 'string'
}

/** Per-fetch budget shared by every transport call. */
export interface ManifestFetchOptions {
  /** Deadline applied to the whole fetch; expiry is classified `timeout`. */
  readonly fetchTimeoutMs: number
}

/** One file read from a fetched tarball. */
export interface TarballFile {
  readonly path: string
  readonly content: string
}

/**
 * Turn a thrown fetch error into this transport's classification: a deadline
 * expiry becomes `timeout`; a failure this transport already classified keeps
 * its kind; anything else becomes `fetch`.
 */
function classify(signal: AbortSignal, error: unknown): CatalogFetchError {
  if (timeoutOf(signal, CATALOG_FETCH_TIMEOUT) !== undefined) {
    return catalogFetchError('timeout', `${CATALOG_FETCH_TIMEOUT} elapsed`)
  }
  if (isCatalogFetchError(error)) return error
  return catalogFetchError('fetch', error instanceof Error ? error.message : String(error))
}

/** Collect a response body up to a byte cap; oversized bodies fail loud. */
async function collectBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (response.body === null) {
    throw catalogFetchError('fetch', 'response returned no body')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw catalogFetchError('size', `response exceeds ${maxBytes} bytes`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * Fetch one JSON document under a deadline and byte cap.
 * @param url - the manifest URL.
 * @param opts - the fetch budget.
 * @returns the parsed JSON value.
 */
export async function fetchManifestJson(url: string, opts: ManifestFetchOptions): Promise<unknown> {
  using d = deadline(undefined, opts.fetchTimeoutMs, CATALOG_FETCH_TIMEOUT)
  let response: Response
  try {
    response = await fetch(url, { signal: d.signal })
  } catch (error) {
    throw classify(d.signal, error)
  }
  if (!response.ok) {
    throw catalogFetchError('http', `GET ${url} returned ${response.status}`)
  }
  let text: string
  try {
    text = (await collectBody(response, MAX_MANIFEST_JSON_BYTES)).toString('utf8')
  } catch (error) {
    throw classify(d.signal, error)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw catalogFetchError('parse', `GET ${url}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
}

/**
 * Fetch a gzipped tarball and extract every file whose path passes `filter`,
 * bounded by a deadline and byte cap. Matching entries are read fully into
 * memory; non-matching entries are drained and discarded.
 * @param url - the tarball URL.
 * @param opts - the fetch budget.
 * @param filter - selects which tarball paths to extract.
 * @returns the extracted files, in tarball order.
 */
export async function fetchTarballFiles(
  url: string,
  opts: ManifestFetchOptions,
  filter: (path: string) => boolean,
): Promise<readonly TarballFile[]> {
  using d = deadline(undefined, opts.fetchTimeoutMs, CATALOG_FETCH_TIMEOUT)
  let response: Response
  try {
    response = await fetch(url, { signal: d.signal })
  } catch (error) {
    throw classify(d.signal, error)
  }
  if (!response.ok) {
    throw catalogFetchError('http', `GET ${url} returned ${response.status}`)
  }
  let body: Buffer
  try {
    body = await collectBody(response, MAX_TARBALL_BYTES)
  } catch (error) {
    throw classify(d.signal, error)
  }
  let gunzipped: Buffer
  try {
    gunzipped = gunzipSync(body)
  } catch (error) {
    throw catalogFetchError('parse', `GET ${url}: not a gzip tarball (${error instanceof Error ? error.message : String(error)})`)
  }
  const files: TarballFile[] = []
  const parser = new Parser()
  const settled = new Promise<void>((resolve, reject) => {
    parser.on('error', reject)
    parser.on('close', resolve)
    parser.on('end', resolve)
  })
  parser.on('entry', (entry: ReadEntry) => {
    if (!filter(entry.path)) {
      entry.resume()
      return
    }
    const chunks: Buffer[] = []
    entry.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)) })
    entry.on('end', () => {
      files.push({ path: entry.path, content: Buffer.concat(chunks).toString('utf8') })
    })
  })
  parser.end(gunzipped)
  await settled
  return files
}
