/**
 * Provenance ledger of network-installed plugins: `$DSH_HOME/plugins/installed.json`
 * maps the public catalog name a client passes to the resolved module name,
 * install spec, source, and timestamp. Kept separate from the home patch so the
 * managed rows stay the exact `{ insert: [{ id: 'dsh-managed-<slug>', name }] }`
 * shapes the ownership logic already knows; the ledger is the authoritative
 * `installed` source for network entries.
 * @module @deepseek-ai/dsh-host-plugin-manager/ledger
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** One installed network plugin. */
export interface InstalledPluginRecord {
  /** Resolved package name discovered in the store after install. */
  readonly moduleName: string
  /** Store directory slug for the public name. */
  readonly slug: string
  /** The install spec passed to the package manager. */
  readonly installRef: string
  /** Source id that contributed the catalog entry. */
  readonly source: string
  /** Epoch millis when the ledger row was written. */
  readonly installedAt: number
  /** Resolved version from the store lockfile, `''` when unavailable at
   * install time or carried by a pre-integrity ledger row. */
  readonly version: string
  /** npm integrity (`sha512-…`) from the store lockfile, `''` when unavailable
   * at install time or carried by a pre-integrity ledger row. */
  readonly integrity: string
}

/** Absolute path of the provenance ledger. Resolved per call (home may change). */
export function ledgerPath(): string {
  return join(resolveDshHome(), 'plugins', 'installed.json')
}

/**
 * Read the provenance ledger. A missing, unreadable, or non-map file is an empty
 * ledger — a corrupt ledger never hides the catalog, because the managed
 * home-patch row remains the double-install guard for the resolved module name.
 * Rows are accepted when they carry the resolved `moduleName` (the field every
 * consumer reads back); the remaining provenance fields default when absent.
 * @returns the ledger records by public name.
 */
export function readLedger(): ReadonlyMap<string, InstalledPluginRecord> {
  let raw: string
  try {
    raw = readFileSync(ledgerPath(), 'utf8')
  } catch {
    return new Map()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Map()
  }
  const ledger = new Map<string, InstalledPluginRecord>()
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return ledger
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const record = value as Partial<InstalledPluginRecord>
    if (typeof record.moduleName !== 'string') continue
    ledger.set(key, {
      moduleName: record.moduleName,
      slug: typeof record.slug === 'string' ? record.slug : '',
      installRef: typeof record.installRef === 'string' ? record.installRef : '',
      source: typeof record.source === 'string' ? record.source : '',
      installedAt: typeof record.installedAt === 'number' ? record.installedAt : 0,
      version: typeof record.version === 'string' ? record.version : '',
      integrity: typeof record.integrity === 'string' ? record.integrity : '',
    })
  }
  return ledger
}

/**
 * Mutate the ledger atomically under the cross-process writer lock, mirroring
 * {@link updateHomePatch}: the directory is created before the lock, the
 * transform runs against the freshly-read ledger, and the result is written with
 * atomic replace and private permissions.
 * @param transform - decides the next ledger from the current one.
 */
export async function updateLedger(
  transform: (ledger: Map<string, InstalledPluginRecord>) => void,
): Promise<void> {
  const path = ledgerPath()
  mkdirSync(dirname(path), { recursive: true })
  return withFileLock(path, async () => {
    const ledger = new Map(readLedger())
    transform(ledger)
    const object: Record<string, InstalledPluginRecord> = {}
    for (const [key, value] of ledger) object[key] = value
    await writeFileAtomic(path, JSON.stringify(object, undefined, 2) + '\n', { mode: 0o600, dirMode: 0o700 })
  })
}
