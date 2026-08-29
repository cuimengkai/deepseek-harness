/**
 * Automation-rule document read/write and id minting.
 * @module tests/persist
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTOMATION_FORMAT_VERSION, AutomationId, type AutomationRule } from '../src/types.ts'
import {
  automationPath,
  deleteAutomationFile,
  idFromName,
  listAutomationFiles,
  readAutomationFile,
  writeAutomationFile,
} from '../src/persist.ts'

const rule = (id: string, extra: Partial<AutomationRule> = {}): AutomationRule => ({
  id: AutomationId(id),
  name: 'Hourly',
  prompt: 'Go',
  enabled: true,
  kind: 'interval',
  intervalMs: 3_600_000,
  updatedAt: 1,
  ...extra,
})

describe('automation persist', () => {
  it('refuses a non-kebab path and mints unique empty-name ids', () => {
    expect(() => automationPath('/tmp', 'Not Valid')).toThrow('kebab-case')
    expect(idFromName('   ', new Set())).toBe('automation')
    expect(idFromName('Hourly', new Set(['hourly']))).toBe('hourly-2')
  })

  it('lists nothing from a missing directory and skips corrupt files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-auto-persist-'))
    try {
      expect(await listAutomationFiles(join(root, 'missing'))).toEqual([])
      await writeAutomationFile(root, rule('ok'))
      await writeFile(join(root, 'notes.txt'), 'skip')
      await writeFile(join(root, 'bad.json'), '{')
      await writeFile(join(root, 'wrong-ver.json'), JSON.stringify({
        formatVersion: 99,
        rule: rule('wrong-ver'),
      }))
      const listed = await listAutomationFiles(root)
      expect(listed.map(item => item.id)).toEqual(['ok'])
      await expect(readAutomationFile(root, 'wrong-ver')).rejects.toThrow('formatVersion')
      await deleteAutomationFile(root, 'ok')
      await deleteAutomationFile(root, 'ok')
      expect(await listAutomationFiles(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses an incomplete document on write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-auto-assert-'))
    try {
      await expect(writeAutomationFile(root, rule('x', { name: '  ' }))).rejects.toThrow('non-empty name')
      await expect(writeAutomationFile(root, rule('x', { prompt: '  ' }))).rejects.toThrow('non-empty prompt')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses oversized, mismatched, and illegal documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-auto-more-'))
    try {
      await writeFile(join(root, 'huge.json'), `${'x'.repeat(65 * 1024)}`)
      await expect(readAutomationFile(root, 'huge')).rejects.toThrow('exceeds')
      await writeFile(join(root, 'mismatch.json'), JSON.stringify({
        formatVersion: AUTOMATION_FORMAT_VERSION,
        rule: rule('other'),
      }))
      await expect(readAutomationFile(root, 'mismatch')).rejects.toThrow('does not match')
      await writeAutomationFile(root, rule('a'))
      await writeAutomationFile(root, rule('b'))
      expect((await listAutomationFiles(root)).map(item => item.id)).toEqual(['a', 'b'])
      await expect(writeAutomationFile(root, rule('NotValid' as AutomationRule['id']))).rejects.toThrow('kebab-case')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('throws when the root exists but is not a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-auto-file-'))
    const file = join(dir, 'not-dir')
    await writeFile(file, 'x')
    await expect(listAutomationFiles(file)).rejects.toThrow()
    await rm(dir, { recursive: true, force: true })
  })
})
