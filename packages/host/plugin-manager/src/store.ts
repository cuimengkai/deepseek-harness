/**
 * Network-install store: one isolated npm project per plugin under
 * `$DSH_HOME/profiles/node_modules/.dsh-plugins/<slug>`, with one symlink into
 * the healed `profiles/node_modules` fallback per resolved module name. The
 * store's position under `profiles/` puts the installed plugin's peer imports
 * (notably `@deepseek-ai/cordis`) on the parent-walk that reaches the healed
 * fallback, so a network plugin shares the Host's single cordis instead of
 * pulling a duplicate.
 * @module @deepseek-ai/dsh-host-plugin-manager/store
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { InstalledPluginRecord } from './ledger.js'

/** Ceiling on one package-manager invocation; full-tree npm installs take time. */
const INSTALL_TIMEOUT_MS = 120_000

/**
 * Absolute root of the per-plugin store under an install prefix.
 * @param installPrefix - the plugin profile's install prefix.
 * @returns the absolute store root path.
 */
export function storeRoot(installPrefix: string): string {
  return join(installPrefix, 'node_modules', '.dsh-plugins')
}

/**
 * The per-plugin store directory name: the public name slugified.
 * @param name - the public plugin name.
 * @returns the slugified store directory name.
 */
export function storeSlug(name: string): string {
  return name.replace(/^@/, '').replace(/[^a-z0-9]/gi, '-').toLowerCase()
}

/**
 * Store paths for one public catalog name under an install prefix.
 * @param installPrefix - the plugin profile's install prefix.
 * @param name - the public catalog name.
 * @returns the store root and the plugin's slug directory under it.
 */
export function storePaths(installPrefix: string, name: string): { readonly storeRoot: string; readonly slugDir: string } {
  const root = storeRoot(installPrefix)
  return { storeRoot: root, slugDir: join(root, storeSlug(name)) }
}

/**
 * The npm install argument vector for one network install. Lifecycle scripts
 * are disabled by default and the cache is redirected inside the store so the
 * sandbox can write it and uninstall removes every trace; the caller turns
 * either off only for a trusted deployment and request.
 * @param spec - the install spec (a GitHub `user/repo`, registry spec, or tarball).
 * @param options - `ignoreScripts` appends `--ignore-scripts`; `cacheDir` (when
 * set) redirects npm's cache with `--cache` instead of the default `~/.npm`.
 * @returns the argument vector, ending with the spec.
 */
export function installArgv(
  spec: string,
  options: { readonly ignoreScripts: boolean; readonly cacheDir?: string },
): string[] {
  const argv = ['install', '--legacy-peer-deps', '--no-audit', '--no-fund']
  if (options.ignoreScripts) argv.push('--ignore-scripts')
  if (options.cacheDir !== undefined) argv.push('--cache', options.cacheDir)
  argv.push(spec)
  return argv
}

/** A completed package-manager invocation. */
export interface PackageManagerRun {
  readonly ok: boolean
  /** The child exit status, or `-1` when the spawn itself failed. */
  readonly status: number
  /** The last stderr lines, bounded for a result message. */
  readonly stderr: string
}

/**
 * Create the plugin store directory and its deterministic minimal manifest.
 * npm's project inference is layout-sensitive, so the store always owns an
 * explicit manifest before the package manager runs.
 * @param slugDir - the per-plugin store directory.
 */
export function ensureStoreDir(slugDir: string): void {
  mkdirSync(slugDir, { recursive: true })
  const manifestPath = join(slugDir, 'package.json')
  if (!existsSync(manifestPath)) {
    const slug = basename(slugDir)
    writeFileSync(manifestPath, JSON.stringify({ name: `dsh-plugin-store-${slug}`, private: true }, undefined, 2) + '\n')
  }
}

/**
 * Run the package manager inside one plugin store. The exported seam unit tests
 * stub; the default spawns with the scrubbed parent environment so
 * credential-shaped names never leak into the child.
 * @param executable - the package-manager binary from Config.
 * @param args - the argv vector.
 * @param options - the working directory (the plugin store).
 * @returns the run outcome.
 */
export function runPackageManager(
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string },
): PackageManagerRun {
  const result = spawnSync(executable, [...args], {
    cwd: options.cwd,
    env: scrubbedParentEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: INSTALL_TIMEOUT_MS,
  })
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  if (result.error !== undefined) {
    return { ok: false, status: -1, stderr: stderr !== '' ? stderrTail(stderr) : result.error.message }
  }
  return { ok: result.status === 0, status: result.status ?? -1, stderr: stderrTail(stderr) }
}

/** Bound a child's stderr to a diagnostic window. */
function stderrTail(stderr: string): string {
  const trimmed = stderr.trimEnd()
  return trimmed.length <= 2000 ? trimmed : trimmed.slice(-2000)
}

/**
 * The installed module name: npm saves exactly the installed package's real
 * name as the single dependency key of the store manifest. Anything else means
 * the install landed wrong (or the manifest was touched) and fails loud.
 * @param slugDir - the store directory.
 * @returns the resolved package name.
 */
