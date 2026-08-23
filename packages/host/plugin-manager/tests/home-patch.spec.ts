/**
 * Home-patch read-modify-write behavior: managed-row ownership, the locked
 * atomic write, and the fail-loud parse contract shared with app boot.
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  homePatchPath,
  isManagedInsertFor,
  managedEntryId,
  readHomePatchRows,
  renderPatchList,
  rowEntryNames,
  updateHomePatch,
  upsertDisabledOverride,
} from '../src/home-patch.ts'

let home: string | undefined

afterEach(() => {
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
  delete process.env.DSH_HOME
})

/** Point every home-patch operation at a fresh private temp home. */
function tempHome(): string {
  home = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-home-'))
  process.env.DSH_HOME = home
  return home
}

describe('managed row derivation', () => {
  it('derives the managed row id from a module specifier', () => {
    expect(managedEntryId('@scope/name')).toBe('dsh-managed-scope-name')
    expect(managedEntryId('@deepseek-ai/dsh-compaction')).toBe('dsh-managed-deepseek-ai-dsh-compaction')
    expect(managedEntryId('plain-package')).toBe('dsh-managed-plain-package')
  })

  it('recognizes only managed insert rows for the exact id/name pair', () => {
    const entryId = managedEntryId('@scope/name')
    expect(isManagedInsertFor({ insert: [{ id: entryId, name: '@scope/name' }] }, entryId, '@scope/name')).toBe(true)
    // A bare user-authored name row is never managed.
    expect(isManagedInsertFor({ name: '@scope/name' }, entryId, '@scope/name')).toBe(false)
    // A different id or a different module is not this managed row.
    expect(isManagedInsertFor({ insert: [{ id: 'user-row', name: '@scope/name' }] }, entryId, '@scope/name')).toBe(false)
    expect(isManagedInsertFor({ insert: [{ id: entryId, name: '@other/name' }] }, entryId, '@scope/name')).toBe(false)
  })

  it('collects declared names from bare and insert rows', () => {
    expect(rowEntryNames({ name: '@a/b' })).toEqual(['@a/b'])
    expect(rowEntryNames({ insert: [{ id: 'x', name: '@a/b' }, { id: 'y', name: '@c/d' }] })).toEqual(['@a/b', '@c/d'])
    expect(rowEntryNames({ config: { deep: 1 } })).toEqual([])
  })
})

describe('disable-override upsert', () => {
  it('appends a disable override when no row carries the bare id', () => {
    expect(upsertDisabledOverride([{ id: 'agent', name: '@a/agent' }], 'goal', true)).toEqual([
      { id: 'agent', name: '@a/agent' },
      { id: 'goal', disabled: true },
    ])
  })

  it('replaces disabled in place on the matching row, preserving its other keys', () => {
    expect(upsertDisabledOverride([{ id: 'agent', name: '@a/agent', config: { keep: 1 } }], 'agent', true)).toEqual([
      { id: 'agent', name: '@a/agent', config: { keep: 1 }, disabled: true },
    ])
  })

  it('flips a disable override back off for reinstall', () => {
    expect(upsertDisabledOverride([{ id: 'agent', disabled: true }], 'agent', false)).toEqual([
      { id: 'agent', disabled: false },
    ])
  })

  it('leaves every unrelated row untouched', () => {
    const rows = [
      { insert: [{ id: 'dsh-managed-a', name: '@a/b' }] },
      { id: 'user-row', config: { keep: true } },
    ]
    expect(upsertDisabledOverride(rows, 'agent', true)).toEqual([
      { insert: [{ id: 'dsh-managed-a', name: '@a/b' }] },
      { id: 'user-row', config: { keep: true } },
      { id: 'agent', disabled: true },
    ])
  })
})

