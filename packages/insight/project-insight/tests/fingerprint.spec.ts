/**
 * The fingerprint is a deterministic identity of the bounded file set: sorted
 * `(relativePath, size)` pairs, so creation order never matters and a content
 * edit changes it. The document lifecycle — absent read, atomic write, fresh
 * re-read — is the commit path the service relies on.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_FINGERPRINT_FILES } from '../src/schema.ts'
import { projectContentFingerprint, readDocument, writeDocument } from '../src/fingerprint.ts'
import { scanProject } from '../src/scanner.ts'
import { walkProject } from '../src/walk.ts'

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
    const fa = await projectContentFingerprint(a, MAX_FINGERPRINT_FILES)
    const fb = await projectContentFingerprint(b, MAX_FINGERPRINT_FILES)
    expect(fa).toBe(fb)
  })

  it('changes on a same-size content edit', async () => {
    const root = await tempRoot()
    await seed(root, { 'src/a.ts': 'aaa' })
    const before = await projectContentFingerprint(root, MAX_FINGERPRINT_FILES)
    await writeFile(join(root, 'src/a.ts'), 'aab')
    const after = await projectContentFingerprint(root, MAX_FINGERPRINT_FILES)
    expect(after).not.toBe(before)
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
    expect(path).toBe(join(root, '.dsh', 'project-insight.json'))
    const existing = await readDocument(root, MAX_FINGERPRINT_FILES)
    expect(existing?.status).toBe('fresh')
    expect(existing?.doc.contentFingerprint).toBe(doc.contentFingerprint)
  })
})