export function discoverInstalledModuleName(slugDir: string): string {
  const manifest = JSON.parse(readFileSync(join(slugDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  const names = Object.keys(manifest.dependencies ?? {})
  const moduleName = names[0]
  if (names.length !== 1 || moduleName === undefined) {
    throw new Error(`store manifest after install lists ${names.length} dependency; expected exactly the installed module`)
  }
  if (!existsSync(join(slugDir, 'node_modules', moduleName))) {
    throw new Error(`installed module ${moduleName} is not present under the store node_modules`)
  }
  return moduleName
}

/**
 * The resolved version and npm integrity of one module from its store
 * lockfile. npm writes `packages["node_modules/<name>"]` with `.version` and
 * `.integrity` for a registry install. A missing lockfile or entry yields
 * `{ version: '', integrity: '' }` — never throws, so install never blocks on
 * provenance capture.
 * @param slugDir - the per-plugin store directory.
 * @param moduleName - the resolved package name.
 * @returns the lockfile version and integrity, `''` when unavailable.
 */
export function readInstalledIntegrity(
  slugDir: string,
  moduleName: string,
): { readonly version: string; readonly integrity: string } {
  let raw: string
  try {
    raw = readFileSync(join(slugDir, 'package-lock.json'), 'utf8')
  } catch {
    return { version: '', integrity: '' }
  }
  let lockfile: unknown
  try {
    lockfile = JSON.parse(raw)
  } catch {
    return { version: '', integrity: '' }
  }
  const packages = (lockfile as { packages?: Record<string, { version?: unknown; integrity?: unknown }> }).packages
  const entry = packages?.[`node_modules/${moduleName}`]
  if (entry === undefined) return { version: '', integrity: '' }
  return {
    version: typeof entry.version === 'string' ? entry.version : '',
    integrity: typeof entry.integrity === 'string' ? entry.integrity : '',
  }
}

/**
 * Re-read a store's lockfile integrity for one module and compare it against
 * the ledger record. Tamper detection: a lockfile entry that drifted from a
 * non-empty recorded integrity is `tampered`; a row recorded without integrity
 * (a pre-integrity install), a missing slug, or a store with no lockfile entry
 * to compare is `missing`, which is not an accusation.
 * @param record - the ledger row to verify.
 * @param installPrefix - the npm `--prefix` root holding the store.
 * @returns `ok` on a lockfile match, `tampered` on a drift, `missing` when no
 * integrity exists on either side to compare.
 */
export function verifyStoreIntegrity(
  record: InstalledPluginRecord,
  installPrefix: string,
): 'ok' | 'tampered' | 'missing' {
  if (record.integrity === '' || record.slug === '') return 'missing'
  const slugDir = join(storeRoot(installPrefix), record.slug)
  const { integrity } = readInstalledIntegrity(slugDir, record.moduleName)
  if (integrity === '') return 'missing'
  return integrity === record.integrity ? 'ok' : 'tampered'
}

/**
 * Point `profiles/node_modules/<moduleName>` at the store's installed copy. A
 * pre-existing real directory or a symlink to something else fails loud (the
 * healed fallback treats real directories as owned); an identical link is a
 * no-op so a re-install after cleanup is idempotent.
 * @param installPrefix - the npm `--prefix` root holding the fallback.
 * @param moduleName - the resolved package name.
 * @param slugDir - the store directory.
 */
export function ensureModuleSymlink(installPrefix: string, moduleName: string, slugDir: string): void {
  const target = join(slugDir, 'node_modules', moduleName)
  const link = join(installPrefix, 'node_modules', moduleName)
  mkdirSync(dirname(link), { recursive: true })
  let existing
  try {
    existing = lstatSync(link)
  } catch {
    existing = undefined
  }
  if (existing !== undefined) {
    if (!existing.isSymbolicLink() || readlinkSync(link) !== target) {
      throw new Error(`dsh plugin install: ${link} exists and is not the store symlink to ${target}`)
    }
    return
  }
  symlinkSync(target, link, 'junction')
}

/**
 * Remove the store symlink for one module. An absent link is success (idempotent
 * cleanup); a real directory occupying the link is not ours and fails loud.
 * @param installPrefix - the npm `--prefix` root holding the fallback.
 * @param moduleName - the resolved package name.
 */
export function removeModuleSymlink(installPrefix: string, moduleName: string): void {
  const link = join(installPrefix, 'node_modules', moduleName)
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    return
  }
  if (!stat.isSymbolicLink()) {
    throw new Error(`dsh plugin uninstall: ${link} is a real directory, refusing to remove it`)
  }
  unlinkSync(link)
}

/**
 * Remove a plugin store directory recursively after uninstall.
 * @param slugDir - the plugin's store directory to remove.
 */
export function removeStoreDir(slugDir: string): void {
  rmSync(slugDir, { recursive: true, force: true })
}
