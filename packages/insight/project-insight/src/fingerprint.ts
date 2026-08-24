/**
 * Fingerprinting, freshness checking, and the per-type on-disk layout for the
 * committed document. Two identities coexist: the content fingerprint — a sha256
 * hex over the sorted `(relativePath, size, content)` projection of the bounded
 * file set — is computed only at scan time as the exact unchanged-skip dedup,
 * while the read path judges fresh vs stale with the stat signature — a sha256
 * hex over the sorted `(relativePath, size, mtimeMs)` projection — so a poll or
 * tab switch never reads file bytes. Content reads stay bounded (`MAX_DOC_BYTES`,
 * which covers every doc-affecting read — source 256 KiB, manifests 1 MiB,
 * prompt titles 8 KiB), so an over-cap file contributes only its identity and
 * size; a same-size content edit under an unchanged mtime changes the content
 * fingerprint but not the stat signature until the next scan.
 *
 * The document is stored under `.dsh/insight/` as one meta file (the versioned
 * identity fields) plus one `data.json` per scanned section, each written
 * atomically with owner-only permissions; the meta write is the commit point a
 * reader can rely on. A legacy `.dsh/project-insight.json` from the v1 layout
 * is rejected by the reader and removed once the v2 layout commits.
 * @module @deepseek-ai/dsh-project-insight/fingerprint
 */

import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { PROJECT_INSIGHT_FORMAT_VERSION, MAX_DOC_BYTES, type ProjectInsightDoc } from './schema.ts'
import { readBounded } from './parse.ts'
import { statProject, type WalkedFile } from './walk.ts'

/** Relative path of the insight document directory under a project root. */
export const PROJECT_INSIGHT_DIR_REL = '.dsh/insight'
/** Relative path of the document meta file under a project root. */
export const PROJECT_INSIGHT_META_REL = `${PROJECT_INSIGHT_DIR_REL}/meta.json`
/** Legacy single-file layout, rejected by the reader and removed after a v2 write. */
const LEGACY_DOC_REL = '.dsh/project-insight.json'

/** One scanned section's key in the committed document. */
type SectionKey = keyof ProjectInsightDoc['sections']

/**
 * The stored document's `formatVersion` differs from {@link PROJECT_INSIGHT_FORMAT_VERSION}.
 * The service reads this as a stale-and-rebuild signal rather than a fatal error,
 * so a format bump self-heals a project's committed document on the next read.
 */
export class ProjectInsightVersionError extends Error {
  constructor(readonly found: unknown) {
    super(
      `project-insight document has formatVersion ${String(found)}, expected ${PROJECT_INSIGHT_FORMAT_VERSION}`,
    )
    this.name = 'ProjectInsightVersionError'
  }
}

/** Section-key → directory-name mapping of the six typed data files. */
const SECTION_DIRS: readonly { readonly key: SectionKey; readonly name: string }[] = [
  { key: 'techStack', name: 'tech-stack' },
  { key: 'moduleTopology', name: 'module-topology' },
  { key: 'componentDependencies', name: 'component-dependencies' },
  { key: 'components', name: 'components' },
  { key: 'prompts', name: 'prompts' },
  { key: 'agentTech', name: 'agent-tech' },
]

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
 * Read one stored document file with the per-file byte cap, distinguishing an
 * absent meta (no document) from an absent section (a broken document).
 * @param root - project root.
 * @param rel - file path relative to the project root.
 * @param absent - how a missing file reads: `'none'` for the meta (no document)
 * or `'throw'` for a section (a broken document).
 * @returns the file content, or `undefined` for an absent meta.
 * @throws when the file exceeds the byte cap or, under `'throw'`, is missing.
 */
async function readStored(root: string, rel: string, absent: 'none'): Promise<string | undefined>
async function readStored(root: string, rel: string, absent: 'throw'): Promise<string>
async function readStored(root: string, rel: string, absent: 'none' | 'throw'): Promise<string | undefined> {
  const path = join(root, rel)
  try {
    const bytes = await readFile(path)
    if (bytes.byteLength > MAX_DOC_BYTES) {
      throw new Error(`project-insight ${rel} exceeds ${MAX_DOC_BYTES} bytes`)
    }
    return bytes.toString('utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      if (absent === 'none') return undefined
      throw new Error(`project-insight ${rel} is missing`)
    }
    throw error
  }
}

