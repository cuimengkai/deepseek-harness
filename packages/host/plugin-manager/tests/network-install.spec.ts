/**
 * Network install/uninstall behavior through the gateway: a manifest source
 * supplies a network entry, the package-manager seam is stubbed to write a real
 * module into the store, and the install lands a ledger row plus a managed
 * home-patch row, symlinks the module into the healed fallback, and uninstall
 * reverses all of it. Rejection paths (not-found, offline, install-failed,
 * already-installed on collision, not-managed take-over, remove-failed) are
 * asserted against the home patch, ledger, store, and symlink. Every mutation
 * runs against a private temp $DSH_HOME; nothing touches the network.
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SandboxProvider, type ConfinedArgv } from '@deepseek-ai/dsh-sandbox'
import { managedEntryId, readHomePatchRows, updateHomePatch } from '../src/home-patch.ts'
import PluginManagerGateway from '../src/index.ts'
import { readLedger } from '../src/ledger.ts'
import { storePaths, storeSlug, verifyStoreIntegrity, type PackageManagerRun } from '../src/store.ts'

const { runPackageManagerMock } = vi.hoisted(() => ({ runPackageManagerMock: vi.fn() }))
vi.mock('../src/store.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/store.ts')>()
  return { ...actual, runPackageManager: runPackageManagerMock }
})

const NET_NAME = '@fixture/net-ping'
const INSTALL_REF = 'https://example.test/net-ping.tgz'
const MANIFEST_URL = 'https://example.test/plugins.json'

const contexts: Context[] = []
let home: string | undefined

beforeEach(() => {
  runPackageManagerMock.mockReset()
})

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
  delete process.env.DSH_HOME
})

function tempHome(): void {
  home = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-net-'))
  process.env.DSH_HOME = home
}

/** Stub global fetch so the manifest source resolves to one network entry. */
function stubManifest(entries: unknown[] = [{ name: NET_NAME, ref: INSTALL_REF, installable: true }]): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(entries))))
}

/** A package-manager run that writes the installed module like npm would,
 * including the lockfile entry the integrity ledger reads. */
function writeInstalledModule(
  moduleName: string,
  version = '1.0.0',
  integrity = 'sha512-testintegrity',
): (executable: string, args: readonly string[], options: { readonly cwd: string }) => PackageManagerRun {
  return (_executable, _args, options) => {
    const installedDir = join(options.cwd, 'node_modules', moduleName)
    mkdirSync(installedDir, { recursive: true })
    writeFileSync(join(installedDir, 'package.json'), JSON.stringify({ name: moduleName, version }))
    const manifestPath = join(options.cwd, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, dependencies: { [moduleName]: version } }))
    writeFileSync(join(options.cwd, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: manifest.name, dependencies: { [moduleName]: version } },
        [`node_modules/${moduleName}`]: { version, integrity },
      },
    }))
    return { ok: true, status: 0, stderr: '' }
  }
}

/** A recording fake `ctx.sandbox`: passes the caller's argv through unchanged
 * and records each confine policy. Cordis instantiates it with the ctx. */
class RecordingSandbox extends SandboxProvider {
  readonly confines: { readonly argv: readonly string[]; readonly policy: { readonly mode: string; readonly workspaceRoot: string } }[] = []
  confine(argv: readonly string[], policy: { readonly mode: string; readonly workspaceRoot: string }): ConfinedArgv {
    this.confines.push({ argv: [...argv], policy })
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

async function harness(
  config: Record<string, unknown> = {},
  sandbox?: new (ctx: Context) => SandboxProvider,
): Promise<{ ctx: Context; manager: PluginManagerGateway }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string): Promise<unknown> {
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  if (sandbox !== undefined) await ctx.plugin(sandbox)
  await ctx.plugin(PluginManagerGateway, config)
  const manager = ctx.get('pluginManager') as PluginManagerGateway
  return { ctx, manager }
}

/** The default manifest-source config used by most tests. Routing tests run
 * unconfined (`installSandbox: false`); the sandbox-specific tests opt in. */
function netConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { sources: [{ id: 'market', kind: 'manifest', url: MANIFEST_URL }], installSandbox: false, ...extra }
}

