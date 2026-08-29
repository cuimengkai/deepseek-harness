/**
 * Project-bundle documents under `<root>/<id>.json`.
 * @module @deepseek-ai/dsh-project-bundle/persist
 */

import { readFile, readdir, unlink } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  PROJECT_BUNDLE_FORMAT_VERSION,
  ProjectBundleId,
  type ProjectBundle,
} from './types.ts'

const FILE_EXT = '.json'
const MAX_BYTES = 256 * 1024
export const PROJECT_BUNDLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

interface ProjectFile {
  readonly formatVersion: typeof PROJECT_BUNDLE_FORMAT_VERSION
  readonly bundle: ProjectBundle
}

/**
 * Absolute path of one project document.
 * @param root - projects directory.
 * @param id - kebab-case id.
 * @returns the document path.
 */
export function projectPath(root: string, id: string): string {
  if (!PROJECT_BUNDLE_ID_PATTERN.test(id)) {
    throw new Error(`project id "${id}" is not kebab-case (1–32 lowercase letters, digits, hyphens)`)
  }
  return join(root, `${id}${FILE_EXT}`)
}

/**
 * Mint a kebab id from a display name.
 * @param name - display name.
 * @param taken - ids already in use.
 * @returns a kebab id.
 */
export function idFromName(name: string, taken: ReadonlySet<string>): ProjectBundleId {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  const seed = base === '' ? 'project' : base
  let candidate = seed
  let n = 2
  while (taken.has(candidate) || !PROJECT_BUNDLE_ID_PATTERN.test(candidate)) {
    candidate = `${seed}-${n}`
    n += 1
  }
  return ProjectBundleId(candidate)
}

/**
 * List persisted bundles, skipping unparseable files.
 * @param root - projects directory.
 * @returns bundles sorted by id.
 */
export async function listProjectFiles(root: string): Promise<ProjectBundle[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const out: ProjectBundle[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(FILE_EXT)) continue
    const id = entry.name.slice(0, -FILE_EXT.length)
    try {
      out.push(await readProjectFile(root, id))
    } catch {
      // A corrupt document stays on disk; the listing omits it.
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

/**
 * Read one project document.
 * @param root - projects directory.
 * @param id - kebab-case id.
 * @returns the bundle.
 */
export async function readProjectFile(root: string, id: string): Promise<ProjectBundle> {
  const raw = await readFile(projectPath(root, id), 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    throw new Error(`project "${id}" exceeds ${MAX_BYTES} bytes`)
  }
  const parsed = JSON.parse(raw) as ProjectFile
  if (parsed.formatVersion !== PROJECT_BUNDLE_FORMAT_VERSION) {
    throw new Error(`project "${id}" has formatVersion ${String(parsed.formatVersion)}, expected ${PROJECT_BUNDLE_FORMAT_VERSION}`)
  }
  if (parsed.bundle.id !== id) {
    throw new Error(`project "${id}" document id "${parsed.bundle.id}" does not match the file name`)
  }
  assertBundle(parsed.bundle)
  return parsed.bundle
}

/**
 * Write one project document atomically.
 * @param root - projects directory.
 * @param bundle - the bundle to persist.
 */
export async function writeProjectFile(root: string, bundle: ProjectBundle): Promise<void> {
  assertBundle(bundle)
  await writeFileAtomic(
    projectPath(root, bundle.id),
    `${JSON.stringify({ formatVersion: PROJECT_BUNDLE_FORMAT_VERSION, bundle }, null, 2)}\n`,
    { mode: 0o600, dirMode: 0o700 },
  )
}

/**
 * Delete one project document. Missing is success.
 * @param root - projects directory.
 * @param id - kebab-case id.
 */
export async function deleteProjectFile(root: string, id: string): Promise<void> {
  try {
    await unlink(projectPath(root, id))
  } catch (error) {
    /* v8 ignore start -- unlink fails only for unexpected filesystem errors */
    if (isMissingPathError(error)) return
    throw error
    /* v8 ignore stop */
  }
}

function assertBundle(bundle: ProjectBundle): void {
  if (!PROJECT_BUNDLE_ID_PATTERN.test(bundle.id)) {
    throw new Error(`project id "${bundle.id}" is not kebab-case`)
  }
  if (bundle.name.trim() === '') throw new Error(`project "${bundle.id}" needs a non-empty name`)
  if (bundle.sharedRoot.trim() === '') throw new Error(`project "${bundle.id}" needs a sharedRoot directory`)
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
