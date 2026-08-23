/**
 * PluginManagerGateway unit behavior: Remote surface, catalog projection, and
 * the home-patch install/uninstall decisions, including the closed
 * double-insert window. Every mutation runs against a private temp $DSH_HOME.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { homePatchPath, managedEntryId, readHomePatchRows, updateHomePatch } from '../src/home-patch.ts'
import PluginManagerGateway from '../src/index.ts'
import type { PluginManagerInstallResult } from '../src/types.ts'

const contexts: Context[] = []
let home: string | undefined

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
  delete process.env.DSH_HOME
})

/** Fixture catalog: one described entry and one bare entry. */
const CATALOG = [
  { name: '@fixture/ping', description: 'Ping the fixture' },
  { name: '@fixture/plain' },
]

/** Fixture module mounted through the Loader for composed-tree checks. */
const PingFixture = {
  name: '@fixture/ping',
  apply: (ctx: Context): void => {
    ctx.provide('pingMarker', true)
  },
}

async function harness(): Promise<{ ctx: Context; manager: PluginManagerGateway }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier !== '@fixture/ping') throw new Error(`unexpected Loader import: ${specifier}`)
      return PingFixture
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(PluginManagerGateway, { catalog: CATALOG })
  const manager = ctx.get('pluginManager') as PluginManagerGateway
  return { ctx, manager }
}

/** Point home-patch writes at a fresh private temp home for this test. */
function tempHome(): void {
  home = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-spec-'))
  process.env.DSH_HOME = home
}

