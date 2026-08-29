/**
 * REAL-composition proof that live install/uninstall rides the running Host's
 * transactional config HMR: install appends a managed insert row to the home
 * patch and the watcher mounts the fiber without a restart; uninstall removes
 * the row and the watcher disposes the fiber — the registry-contribution
 * disposal proof the gateway itself cannot show (it owns no watcher). The
 * network case adds a real on-disk npm-style fixture that a stubbed package
 * manager writes into the store: the module is symlinked into the healed
 * `profiles/node_modules` fallback, imports `@deepseek-ai/cordis` through it
 * (peer-sharing), and the managed row's HMR recompose resolves it through real
 * Node ESM — mount and unmount observed through a provider the fixture sets.
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { boot, healProfilesModuleFallback, watchUserPatches } from '@deepseek-ai/dsh-app-boot'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { homePatchPath, managedEntryId, readHomePatchRows } from '../src/home-patch.ts'
import PluginManagerGateway from '../src/index.ts'
import { readLedger } from '../src/ledger.ts'
import { storePaths, storeSlug } from '../src/store.ts'

const { runPackageManagerMock } = vi.hoisted(() => ({ runPackageManagerMock: vi.fn() }))
vi.mock('../src/store.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/store.ts')>()
  return { ...actual, runPackageManager: runPackageManagerMock }
})

const NAME = 'dsh-test-plugin-manager'
const NET_NAME = '@fixture/net-ping'
const MANIFEST_URL = 'https://example.test/plugins.json'
const INSTALL_REF = 'https://example.test/net-ping.tgz'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
  delete process.env.DSH_HOME
})

/** Fixture module that proves mount through a provider visible on the root ctx. */
const PingFixture = {
  name: '@fixture/ping',
  apply: (ctx: Context): void => {
    ctx.provide('pingMarker', true)
  },
}

/** Fixture module standing in for a shipped spine row in the composition. */
const BundledFixture = {
  name: '@fixture/bundled',
  apply: (ctx: Context): void => {
    ctx.provide('bundledMarker', true)
  },
}

/** Source of the on-disk network fixture: imports cordis from the fallback. */
const NET_PING_SOURCE = [
  "import { Context } from '@deepseek-ai/cordis'",
  '',
  "export const name = '@fixture/net-ping'",
  '',
  'export function apply(ctx) {',
  "  ctx.provide('netPingMarker', true)",
  '}',
  '',
].join('\n')

async function eventually(test: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Route fixture bare names through `modules` while keeping the real Node
 * ModuleLoader intact (HMR reads its loadCache/version/resolveSync), so a
 * fixture can live under /tmp without breaking the HMR service. */
function routeModules(modules: ReadonlyMap<string, unknown>): (ctx: Context) => void {
  return (ctx: Context): void => {
    const real = ctx.loader.internal
    const routedImport = async (specifier: string, parentURL: string, attrs: unknown): Promise<unknown> => {
      if (modules.has(specifier)) return modules.get(specifier)
      if (real === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return real.import(specifier, parentURL, attrs as never)
    }
    if (real === undefined) {
      ctx.loader.internal = { version: 'v2', import: routedImport } as unknown as NonNullable<typeof ctx.loader.internal>
      return
    }
    ctx.loader.internal = new Proxy(real, {
      get(target, prop): unknown {
        if (prop === 'import') return routedImport
        const value: unknown = Reflect.get(target, prop)
        if (typeof value === 'function') return (value as (...args: unknown[]) => unknown).bind(target)
        return value
      },
    })
  }
}

/** A package-manager run that writes the installed network fixture like npm would,
 * including the cache redirect inside the store and the lockfile entry the
 * integrity ledger reads. */
function writeNetPingStore(cwd: string): void {
  const moduleDir = join(cwd, 'node_modules', NET_NAME)
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({ name: NET_NAME, version: '1.0.0', main: 'index.mjs' }))
  writeFileSync(join(moduleDir, 'index.mjs'), NET_PING_SOURCE)
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ ...manifest, dependencies: { [NET_NAME]: '1.0.0' } }))
  // The npm cache redirect lands inside the store; uninstall removes it with it.
  mkdirSync(join(cwd, '.npm-cache'), { recursive: true })
  writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: manifest.name, dependencies: { [NET_NAME]: '1.0.0' } },
      [`node_modules/${NET_NAME}`]: { version: '1.0.0', integrity: 'sha512-testintegrity' },
    },
  }))
}