describe('network install', () => {
  it('installs through the package manager and commits the store, ledger, and managed row', async () => {
    tempHome()
    stubManifest()
    runPackageManagerMock.mockImplementation(writeInstalledModule(NET_NAME))
    const { manager } = await harness(netConfig())

    const result = await manager.install({ name: NET_NAME, confirmed: true })
    expect(result).toEqual({
      ok: true,
      value: { entryId: managedEntryId(NET_NAME), moduleName: NET_NAME, phase: null },
    })
    // The package manager ran with the store as cwd, lifecycle scripts disabled
    // by default, the npm cache redirected inside the store, and the tarball spec.
    const slugDir = join(home!, 'profiles', 'node_modules', '.dsh-plugins', storeSlug(NET_NAME))
    expect(runPackageManagerMock).toHaveBeenCalledWith(
      'npm',
      ['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--ignore-scripts', '--cache', join(slugDir, '.npm-cache'), INSTALL_REF],
      { cwd: slugDir },
    )
    // Ledger records provenance under the public name, including the resolved
    // version and integrity read from the store lockfile.
    expect(readLedger().get(NET_NAME)).toMatchObject({
      moduleName: NET_NAME,
      slug: storeSlug(NET_NAME),
      installRef: INSTALL_REF,
      source: 'market',
      version: '1.0.0',
      integrity: 'sha512-testintegrity',
    })
    // The managed row names the resolved module for HMR.
    expect(readHomePatchRows()).toEqual([{ insert: [{ id: managedEntryId(NET_NAME), name: NET_NAME }] }])
    // The store module is symlinked into the healed fallback.
    const { slugDir: storeDir } = storePaths(join(home!, 'profiles'), NET_NAME)
    const link = join(home!, 'profiles', 'node_modules', NET_NAME)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(join(storeDir, 'node_modules', NET_NAME))
    expect((await manager.listAvailable()).entries[0]).toMatchObject({ installed: true, integrityStatus: 'ok' })
  })

  it('rejects a name absent from every source as not-found', async () => {
    tempHome()
    stubManifest()
    const { manager } = await harness(netConfig())
    expect(await manager.install({ name: 'unknown/plugin', confirmed: true })).toEqual({
      ok: false,
      error: { code: 'not-found', name: 'unknown/plugin' },
    })
    expect(runPackageManagerMock).not.toHaveBeenCalled()
  })

  it('rejects a network install in offline mode without running the package manager', async () => {
    tempHome()
    stubManifest()
    // Prime the source cache with an online refresh so offline mode still sees
    // the entry and reports `offline` rather than `not-found` (offline serves
    // only cached and static entries).
    const online = await harness(netConfig())
    await online.manager.refreshCatalog()
    const { manager } = await harness(netConfig({ offline: true }))
    expect(await manager.install({ name: NET_NAME, confirmed: true })).toEqual({
      ok: false,
      error: { code: 'offline', name: NET_NAME },
    })
    expect(runPackageManagerMock).not.toHaveBeenCalled()
  })

  it('rolls the store back when the package manager fails', async () => {
    tempHome()
    stubManifest()
    runPackageManagerMock.mockReturnValue({ ok: false, status: 1, stderr: 'npm ERR! 404' })
    const { manager } = await harness(netConfig())
    const result = await manager.install({ name: NET_NAME, confirmed: true })
    expect(result).toEqual({
      ok: false,
      error: { code: 'install-failed', name: NET_NAME, message: 'npm ERR! 404' },
    })
    expect(readHomePatchRows()).toEqual([])
    expect(readLedger()).toEqual(new Map())
    const { slugDir } = storePaths(join(home!, 'profiles'), NET_NAME)
    expect(existsSync(slugDir)).toBe(false)
    expect(existsSync(join(home!, 'profiles', 'node_modules', NET_NAME))).toBe(false)
  })

  it('reports a collision with a managed resolved module as already-installed', async () => {
    tempHome()
    // The catalog name and the installed package name differ, so the pre-check
    // passes and the collision is discovered only after the package manager ran.
    stubManifest([{ name: 'net-ping', ref: INSTALL_REF, installable: true }])
    runPackageManagerMock.mockImplementation(writeInstalledModule(NET_NAME))
    const { ctx, manager } = await harness(netConfig())
    // The Loader resolves the fixture module so the composed-name collision is
    // reachable: `@fixture/net-ping` is already mounted.
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string): Promise<unknown> {
        if (specifier === NET_NAME) return { name: NET_NAME, apply() {} }
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: NET_NAME })
    const result = await manager.install({ name: 'net-ping', confirmed: true })
    expect(result).toEqual({
      ok: false,
      error: { code: 'already-installed', name: 'net-ping', message: `resolves to the managed module ${NET_NAME}` },
    })
    expect(readHomePatchRows()).toEqual([])
    expect(readLedger()).toEqual(new Map())
  })

  it('refuses a network install without explicit trust confirmation', async () => {
    tempHome()
    stubManifest()
    const { manager } = await harness(netConfig())
    expect(await manager.install({ name: NET_NAME, confirmed: false })).toEqual({
      ok: false,
      error: { code: 'confirmation-required', name: NET_NAME },
    })
    // The package manager never ran and nothing was committed.
    expect(runPackageManagerMock).not.toHaveBeenCalled()
    expect(readHomePatchRows()).toEqual([])
    expect(readLedger()).toEqual(new Map())
  })

  it('refuses a network install when sandboxing is enabled but no backend is usable', async () => {
    tempHome()
    stubManifest()
    const { manager } = await harness(netConfig({ installSandbox: true }))
    expect(await manager.install({ name: NET_NAME, confirmed: true })).toEqual({
      ok: false,
      error: { code: 'sandbox-unavailable', name: NET_NAME },
    })
    // npm never ran unconfined, and the refused attempt rolled its store back.
    expect(runPackageManagerMock).not.toHaveBeenCalled()
    const { slugDir } = storePaths(join(home!, 'profiles'), NET_NAME)
    expect(existsSync(slugDir)).toBe(false)
    expect(readLedger()).toEqual(new Map())
  })

  it('confines the package-manager invocation under a workspace-write sandbox', async () => {
    tempHome()
    stubManifest()
    runPackageManagerMock.mockImplementation(writeInstalledModule(NET_NAME))
    const { ctx, manager } = await harness(netConfig({ installSandbox: true }), RecordingSandbox)
    const sandbox = ctx.get('sandbox') as RecordingSandbox
    const result = await manager.install({ name: NET_NAME, confirmed: true })
    expect(result.ok).toBe(true)
    // The provider saw exactly one workspace-write confine around the store.
    expect(sandbox.confines).toHaveLength(1)
    const { slugDir } = storePaths(join(home!, 'profiles'), NET_NAME)
    expect(sandbox.confines[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: slugDir })
    // The confined argv (a passthrough here) is exactly what ran.
    expect(runPackageManagerMock).toHaveBeenCalledWith(
      'npm',
      ['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--ignore-scripts', '--cache', join(slugDir, '.npm-cache'), INSTALL_REF],
      { cwd: slugDir },
    )
  })

  it('records the resolved version and integrity and reports drift as tampered', async () => {
    tempHome()
    stubManifest()
    runPackageManagerMock.mockImplementation(writeInstalledModule(NET_NAME))
    const { manager } = await harness(netConfig())
    const result = await manager.install({ name: NET_NAME, confirmed: true })
    expect(result.ok).toBe(true)
    const record = readLedger().get(NET_NAME)
    expect(record).toMatchObject({ version: '1.0.0', integrity: 'sha512-testintegrity' })
    expect((await manager.listAvailable()).entries[0]).toMatchObject({
      version: '1.0.0',
      integrity: 'sha512-testintegrity',
      integrityStatus: 'ok',
    })
    // Drift the lockfile; the re-verification flips to tampered on the wire.
    const { slugDir } = storePaths(join(home!, 'profiles'), NET_NAME)
    const lock = JSON.parse(readFileSync(join(slugDir, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { integrity: string }>
    }
    lock.packages[`node_modules/${NET_NAME}`]!.integrity = 'sha512-different'
    writeFileSync(join(slugDir, 'package-lock.json'), JSON.stringify(lock))
    expect(verifyStoreIntegrity(record!, join(home!, 'profiles'))).toBe('tampered')
    expect((await manager.listAvailable()).entries[0]).toMatchObject({ integrityStatus: 'tampered' })
  })
})

