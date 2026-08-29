/**
 * Project-bundle document read/write and id minting.
 * @module tests/persist
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT_BUNDLE_FORMAT_VERSION, ProjectBundleId, type ProjectBundle } from '../src/types.ts'
import {
  deleteProjectFile,
  idFromName,
  listProjectFiles,
  projectPath,
  readProjectFile,
  writeProjectFile,
} from '../src/persist.ts'

const bundle = (id: string, extra: Partial<ProjectBundle> = {}): ProjectBundle => ({
  id: ProjectBundleId(id),
  name: 'Launch',
  instructions: '',
  connectorIds: [],
  expertPresetIds: [],
  skillPaths: [],
  sharedRoot: '/tmp/launch',
  updatedAt: 1,
  ...extra,
})

describe('project-bundle persist', () => {
  it('refuses a non-kebab path and mints unique empty-name ids', () => {
    expect(() => projectPath('/tmp', 'Not Valid')).toThrow('kebab-case')
    expect(idFromName('   ', new Set())).toBe('project')
    expect(idFromName('Launch', new Set(['launch']))).toBe('launch-2')
  })

  it('lists nothing from a missing directory and skips corrupt files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-proj-persist-'))
    try {
      expect(await listProjectFiles(join(root, 'missing'))).toEqual([])
      await writeProjectFile(root, bundle('ok'))
      await writeFile(join(root, 'notes.txt'), 'skip')
      await writeFile(join(root, 'bad.json'), '{')
      await writeFile(join(root, 'wrong-ver.json'), JSON.stringify({
        formatVersion: 99,
        bundle: bundle('wrong-ver'),
      }))
      const listed = await listProjectFiles(root)
      expect(listed.map(item => item.id)).toEqual(['ok'])
      await expect(readProjectFile(root, 'wrong-ver')).rejects.toThrow('formatVersion')
      await deleteProjectFile(root, 'ok')
      await deleteProjectFile(root, 'ok')
      expect(await listProjectFiles(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses an incomplete document on write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-proj-assert-'))
    try {
      await expect(writeProjectFile(root, bundle('x', { name: '  ' }))).rejects.toThrow('non-empty name')
      await expect(writeProjectFile(root, bundle('x', { sharedRoot: '  ' }))).rejects.toThrow('sharedRoot')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses oversized, mismatched, and illegal documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-proj-more-'))
    try {
      await writeFile(join(root, 'huge.json'), `${'x'.repeat(257 * 1024)}`)
      await expect(readProjectFile(root, 'huge')).rejects.toThrow('exceeds')
      await writeFile(join(root, 'mismatch.json'), JSON.stringify({
        formatVersion: PROJECT_BUNDLE_FORMAT_VERSION,
        bundle: bundle('other'),
      }))
      await expect(readProjectFile(root, 'mismatch')).rejects.toThrow('does not match')
      await writeProjectFile(root, bundle('a'))
      await writeProjectFile(root, bundle('b'))
      expect((await listProjectFiles(root)).map(item => item.id)).toEqual(['a', 'b'])
      await expect(writeProjectFile(root, bundle('NotValid' as ProjectBundle['id']))).rejects.toThrow('kebab-case')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('throws when the root exists but is not a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-proj-file-'))
    const file = join(dir, 'not-dir')
    await writeFile(file, 'x')
    await expect(listProjectFiles(file)).rejects.toThrow()
    await rm(dir, { recursive: true, force: true })
  })
})