describe('live plugin install through a real Loader composition', () => {
  it('mounts an installed module via home-patch HMR and unmounts it on uninstall', { timeout: 20_000 }, async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-loader-'))
    process.env.DSH_HOME = root
    writeFileSync(join(root, 'cordis.yml'), [
      '- id: plugin-manager',
      "  name: '@deepseek-ai/dsh-host-plugin-manager'",
      '  config:',
      '    catalog:',
      "      - name: '@fixture/ping'",
      '        description: Ping the fixture',
      '',
    ].join('\n'))

    const ctx = await boot(NAME, join(root, 'cordis.yml'), [], routeModules(new Map([
      ['@deepseek-ai/dsh-host-plugin-manager', PluginManagerGateway],
      ['@fixture/ping', PingFixture],
    ])))
    contexts.push(ctx)
    const manager = ctx.get('pluginManager') as PluginManagerGateway
    expect(manager).toBeDefined()
    expect(ctx.get('pingMarker')).toBeUndefined()

    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const dispose = await watchUserPatches(ctx, {
      binName: NAME,
      filename: homePatchPath(),
      compose: patches => patches,
    })
    try {
      const install = await manager.install({ name: '@fixture/ping', confirmed: true })
      if (!install.ok) throw new Error(`expected install success, got ${install.error.code}`)
      expect(readHomePatchRows()).toEqual([
        { insert: [{ id: managedEntryId('@fixture/ping'), name: '@fixture/ping' }] },
      ])
      await eventually(() => ctx.get('pingMarker') === true, 'installed plugin was not mounted through HMR')
      expect((await manager.listAvailable()).entries[0]?.installed).toBe(true)

      const uninstall = await manager.uninstall({ name: '@fixture/ping' })
      if (!uninstall.ok) throw new Error(`expected uninstall success, got ${uninstall.error.code}`)
      expect(readHomePatchRows()).toEqual([])
      await eventually(() => ctx.get('pingMarker') === undefined, 'uninstalled plugin was not unmounted through HMR')
      expect((await manager.listAvailable()).entries[0]?.installed).toBe(false)
    } finally {
      await dispose()
    }
  })
})