describe('home patch path and reads', () => {
  it('resolves the home patch under $DSH_HOME', () => {
    const dir = tempHome()
    expect(homePatchPath()).toBe(join(dir, 'cordis.patch.yml'))
  })

  it('reads a missing home patch as an empty list', () => {
    tempHome()
    expect(readHomePatchRows()).toEqual([])
  })

  it('fails loud on an unparsable home patch without rewriting it', async () => {
    const dir = tempHome()
    const path = join(dir, 'cordis.patch.yml')
    writeFileSync(path, 'invalid: [unclosed\n')
    expect(() => readHomePatchRows()).toThrow()
    await awaitExpectRejectUnchanged(path)
  })

  it('round-trips !!js expression nodes read from the file', async () => {
    const dir = tempHome()
    writeFileSync(join(dir, 'cordis.patch.yml'), '- id: x\n  config:\n    model: !!js process.env.DSH_MODEL\n')
    expect(readHomePatchRows()).toEqual([{ id: 'x', config: { model: { __jsExpr: 'process.env.DSH_MODEL' } } }])
    expect(renderPatchList(readHomePatchRows())).toContain('!!js process.env.DSH_MODEL')
  })
})

/** Assert that a mutation against the present-but-broken file rejects and leaves it byte-identical. */
async function awaitExpectRejectUnchanged(path: string): Promise<void> {
  const before = readFileSync(path, 'utf8')
  await expect(updateHomePatch(rows => ({ applied: true, rows }))).rejects.toThrow()
  expect(readFileSync(path, 'utf8')).toBe(before)
}

describe('locked read-modify-write', () => {
  it('creates the file on first write with private permissions', async () => {
    const dir = tempHome()
    const applied = await updateHomePatch(() => ({
      applied: true,
      rows: [{ insert: [{ id: 'dsh-managed-a', name: '@a/b' }] }],
    }))
    expect(applied).toMatchObject({ applied: true })
    const path = homePatchPath()
    expect(readFileSync(path, 'utf8')).toContain('id: dsh-managed-a')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(readHomePatchRows()).toEqual([{ insert: [{ id: 'dsh-managed-a', name: '@a/b' }] }])
  })

  it('appends without disturbing earlier rows', async () => {
    tempHome()
    await updateHomePatch(rows => ({ applied: true, rows: [...rows, { insert: [{ id: 'dsh-managed-a', name: '@a/b' }] }] }))
    await updateHomePatch(rows => ({ applied: true, rows: [...rows, { insert: [{ id: 'dsh-managed-c', name: '@c/d' }] }] }))
    expect(readHomePatchRows()).toEqual([
      { insert: [{ id: 'dsh-managed-a', name: '@a/b' }] },
      { insert: [{ id: 'dsh-managed-c', name: '@c/d' }] },
    ])
  })

  it('writes nothing when the transform rejects', async () => {
    tempHome()
    const result = await updateHomePatch(() => ({ applied: false, code: 'not-installed' }))
    expect(result).toEqual({ applied: false, code: 'not-installed' })
    expect(() => readFileSync(homePatchPath(), 'utf8')).toThrow()
  })

  it('re-reads committed rows on the next mutation (serialized writers)', async () => {
    tempHome()
    await updateHomePatch(rows => ({
      applied: true,
      rows: [...rows, { insert: [{ id: 'dsh-managed-a', name: '@a/b' }] }],
    }))
    const second = await updateHomePatch((rows) => {
      // The previous mutation committed before this one ran under the writer
      // lock: the rows it appended are visible here, closing the double-insert
      // window. (Concurrent contenders are deliberately awaited in sequence:
      // the writer lock guarantees mutual exclusion, not which contender wins.)
      expect(rows.some(row => isManagedInsertFor(row, 'dsh-managed-a', '@a/b'))).toBe(true)
      return { applied: true, rows: [...rows, { insert: [{ id: 'dsh-managed-c', name: '@c/d' }] }] }
    })
    expect(second).toMatchObject({ applied: true })
    expect(readHomePatchRows()).toEqual([
      { insert: [{ id: 'dsh-managed-a', name: '@a/b' }] },
      { insert: [{ id: 'dsh-managed-c', name: '@c/d' }] },
    ])
  })

  it('removes a managed row while preserving every other row', async () => {
    tempHome()
    await updateHomePatch(rows => ({
      applied: true,
      rows: [
        ...rows,
        { insert: [{ id: 'dsh-managed-a', name: '@a/b' }] },
        { id: 'user-row', config: { keep: true } },
      ],
    }))
    const removed = await updateHomePatch(rows => ({
      applied: true,
      rows: rows.filter(row => !isManagedInsertFor(row, 'dsh-managed-a', '@a/b')),
    }))
    expect(removed).toMatchObject({ applied: true })
    expect(readHomePatchRows()).toEqual([{ id: 'user-row', config: { keep: true } }])
  })
})
