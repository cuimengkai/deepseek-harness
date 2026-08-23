import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

describe('plugin-inventory/changed events', () => {
  /** Let the coalesced changed microtask (and any loader-internal awaits) run. */
  async function flush(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  function countChanged(ctx: Context): { changed: () => number; wait: () => Promise<void> } {
    let count = 0
    ctx.on('plugin-inventory/changed', () => { count += 1 })
    return { changed: () => count, wait: flush }
  }

  it('emits a changed event after each create/update/remove mutation', async () => {
    const { ctx } = await harness()
    const watcher = countChanged(ctx)

    const id = await ctx.loader.create({ name: 'cordis:active' })
    await watcher.wait()
    expect(watcher.changed()).toBeGreaterThan(0)

    const afterCreate = watcher.changed()
    await ctx.loader.update(id, { disabled: true })
    await watcher.wait()
    expect(watcher.changed()).toBeGreaterThan(afterCreate)

    const afterUpdate = watcher.changed()
    await ctx.loader.remove(id)
    await watcher.wait()
    expect(watcher.changed()).toBeGreaterThan(afterUpdate)
  })

  it('does not emit when the recomputed projection is unchanged', async () => {
    const { ctx } = await harness()
    const watcher = countChanged(ctx)

    // Group entries are filtered out of the projection yet still traverse the
    // loader; the recomputed projection is identical, so no changed emit.
    await ctx.loader.create({ name: 'cordis:active', group: true })
    await watcher.wait()
    expect(watcher.changed()).toBe(0)

    // A fiber with no loader entry (a direct ctx.plugin) also leaves the
    // projection untouched, exercising the dirty check through internal/plugin.
    await ctx.plugin(() => {})
    await watcher.wait()
    expect(watcher.changed()).toBe(0)
  })
})

describe('PluginInventoryGateway', () => {
  it('publishes one direct list method under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('projects spine category and description for known harness modules only', async () => {
    const { ctx, inventory } = await harness()
    // Both entries are disabled so the Loader skips module loading and never
    // imports the real packages in this unit test.
    const toolsId = await ctx.loader.create({
      name: '@deepseek-ai/dsh-tools',
      disabled: true,
    })
    const customId = await ctx.loader.create({
      name: '@fixture/user-install',
      disabled: true,
    })

    const entries = inventory.list().entries
    expect(entries.find(entry => entry.entryId === toolsId)).toEqual({
      entryId: toolsId,
      moduleName: '@deepseek-ai/dsh-tools',
      enabled: false,
      fiberPhase: null,
      category: 'core',
      description: 'Host tool registry and presentation mode',
    })
    // Unknown modules project no category or description keys.
    expect(entries.find(entry => entry.entryId === customId)).toEqual({
      entryId: customId,
      moduleName: '@fixture/user-install',
      enabled: false,
      fiberPhase: null,
    })
  })
})