describe('network install through a real Loader composition', () => {
  it('mounts a store-installed fixture via HMR and unmounts it on uninstall', { timeout: 20_000 }, async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-net-loader-'))
    process.env.DSH_HOME = root
    // The config lives in a profile dir so Node's parent walk from the config
    // reaches the healed `profiles/node_modules` fallback the install writes to.
    const profileDir = join(root, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'cordis.yml'), [
      '- id: plugin-manager',
      "  name: '@deepseek-ai/dsh-host-plugin-manager'",
      '  config:',
      '    sources:',
      '      - id: market',
      '        kind: manifest',
      `        url: '${MANIFEST_URL}'`,
      // Routing REAL test: confirmation and the sandbox seam get their own
      // deterministic variants; here the package-manager seam is mocked.
      '    requireInstallConfirmation: false',
      '    installSandbox: false',
      '',
    ].join('\n'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { name: NET_NAME, ref: INSTALL_REF, installable: true },
    ]))))
    // The gateway's package.json is the app manifest whose dependency closure
    // (including the cordis peer) is symlinked into the profiles fallback.
    await healProfilesModuleFallback({ installAnchor: fileURLToPath(new URL('../package.json', import.meta.url)), home: root })

    const ctx = await boot(NAME, join(profileDir, 'cordis.yml'), [], routeModules(new Map([
      ['@deepseek-ai/dsh-host-plugin-manager', PluginManagerGateway],
    ])))
    contexts.push(ctx)
    const manager = ctx.get('pluginManager') as PluginManagerGateway
    expect(ctx.get('netPingMarker')).toBeUndefined()

    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const dispose = await watchUserPatches(ctx, {
      binName: NAME,
      filename: homePatchPath(),
      compose: patches => patches,
    })
    try {
      runPackageManagerMock.mockImplementation((_executable: string, _args: readonly string[], options: { readonly cwd: string }) => {
        writeNetPingStore(options.cwd)
        return { ok: true, status: 0, stderr: '' }
      })

      const install = await manager.install({ name: NET_NAME, confirmed: true })
      if (!install.ok) throw new Error(`expected install success, got ${install.error.code}`)
      // The managed row names the resolved module for HMR; the ledger records
      // provenance (including the lockfile version and integrity); the store
      // module is symlinked into the healed fallback.
      expect(readHomePatchRows()).toEqual([
        { insert: [{ id: managedEntryId(NET_NAME), name: NET_NAME }] },
      ])
      expect(readLedger().get(NET_NAME)).toMatchObject({
        moduleName: NET_NAME,
        slug: storeSlug(NET_NAME),
        installRef: INSTALL_REF,
        source: 'market',
        version: '1.0.0',
        integrity: 'sha512-testintegrity',
      })
      const { slugDir } = storePaths(join(root, 'profiles'), NET_NAME)
      const link = join(root, 'profiles', 'node_modules', NET_NAME)
      expect(lstatSync(link).isSymbolicLink()).toBe(true)
      expect(readlinkSync(link)).toBe(join(slugDir, 'node_modules', NET_NAME))
      // Real Node ESM resolves the module through the symlink, its cordis import
      // through the healed fallback, and HMR mounts the fixture.
      await eventually(() => ctx.get('netPingMarker') === true, 'network-installed plugin was not mounted through HMR')
      expect((await manager.listAvailable()).entries[0]?.installed).toBe(true)

      const uninstall = await manager.uninstall({ name: NET_NAME })
      if (!uninstall.ok) throw new Error(`expected uninstall success, got ${uninstall.error.code}`)
      expect(readHomePatchRows()).toEqual([])
      await eventually(() => ctx.get('netPingMarker') === undefined, 'network-installed plugin was not unmounted through HMR')
      expect(readLedger()).toEqual(new Map())
      expect(existsSync(slugDir)).toBe(false)
      expect(existsSync(join(slugDir, '.npm-cache'))).toBe(false)
      expect(existsSync(link)).toBe(false)
    } finally {
      await dispose()
    }
  })
})

describe('network install under the sandbox through a real Loader composition', () => {
  it('confines the package manager through the base sandbox-local provider', { timeout: 20_000 }, async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-net-sandbox-'))
    process.env.DSH_HOME = root
    const profileDir = join(root, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'cordis.yml'), [
      '- id: sandbox',
      "  name: '@deepseek-ai/dsh-sandbox-local'",
      '- id: plugin-manager',
      "  name: '@deepseek-ai/dsh-host-plugin-manager'",
      '  config:',
      '    sources:',
      '      - id: market',
      '        kind: manifest',
      `        url: '${MANIFEST_URL}'`,
      // The sandbox seam stays on; only the confirmation is disabled so the
      // test exercises the confined install without a UI.
      '    requireInstallConfirmation: false',
      '',
    ].join('\n'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { name: NET_NAME, ref: INSTALL_REF, installable: true },
    ]))))
    await healProfilesModuleFallback({ installAnchor: fileURLToPath(new URL('../package.json', import.meta.url)), home: root })

    const ctx = await boot(NAME, join(profileDir, 'cordis.yml'), [], routeModules(new Map<string, unknown>([
      ['@deepseek-ai/dsh-sandbox-local', LocalSandboxProvider],
      ['@deepseek-ai/dsh-host-plugin-manager', PluginManagerGateway],
    ])))
    contexts.push(ctx)
    const manager = ctx.get('pluginManager') as PluginManagerGateway
    // The base profile mounts the real sandbox-local provider; pin its runner
    // chain so confine wraps without probing the real host runners.
    const sandbox = ctx.get('sandbox')
    if (!(sandbox instanceof LocalSandboxProvider)) {
      throw new Error(`expected LocalSandboxProvider, got ${sandbox?.constructor.name}`)
    }
    sandbox.internals = { chain: ['seatbelt'] }

    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const dispose = await watchUserPatches(ctx, {
      binName: NAME,
      filename: homePatchPath(),
      compose: patches => patches,
    })
    try {
      runPackageManagerMock.mockImplementation((executable: string, args: readonly string[], options: { readonly cwd: string }) => {
        // The confined argv wraps the package manager under `sandbox-exec`.
        expect(executable).toBe('sandbox-exec')
        expect(args.at(-1)).toBe(INSTALL_REF)
        expect(args).toContain('--ignore-scripts')
        writeNetPingStore(options.cwd)
        return { ok: true, status: 0, stderr: '' }
      })

      const install = await manager.install({ name: NET_NAME, confirmed: true })
      if (!install.ok) throw new Error(`expected install success, got ${install.error.code}`)
      // The snapshot advertises the confined install surface through the real provider.
      expect((await manager.listAvailable()).capabilities.installSandbox).toBe('confined')
      await eventually(() => ctx.get('netPingMarker') === true, 'sandbox-installed plugin was not mounted through HMR')
    } finally {
      await dispose()
    }
  })
})