describe('network uninstall', () => {
  async function installedHarness(): Promise<{ manager: PluginManagerGateway }> {
    tempHome()
    stubManifest()
    runPackageManagerMock.mockImplementation(writeInstalledModule(NET_NAME))
    const { manager } = await harness(netConfig())
    const result = await manager.install({ name: NET_NAME, confirmed: true })
    if (!result.ok) throw new Error(`expected install success, got ${result.error.code}`)
    return { manager }
  }

  it('removes the managed row, symlink, store, and ledger entry', async () => {
    const { manager } = await installedHarness()
    expect(await manager.uninstall({ name: NET_NAME })).toEqual({ ok: true, value: { absent: true } })
    expect(readHomePatchRows()).toEqual([])
    expect(readLedger()).toEqual(new Map())
    const { slugDir } = storePaths(join(home!, 'profiles'), NET_NAME)
    expect(existsSync(slugDir)).toBe(false)
    expect(existsSync(join(home!, 'profiles', 'node_modules', NET_NAME))).toBe(false)
    expect((await manager.listAvailable()).entries[0]?.installed).toBe(false)
  })

  it('keeps the store and ledger when the user takes over the managed row', async () => {
    const { manager } = await installedHarness()
    await updateHomePatch(_rows => ({ applied: true, rows: [{ name: NET_NAME }] }))
    expect(await manager.uninstall({ name: NET_NAME })).toEqual({
      ok: false,
      error: { code: 'not-managed', name: NET_NAME },
    })
    expect(readLedger().get(NET_NAME)?.moduleName).toBe(NET_NAME)
    const { slugDir } = storePaths(join(home!, 'profiles'), NET_NAME)
    expect(existsSync(slugDir)).toBe(true)
  })

  it('reports remove-failed when the symlink cleanup refuses a real directory', async () => {
    const { manager } = await installedHarness()
    // Replace the store symlink with a real directory so cleanup refuses it.
    const link = join(home!, 'profiles', 'node_modules', NET_NAME)
    unlinkSync(link)
    mkdirSync(link)
    expect(await manager.uninstall({ name: NET_NAME })).toEqual({
      ok: false,
      error: { code: 'remove-failed', name: NET_NAME },
    })
    // The managed row is already gone, so a retry after the user fixes the
    // directory cleans the orphan store and ledger.
    expect(readHomePatchRows()).toEqual([])
  })

  it('still removes a drifted store in full on uninstall', async () => {
    const { manager } = await installedHarness()
    const { slugDir } = storePaths(join(home!, 'profiles'), NET_NAME)
    const lock = JSON.parse(readFileSync(join(slugDir, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { integrity: string }>
    }
    lock.packages[`node_modules/${NET_NAME}`]!.integrity = 'sha512-different'
    writeFileSync(join(slugDir, 'package-lock.json'), JSON.stringify(lock))
    expect(await manager.uninstall({ name: NET_NAME })).toEqual({ ok: true, value: { absent: true } })
    // A possibly-compromised plugin is removed in full: store, symlink, ledger.
    expect(existsSync(slugDir)).toBe(false)
    expect(existsSync(join(home!, 'profiles', 'node_modules', NET_NAME))).toBe(false)
    expect(readLedger()).toEqual(new Map())
  })
})
