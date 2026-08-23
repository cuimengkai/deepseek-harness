/**
 * Provenance ledger behavior: read/write round-trips, atomic RMW under the
 * writer lock, missing/corrupt/non-map files, and the private file mode. Runs
 * against a private temp $DSH_HOME.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ledgerPath, readLedger, updateLedger, type InstalledPluginRecord } from '../src/ledger.ts'

let home: string | undefined

afterEach(() => {
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
  delete process.env.DSH_HOME
})

function tempHome(): void {
  home = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-ledger-'))
  process.env.DSH_HOME = home
  // Direct writes below target `$DSH_HOME/plugins/installed.json`; the parent
  // dir is created by `updateLedger` in real use, so the corrupt-file fixtures
  // create it here too.
  mkdirSync(join(home, 'plugins'), { recursive: true })
}

const RECORD: InstalledPluginRecord = {
  moduleName: '@fixture/net-ping',
  slug: 'net-ping',
  installRef: 'https://example.test/net-ping.tgz',
  source: 'market',
  installedAt: 1234,
  version: '1.0.0',
  integrity: 'sha512-testintegrity',
}

describe('plugin provenance ledger', () => {
  it('reads an absent ledger as empty', () => {
    tempHome()
    expect(readLedger()).toEqual(new Map())
  })

  it('round-trips a record through an atomic update', async () => {
    tempHome()
    await updateLedger((ledger) => { ledger.set('@fixture/net-ping', RECORD) })
    expect(readLedger().get('@fixture/net-ping')).toEqual(RECORD)
    expect(statSync(ledgerPath()).mode & 0o777).toBe(0o600)
  })

  it('mutates the current ledger inside the transform and persists the result', async () => {
    tempHome()
    await updateLedger((ledger) => { ledger.set('a', { ...RECORD, moduleName: 'a' }) })
    await updateLedger((ledger) => { ledger.set('b', { ...RECORD, moduleName: 'b' }) })
    await updateLedger((ledger) => { ledger.delete('a') })
    expect([...readLedger().keys()]).toEqual(['b'])
  })

  it('treats a corrupt file as an empty ledger', () => {
    tempHome()
    writeFileSync(ledgerPath(), 'not json {')
    expect(readLedger()).toEqual(new Map())
  })

  it('treats a non-map file as an empty ledger', () => {
    tempHome()
    writeFileSync(ledgerPath(), '[1, 2]')
    expect(readLedger()).toEqual(new Map())
  })

  it('skips rows missing the required identity fields', () => {
    tempHome()
    writeFileSync(ledgerPath(), JSON.stringify({ ok: { moduleName: '@fixture/x' }, bad: { installRef: 'y' } }))
    const ledger = readLedger()
    expect(ledger.get('ok')?.moduleName).toBe('@fixture/x')
    expect(ledger.has('bad')).toBe(false)
  })

  it('writes an empty object for a no-op transform', async () => {
    tempHome()
    await updateLedger(() => {})
    expect(JSON.parse(readFileSync(ledgerPath(), 'utf8'))).toEqual({})
  })
})