/**
 * Read the committed document, or `undefined` when none exists. The meta file's
 * absence means no document; a wrong-version meta, a missing or over-cap or
 * unparsable section file, or an over-cap meta is a read failure, not an absent
 * one. Freshness is judged by the stat-only structural signature, so a read
 * walks the tree but never reads file content; a doc committed before
 * `statSignature` existed has none, so it reads stale and is re-scanned.
 * @param root - project root whose `.dsh/insight/` document to read.
 * @param maxFiles - file cap used to recompute the current stat signature.
 * @param signal - aborts the reads.
 * @returns the parsed document and its fresh/stale status.
 * @throws when the stored document is wrong-version, missing a section, over the
 * byte cap, or unparsable.
 */
export async function readDocument(
  root: string,
  maxFiles: number,
  signal?: AbortSignal,
): Promise<{ doc: ProjectInsightDoc; status: 'fresh' | 'stale' } | undefined> {
  const meta = await readStored(root, PROJECT_INSIGHT_META_REL, 'none')
  if (meta === undefined) return undefined
  signal?.throwIfAborted()
  const parsed = JSON.parse(meta) as {
    formatVersion?: unknown
    rootName?: unknown
    contentFingerprint?: unknown
    statSignature?: unknown
    scannedAt?: unknown
  }
  if (parsed.formatVersion !== PROJECT_INSIGHT_FORMAT_VERSION) {
    throw new ProjectInsightVersionError(parsed.formatVersion)
  }
  const sections = {} as Record<SectionKey, unknown>
  for (const { key, name } of SECTION_DIRS) {
    signal?.throwIfAborted()
    const text = await readStored(root, `${PROJECT_INSIGHT_DIR_REL}/${name}/data.json`, 'throw')
    sections[key] = JSON.parse(text) as unknown
  }
  const current = await statProject(root, maxFiles, signal)
  const status = parsed.statSignature === current.signature ? 'fresh' : 'stale'
  return {
    doc: {
      formatVersion: PROJECT_INSIGHT_FORMAT_VERSION,
      rootName: parsed.rootName as string,
      contentFingerprint: parsed.contentFingerprint as string,
      statSignature: parsed.statSignature as string,
      scannedAt: parsed.scannedAt as number,
      sections: sections as ProjectInsightDoc['sections'],
    },
    status,
  }
}

/**
 * Atomically commit a document to the project's `.dsh/insight/` directory,
 * creating the directory tree with owner-only permissions. Each section file is
 * written before the meta file, so the meta write is the commit point a reader
 * can rely on — a read during the write sees the previous document, never a new
 * meta with missing sections. Once the layout is committed, a legacy
 * `.dsh/project-insight.json` from the v1 layout is removed. The returned path
 * is the meta file's absolute path, the document's entry point.
 * @param root - project root whose `.dsh/insight/` document to write.
 * @param doc - the complete document to persist.
 * @returns the absolute meta path written.
 */
export async function writeDocument(root: string, doc: ProjectInsightDoc): Promise<string> {
  for (const { key, name } of SECTION_DIRS) {
    const path = join(root, PROJECT_INSIGHT_DIR_REL, name, 'data.json')
    await writeFileAtomic(path, `${JSON.stringify(doc.sections[key], null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
  const metaPath = join(root, PROJECT_INSIGHT_META_REL)
  await writeFileAtomic(metaPath, `${JSON.stringify({
    formatVersion: doc.formatVersion,
    rootName: doc.rootName,
    contentFingerprint: doc.contentFingerprint,
    statSignature: doc.statSignature,
    scannedAt: doc.scannedAt,
  }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  await rm(join(root, LEGACY_DOC_REL), { force: true })
  return metaPath
}