describe('bundled spine uninstall through a real Loader composition', () => {
  it('disables a bundled fixture via a persisted override and re-enables it on reinstall', { timeout: 20_000 }, async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-bundled-loader-'))
    process.env.DSH_HOME = root
    // The catalog must not list the bundled module, or install would route to
    // the managed-row path instead of the bundled reinstall path.
    writeFileSync(join(root, 'cordis.yml'), [
      '- id: plugin-manager',
      "  name: '@deepseek-ai/dsh-host-plugin-manager'",
      '  config:',
      '    catalog:',
      "      - name: '@fixture/other'",
      '        description: Another fixture',
      '',
      '- id: bundled',
      "  name: '@fixture/bundled'",
      '',
    ].join('\n'))

    const ctx = await boot(NAME, join(root, 'cordis.yml'), [], routeModules(new Map([
      ['@deepseek-ai/dsh-host-plugin-manager', PluginManagerGateway],
      ['@fixture/bundled', BundledFixture],
    ])))
    contexts.push(ctx)
    const manager = ctx.get('pluginManager') as PluginManagerGateway
    expect(ctx.get('bundledMarker')).toBe(true)

    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const dispose = await watchUserPatches(ctx, {
      binName: NAME,
      filename: homePatchPath(),
      compose: patches => patches,
    })
    try {
      const uninstall = await manager.uninstall({ name: '@fixture/bundled' })
      if (!uninstall.ok) throw new Error(`expected uninstall success, got ${uninstall.error.code}`)
      expect(readHomePatchRows()).toEqual([{ id: 'bundled', disabled: true }])
      await eventually(() => ctx.get('bundledMarker') === undefined, 'bundled plugin was not unmounted through HMR')

      const reinstall = await manager.install({ name: '@fixture/bundled', confirmed: true })
      if (!reinstall.ok) throw new Error(`expected reinstall success, got ${reinstall.error.code}`)
      expect(readHomePatchRows()).toEqual([{ id: 'bundled', disabled: false }])
      await eventually(() => ctx.get('bundledMarker') === true, 'bundled plugin was not remounted through HMR')
    } finally {
      await dispose()
    }
  })
})

describe('plugin-manager runtime-base guard', () => {
  it('refuses to uninstall the plugin-manager itself with in-use', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-guard-'))
    process.env.DSH_HOME = root
    writeFileSync(join(root, 'cordis.yml'), [
      '- id: plugin-manager',
      "  name: '@deepseek-ai/dsh-host-plugin-manager'",
      '',
    ].join('\n'))

    const ctx = await boot(NAME, join(root, 'cordis.yml'), [], routeModules(new Map([
      ['@deepseek-ai/dsh-host-plugin-manager', PluginManagerGateway],
    ])))
    contexts.push(ctx)
    const manager = ctx.get('pluginManager') as PluginManagerGateway

    const uninstall = await manager.uninstall({ name: '@deepseek-ai/dsh-host-plugin-manager' })
    expect(uninstall.ok).toBe(false)
    if (uninstall.ok) throw new Error('expected in-use rejection')
    expect(uninstall.error).toEqual({
      code: 'in-use',
      name: '@deepseek-ai/dsh-host-plugin-manager',
    })
    // Nothing was written; the runtime base stays mounted.
    expect(readHomePatchRows()).toEqual([])
  })
})