describe('PluginManagerGateway', () => {
  it('publishes four direct Remote methods under the pluginManager namespace', async () => {
    const { manager } = await harness()
    expect(manager.typertRemote).toMatchObject({
      serviceKey: 'pluginManager',
      namespace: 'pluginManager',
    })
    expect(remoteMethods(manager)).toEqual([
      { method: 'listAvailable', invocation: { kind: 'direct' } },
      { method: 'refreshCatalog', invocation: { kind: 'direct' } },
      // The wire names diverge from the host methods so they avoid the client
      // RemoteNamespaceService's reserved `install`/`uninstall` members.
      { method: 'install', exportName: 'installPlugin', invocation: { kind: 'direct' } },
      { method: 'uninstall', exportName: 'uninstallPlugin', invocation: { kind: 'direct' } },
    ])
  })

  it('defaults an empty config to the awesome + topic sources', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    tempHome()
    await ctx.plugin(Loader)
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.plugin(PluginManagerGateway, { offline: true })
    const manager = ctx.get('pluginManager') as PluginManagerGateway
    expect(await manager.listAvailable()).toEqual({
      entries: [],
      sources: [
        { id: 'awesome', kind: 'awesome', state: 'offline', entryCount: 0 },
        { id: 'topic', kind: 'topic', state: 'offline', entryCount: 0 },
      ],
      capabilities: { networkConfirmation: true, allowInstallScripts: false, installSandbox: 'unavailable' },
    })
  })

  it('projects the curated catalog with every entry uninstalled', async () => {
    const { manager } = await harness()
    tempHome()
    expect(await manager.listAvailable()).toEqual({
      entries: [
        {
          name: '@fixture/ping',
          description: 'Ping the fixture',
          source: 'catalog',
          installKind: 'static',
          installable: true,
          installed: false,
        },
        { name: '@fixture/plain', source: 'catalog', installKind: 'static', installable: true, installed: false },
      ],
      sources: [{ id: 'catalog', kind: 'static', state: 'ok', entryCount: 2 }],
      capabilities: { networkConfirmation: true, allowInstallScripts: false, installSandbox: 'unavailable' },
    })
  })

  it('reports a catalog entry installed once the composed tree mounts it', async () => {
    const { ctx, manager } = await harness()
    tempHome()
    await ctx.loader.create({ name: '@fixture/ping' })
    expect((await manager.listAvailable()).entries[0]!.installed).toBe(true)
  })

  it('reports a catalog entry installed once the user home patch declares it', async () => {
    const { manager } = await harness()
    tempHome()
    await manager.install({ name: '@fixture/plain', confirmed: true })
    expect((await manager.listAvailable()).entries[1]!.installed).toBe(true)
  })

  it('rejects invalid names before touching the home patch', async () => {
    const { manager } = await harness()
    tempHome()
    for (const bad of ['', '   ', 'foo:bar', 'cordis:x', '.relative', 'a b']) {
      expect(await manager.install({ name: bad, confirmed: true })).toEqual({ ok: false, error: { code: 'invalid-name', name: bad } })
    }
    expect(() => readFileSync(homePatchPath(), 'utf8')).toThrow()
  })

  it('refuses to install a module already mounted in the composed tree', async () => {
    const { ctx, manager } = await harness()
    tempHome()
    await ctx.loader.create({ name: '@fixture/ping' })
    expect(await manager.install({ name: '@fixture/ping', confirmed: true })).toEqual({
      ok: false,
      error: { code: 'already-installed', name: '@fixture/ping' },
    })
    expect(() => readFileSync(homePatchPath(), 'utf8')).toThrow()
  })

  it('installs by committing one private managed insert row to the home patch', async () => {
    const { manager } = await harness()
    tempHome()
    const entryId = managedEntryId('@fixture/plain')
    const result = await manager.install({ name: '@fixture/plain', confirmed: true })
    expect(result).toEqual({ ok: true, value: { entryId, moduleName: '@fixture/plain', phase: null } })
    expect(readHomePatchRows()).toEqual([{ insert: [{ id: entryId, name: '@fixture/plain' }] }])
    expect(statSync(homePatchPath()).mode & 0o777).toBe(0o600)
  })

  it('closes the double-insert window for racing installs', async () => {
    const { manager } = await harness()
    tempHome()
    const [a, b] = await Promise.all([
      manager.install({ name: '@fixture/plain', confirmed: true }),
      manager.install({ name: '@fixture/plain', confirmed: true }),
    ])
    const successes: PluginManagerInstallResult[] = []
    const rejections: PluginManagerInstallResult[] = []
    for (const result of [a, b]) {
      if (result.ok) successes.push(result)
      else rejections.push(result)
    }
    expect(successes).toHaveLength(1)
    expect(rejections).toHaveLength(1)
    const rejected = rejections[0]!
    if (!rejected.ok) expect(rejected.error).toEqual({ code: 'already-installed', name: '@fixture/plain' })
    expect(readHomePatchRows()).toHaveLength(1)
  })

  it('refuses a second install of a module the home patch already manages', async () => {
    const { manager } = await harness()
    tempHome()
    await manager.install({ name: '@fixture/plain', confirmed: true })
    expect(await manager.install({ name: '@fixture/plain', confirmed: true })).toEqual({
      ok: false,
      error: { code: 'already-installed', name: '@fixture/plain' },
    })
    expect(readHomePatchRows()).toHaveLength(1)
  })

  it('uninstalls by removing the managed row and acknowledges idempotently', async () => {
    const { manager } = await harness()
    tempHome()
    await manager.install({ name: '@fixture/plain', confirmed: true })
    expect(await manager.uninstall({ name: '@fixture/plain' })).toEqual({ ok: true, value: { absent: true } })
    expect(readHomePatchRows()).toEqual([])
    expect(await manager.uninstall({ name: '@fixture/plain' })).toEqual({
      ok: false,
      error: { code: 'not-installed', name: '@fixture/plain' },
    })
  })

  it('refuses to remove a user-authored home-patch row as not-managed', async () => {
    const { manager } = await harness()
    tempHome()
    await updateHomePatch(rows => ({ applied: true, rows: [...rows, { name: '@fixture/plain' }] }))
    expect(await manager.uninstall({ name: '@fixture/plain' })).toEqual({
      ok: false,
      error: { code: 'not-managed', name: '@fixture/plain' },
    })
    expect(readHomePatchRows()).toEqual([{ name: '@fixture/plain' }])
  })

  it('uninstall leaves every unrelated row untouched', async () => {
    const { manager } = await harness()
    tempHome()
    await updateHomePatch(rows => ({ applied: true, rows: [...rows, { name: '@user/plugin' }] }))
    await manager.install({ name: '@fixture/plain', confirmed: true })
    expect(await manager.uninstall({ name: '@fixture/plain' })).toEqual({ ok: true, value: { absent: true } })
    expect(readHomePatchRows()).toEqual([{ name: '@user/plugin' }])
  })
})
