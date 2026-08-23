/**
 * Content fingerprinting and freshness checking for the committed document.
 * The fingerprint is a sha256 hex over the sorted `(relativePath, size, content)`
 * projection of the bounded file set — a deterministic identity of "the files
 * the scan saw", so `read` can answer fresh vs stale without re-running the
 * whole analysis and the scanner can skip a rewrite when nothing changed.
 * Content is read bounded (`MAX_DOC_BYTES`, which covers every doc-affecting
 * read — source 256 KiB, manifests 1 MiB, prompt titles 8 KiB), so an over-cap
 * file contributes only its identity and size, exactly the fields the document
 * derives from it; a same-size content edit still changes the fingerprint.
 * @module @deepseek-ai/dsh-project-insight/fingerprint
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { PROJECT_INSIGHT_FORMAT_VERSION, PROJECT_INSIGHT_FILE, MAX_DOC_BYTES, type ProjectInsightDoc } from './schema.ts'
import { readBounded } from './parse.ts'
import { walkProject, type WalkedFile } from './walk.ts'

/** The document's relative path under a project root, as the model sees it. */
export const PROJECT_INSIGHT_DOC_REL = `.dsh/${PROJECT_INSIGHT_FILE}`

/**
 * Compute the content fingerprint of a project tree's bounded file set.
 * @param root - project root to walk.
 * @param maxFiles - file cap for the projection, matching the scan's own walk.
 * @param signal - aborts the walk.
 * @returns the sha256 hex fingerprint.
 */
export async function projectContentFingerprint(root: string, maxFiles: number, signal?: AbortSignal): Promise<string> {
  const files = await walkProject(root, maxFiles, signal)
  return fingerprintOf(files, signal)
}

/**
 * Compute the fingerprint over an already-collected file set. The projection
 * is the sorted `(rel, size, content)` triples; sorting happens here so the
 * caller's walk order never leaks into the identity, and content is read
 * bounded so the fingerprint is deterministic and cannot run away.
 * @param files - the collected file set.
 * @param signal - aborts the bounded content reads.
 * @returns the sha256 hex fingerprint.
 */
export async function fingerprintOf(files: readonly WalkedFile[], signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for (const file of [...files].sort(compareWalked)) {
    const content = await readBounded(file.abs, MAX_DOC_BYTES, signal)
    hash.update(`${file.rel}\0${file.size}\0`)
    if (content !== undefined) hash.update(content)
  }
  return hash.digest('hex')
}

function compareWalked(a: WalkedFile, b: WalkedFile): number {
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
}

/**
 * Read the committed document, or `undefined` when none exists. An over-cap,
 * unparsable, or wrong-version document is a read failure, not an absent one.
 * @param root - project root whose `.dsh/project-insight.json` to read.
 * @param maxFiles - file cap used to recompute the current fingerprint.
 * @param signal - aborts the reads.
 * @returns the parsed document and its fresh/stale status.
 * @throws when the stored document is over the byte cap, unparsable, or a
 * version this reader refuses.
 */
export async function readDocument(
  root: string,
  maxFiles: number,
  signal?: AbortSignal,
): Promise<{ doc: ProjectInsightDoc; status: 'fresh' | 'stale' } | undefined> {
  const path = join(root, '.dsh', PROJECT_INSIGHT_FILE)
  let text: string
  try {
    const bytes = await readFile(path)
    if (bytes.byteLength > MAX_DOC_BYTES) {
      throw new Error(`project-insight document exceeds ${MAX_DOC_BYTES} bytes`)
    }
    text = bytes.toString('utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  }
  signal?.throwIfAborted()
  const parsed = JSON.parse(text) as { contentFingerprint?: unknown; formatVersion?: unknown }
  if (parsed.formatVersion !== PROJECT_INSIGHT_FORMAT_VERSION) {
    throw new Error(
      `project-insight document has formatVersion ${String(parsed.formatVersion)}, `
      + `expected ${PROJECT_INSIGHT_FORMAT_VERSION}`,
    )
  }
  const current = await projectContentFingerprint(root, maxFiles, signal)
  const status = parsed.contentFingerprint === current ? 'fresh' : 'stale'
  return { doc: parsed as ProjectInsightDoc, status }
}

/**
 * Atomically commit a document to the project's `.dsh/` directory, creating
 * the directory and file with owner-only permissions. The returned path is the
 * only durable statement of where the document lives.
 * @param root - project root whose `.dsh/project-insight.json` to write.
 * @param doc - the complete document to persist.
 * @returns the absolute path written.
 */
export async function writeDocument(root: string, doc: ProjectInsightDoc): Promise<string> {
  const path = join(root, '.dsh', PROJECT_INSIGHT_FILE)
  await writeFileAtomic(path, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  return path
}
