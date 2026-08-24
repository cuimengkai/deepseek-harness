/**
 * Two deterministic identities cover the bounded file set: the content
 * fingerprint over sorted `(relativePath, size, content)` triples (scan-time
 * unchanged-skip dedup) and the stat signature over sorted `(relativePath,
 * size, mtimeMs)` lines (read-path freshness, no content reads). The document
 * lifecycle — absent read, atomic write, fresh re-read, per-type `.dsh/insight/`
 * layout with legacy-file cleanup — is the commit path the service relies on.
 */

import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_FINGERPRINT_FILES } from '../src/schema.ts'
import { fingerprintOf, readDocument, writeDocument } from '../src/fingerprint.ts'
import { scanProject } from '../src/scanner.ts'
import { statProject, walkProject } from '../src/walk.ts'

/** A pinned mtime (seconds, year 2001) a same-size edit can restore exactly. */
const FIXED_MTIME = 1_000_000_000

let roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-insight-fp-'))
  roots.push(root)
  return root
}

/** Seed a project tree with `rel → content` files. */
async function seed(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

afterEach(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

describe('project-insight fingerprint', () => {
  it('caps the walk at maxFiles in sorted order', async () => {
    const root = await tempRoot()
    const files: Record<string, string> = {}
    for (let index = 0; index < 50; index += 1) {
      files[`file${String(index).padStart(3, '0')}.txt`] = 'x'
    }
    await seed(root, files)
    const walked = await walkProject(root, 10)
    expect(walked).toHaveLength(10)
    expect(walked[0]!.rel).toBe('file000.txt')
    expect(walked[9]!.rel).toBe('file009.txt')
  })

  it('is stable regardless of creation order', async () => {
    const a = await tempRoot()
    const b = await tempRoot()
    await seed(a, { 'src/a.ts': 'aaa', 'src/z.ts': 'zzz', 'README.md': 'hello' })
    // Same content set, created in the opposite order.
    await seed(b, { 'src/z.ts': 'zzz', 'README.md': 'hello', 'src/a.ts': 'aaa' })
    const fa = await fingerprintOf(await walkProject(a, MAX_FINGERPRINT_FILES))
    const fb = await fingerprintOf(await walkProject(b, MAX_FINGERPRINT_FILES))
    expect(fa).toBe(fb)
  })

  it('changes on a same-size content edit', async () => {
    const root = await tempRoot()
    await seed(root, { 'src/a.ts': 'aaa' })
    const before = await fingerprintOf(await walkProject(root, MAX_FINGERPRINT_FILES))
    await writeFile(join(root, 'src/a.ts'), 'aab')
    const after = await fingerprintOf(await walkProject(root, MAX_FINGERPRINT_FILES))
    expect(after).not.toBe(before)
  })

  it('statProject is deterministic and reflects add, remove, and edit', async () => {
    const root = await tempRoot()
    await seed(root, { 'a.txt': 'x' })
    const before = await statProject(root, MAX_FINGERPRINT_FILES)
    expect(before.count).toBe(1)
    expect(before.maxMtime).toBeGreaterThan(0)
    expect(before.signature).toMatch(/^[0-9a-f]{64}$/)
    // An unchanged tree re-stats to the identical projection.
    expect(await statProject(root, MAX_FINGERPRINT_FILES)).toEqual(before)

    await seed(root, { 'b.txt': 'y' })
    const added = await statProject(root, MAX_FINGERPRINT_FILES)
    expect(added.count).toBe(2)
    expect(added.signature).not.toBe(before.signature)

    await rm(join(root, 'b.txt'))
    expect(await statProject(root, MAX_FINGERPRINT_FILES)).toEqual(before)

    await writeFile(join(root, 'a.txt'), 'xy')
    const edited = await statProject(root, MAX_FINGERPRINT_FILES)
    expect(edited.signature).not.toBe(before.signature)
  })

  it('judges a same-stat content edit fresh, proving reads never read content', async () => {
    const root = await tempRoot()
    await seed(root, { 'src/a.ts': 'aaa' })
    // Pin the mtime so the edit below can restore it exactly; a same-size edit
    // under the identical mtime leaves the stat signature unchanged.
    await utimes(join(root, 'src', 'a.ts'), FIXED_MTIME, FIXED_MTIME)
    const { doc } = await scanProject(root)
    await writeDocument(root, doc)

    await writeFile(join(root, 'src', 'a.ts'), 'aab')
    await utimes(join(root, 'src', 'a.ts'), FIXED_MTIME, FIXED_MTIME)
    const existing = await readDocument(root, MAX_FINGERPRINT_FILES)
    expect(existing?.status).toBe('fresh')
  })

  it('the content fingerprint catches a same-stat content edit at scan time', async () => {
    const root = await tempRoot()
    await seed(root, { 'src/a.ts': 'aaa' })
    await utimes(join(root, 'src', 'a.ts'), FIXED_MTIME, FIXED_MTIME)
    const first = await scanProject(root)

    await writeFile(join(root, 'src', 'a.ts'), 'aab')
    await utimes(join(root, 'src', 'a.ts'), FIXED_MTIME, FIXED_MTIME)
    const second = await scanProject(root)

    // The stat projection is blind to the edit, so the signature holds; the
    // content fingerprint is not, so a re-scan records the new identity.
    expect(second.doc.statSignature).toBe(first.doc.statSignature)
    expect(second.doc.contentFingerprint).not.toBe(first.doc.contentFingerprint)
  })

  it('returns undefined for an absent document', async () => {
    const root = await tempRoot()
    await seed(root, { 'package.json': '{}' })
    const existing = await readDocument(root, MAX_FINGERPRINT_FILES)
    expect(existing).toBeUndefined()
  })

  it('commits a document that reads back fresh', async () => {
    const root = await tempRoot()
    await seed(root, { 'package.json': '{}', 'src/a.ts': 'export const a = 1' })
    const { doc } = await scanProject(root)
    const path = await writeDocument(root, doc)
    expect(path).toBe(join(root, '.dsh', 'insight', 'meta.json'))
    const existing = await readDocument(root, MAX_FINGERPRINT_FILES)
    expect(existing?.status).toBe('fresh')
    expect(existing?.doc.contentFingerprint).toBe(doc.contentFingerprint)
    expect(existing?.doc.statSignature).toBe(doc.statSignature)
  })

  it('stores each section in its own typed data file under the per-type layout', async () => {
    const root = await tempRoot()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': "import { a } from './a'\n",
      'src/a.ts': 'export const a = 1',
    })
    const { doc } = await scanProject(root)
    await writeDocument(root, doc)

    const base = join(root, '.dsh', 'insight')
    const meta = JSON.parse(await readFile(join(base, 'meta.json'), 'utf8')) as Record<string, unknown>
    expect(meta['formatVersion']).toBe(3)
    expect(meta['rootName']).toBe(doc.rootName)
    expect(meta['contentFingerprint']).toBe(doc.contentFingerprint)
    expect(meta['statSignature']).toBe(doc.statSignature)
    expect(meta['scannedAt']).toBe(doc.scannedAt)
    // The meta carries only identity fields, never the sections.
    expect('sections' in meta).toBe(false)

    const sections = JSON.parse(await readFile(join(base, 'module-topology', 'data.json'), 'utf8'))
    expect(sections).toEqual(doc.sections.moduleTopology)
  })

  it('rejects a document committed under the v1 format version', async () => {
    const root = await tempRoot()
    await seed(root, { 'package.json': '{}' })
    await mkdir(join(root, '.dsh', 'insight'), { recursive: true })
    await writeFile(join(root, '.dsh', 'insight', 'meta.json'), JSON.stringify({ formatVersion: 1 }))
    await expect(readDocument(root, MAX_FINGERPRINT_FILES)).rejects.toThrow(/formatVersion 1/)
  })

  it('fails a read when a section file is missing', async () => {
    const root = await tempRoot()
    await seed(root, {
      'package.json': '{}',
      'src/Button.tsx': 'export function Button() {}',
    })
    const { doc } = await scanProject(root)
    await writeDocument(root, doc)
    await rm(join(root, '.dsh', 'insight', 'components', 'data.json'))

    await expect(readDocument(root, MAX_FINGERPRINT_FILES)).rejects.toThrow(/components/)
  })

  it('ignores a legacy single-file document and removes it once the v2 layout commits', async () => {
    const root = await tempRoot()
    await seed(root, {
      'package.json': '{}',
      '.dsh/project-insight.json': '{"formatVersion": 1}',
    })
    // The legacy file is not part of the v2 layout, so there is no document.
    expect(await readDocument(root, MAX_FINGERPRINT_FILES)).toBeUndefined()

    const { doc } = await scanProject(root)
    await writeDocument(root, doc)
    await expect(stat(join(root, '.dsh', 'project-insight.json'))).rejects.toThrow()
  })

  it('writes the meta and section files with owner-only permissions', async () => {
    const root = await tempRoot()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': 'export const x = 1',
    })
    const { doc } = await scanProject(root)
    await writeDocument(root, doc)

    const base = join(root, '.dsh', 'insight')
    for (const rel of ['meta.json', 'tech-stack/data.json', 'module-topology/data.json']) {
      expect((await stat(join(base, rel))).mode & 0o077).toBe(0)
    }
    for (const dir of ['.dsh', '.dsh/insight', '.dsh/insight/tech-stack']) {
      expect((await stat(join(root, dir))).mode & 0o077).toBe(0)
    }
  })
})
