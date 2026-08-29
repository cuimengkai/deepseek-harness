/**
 * Connector documents under `<root>/<id>.json`. The kebab-case id is the
 * path-traversal guard.
 * @module @deepseek-ai/dsh-connector-registry/persist
 */

import { readFile, readdir, unlink } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  CONNECTOR_FORMAT_VERSION,
  ConnectorId,
  type ConnectorEntry,
  type ConnectorTransport,
} from './types.ts'

/** On-disk suffix. */
const FILE_EXT = '.json'
/** Per-document size cap. */
const MAX_BYTES = 64 * 1024
/** A valid kebab-case connector id (also the persisted file name). */
export const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/
/** MCP `serverName` grammar, mirrored from `dsh-mcp-client`. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** The on-disk envelope. */
interface ConnectorFile {
  readonly formatVersion: typeof CONNECTOR_FORMAT_VERSION
  readonly entry: ConnectorEntry
}

/**
 * Absolute path of one connector document, or throws for a non-kebab id.
 * @param root - the connectors directory.
 * @param id - kebab-case connector id.
 * @returns the document path.
 */
export function connectorPath(root: string, id: string): string {
  if (!CONNECTOR_ID_PATTERN.test(id)) {
    throw new Error(`connector id "${id}" is not kebab-case (1–32 lowercase letters, digits, hyphens)`)
  }
  return join(root, `${id}${FILE_EXT}`)
}

/**
 * Mint a kebab id from a display name, unique against `taken`.
 * @param name - display name.
 * @param taken - ids already in use.
 * @returns a kebab id.
 */
export function idFromName(name: string, taken: ReadonlySet<string>): ConnectorId {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const seed = base === '' ? 'connector' : base
  let candidate = seed
  let n = 2
  while (taken.has(candidate) || !CONNECTOR_ID_PATTERN.test(candidate)) {
    candidate = `${seed}-${n}`
    n += 1
  }
  return ConnectorId(candidate)
}

/**
 * Mint a unique MCP `serverName` from a display name.
 * @param name - display name.
 * @param taken - server names already in use.
 * @returns a legal serverName.
 */
export function serverNameFromName(name: string, taken: ReadonlySet<string>): string {
  const base = name.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
  const seed = base === '' ? 'connector' : base
  let candidate = seed
  let n = 2
  while (taken.has(candidate) || !SERVER_NAME_PATTERN.test(candidate)) {
    candidate = `${seed}_${n}`
    n += 1
  }
  return candidate
}

/**
 * List persisted connectors, skipping unparseable files.
 * @param root - the connectors directory.
 * @returns entries sorted by id.
 */
export async function listConnectorFiles(root: string): Promise<ConnectorEntry[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const out: ConnectorEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(FILE_EXT)) continue
    const id = entry.name.slice(0, -FILE_EXT.length)
    try {
      out.push(await readConnectorFile(root, id))
    } catch {
      // A corrupt document stays on disk; the listing omits it.
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

/**
 * Read and validate one connector document.
 * @param root - the connectors directory.
 * @param id - kebab-case id.
 * @returns the entry.
 */
export async function readConnectorFile(root: string, id: string): Promise<ConnectorEntry> {
  const path = connectorPath(root, id)
  const raw = await readFile(path, 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    throw new Error(`connector "${id}" exceeds ${MAX_BYTES} bytes`)
  }
  const parsed = JSON.parse(raw) as ConnectorFile
  if (parsed.formatVersion !== CONNECTOR_FORMAT_VERSION) {
    throw new Error(`connector "${id}" has formatVersion ${String(parsed.formatVersion)}, expected ${CONNECTOR_FORMAT_VERSION}`)
  }
  const entry = parsed.entry
  if (entry.id !== id) {
    throw new Error(`connector "${id}" document id "${entry.id}" does not match the file name`)
  }
  assertEntry(entry)
  return entry
}

/**
 * Write one connector document atomically.
 * @param root - the connectors directory.
 * @param entry - the entry to persist.
 */
export async function writeConnectorFile(root: string, entry: ConnectorEntry): Promise<void> {
  assertEntry(entry)
  const path = connectorPath(root, entry.id)
  const body = `${JSON.stringify({ formatVersion: CONNECTOR_FORMAT_VERSION, entry }, null, 2)}\n`
  await writeFileAtomic(path, body, { mode: 0o600, dirMode: 0o700 })
}

/**
 * Delete one connector document. Missing is success.
 * @param root - the connectors directory.
 * @param id - kebab-case id.
 */
export async function deleteConnectorFile(root: string, id: string): Promise<void> {
  try {
    await unlink(connectorPath(root, id))
  } catch (error) {
    /* v8 ignore start -- unlink fails only for unexpected filesystem errors */
    if (isMissingPathError(error)) return
    throw error
    /* v8 ignore stop */
  }
}

function assertEntry(entry: ConnectorEntry): void {
  if (!CONNECTOR_ID_PATTERN.test(entry.id)) {
    throw new Error(`connector id "${entry.id}" is not kebab-case`)
  }
  if (entry.name.trim() === '') throw new Error(`connector "${entry.id}" needs a non-empty name`)
  if (!SERVER_NAME_PATTERN.test(entry.serverName)) {
    throw new Error(`connector "${entry.id}" serverName "${entry.serverName}" is not a legal MCP namespace`)
  }
  const transport: ConnectorTransport = entry.transport
  if (transport === 'streamable-http') {
    if (entry.url === undefined || entry.url.trim() === '') {
      throw new Error(`connector "${entry.id}" streamable-http transport needs a url`)
    }
  } else if (transport === 'stdio') {
    if (entry.command === undefined || entry.command.trim() === '') {
      throw new Error(`connector "${entry.id}" stdio transport needs a command`)
    }
  } else {
    throw new Error(`connector "${entry.id}" has unknown transport`)
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
