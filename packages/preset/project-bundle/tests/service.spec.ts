/**
 * Project-bundle registry persist and prepareStart.
 * @module tests/service
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ProjectBundleRegistry } from '../src/index.ts'

describe('ProjectBundleRegistry', () => {
  let root: string
  let registry: ProjectBundleRegistry

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-projects-'))
    const ctx = new Context()
    await ctx.plugin(ProjectBundleRegistry, { root })
    registry = ctx.projectBundles
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('creates, lists, updates, prepares, and removes a bundle', async () => {
    const created = await registry.create({
      name: 'Launch',
      sharedRoot: '/tmp/launch',
      instructions: 'Use the launch checklist.',
      connectorIds: ['docs'],
    })
    expect(created).toMatchObject({
      name: 'Launch',
      sharedRoot: '/tmp/launch',
      instructions: 'Use the launch checklist.',
      connectorIds: ['docs'],
    })
    expect(await registry.list()).toEqual([created])
    const updated = await registry.update(created.id, {
      name: 'Launch',
      sharedRoot: '/tmp/launch-2',
      instructions: created.instructions,
      connectorIds: created.connectorIds,
    })
    expect(updated.sharedRoot).toBe('/tmp/launch-2')
    const prepared = await registry.prepareStart(created.id)
    expect(prepared.sharedRoot).toBe('/tmp/launch-2')
    await registry.remove(created.id)
    expect(await registry.list()).toEqual([])
  })

  it('refuses an empty name or sharedRoot', async () => {
    await expect(registry.create({ name: '  ', sharedRoot: '/tmp/x' })).rejects.toThrow('name is required')
    await expect(registry.create({ name: 'X', sharedRoot: '  ' })).rejects.toThrow('sharedRoot is required')
  })

  it('enables listed connectors on prepareStart', async () => {
    const enabled: string[] = []
    const withConnectors = new Context()
    withConnectors.provide('connectors', {
      setEnabled: async (id: string, value: boolean) => {
        enabled.push(`${id}:${String(value)}`)
      },
    })
    await withConnectors.plugin(ProjectBundleRegistry, { root })
    const created = await withConnectors.projectBundles.create({
      name: 'With docs',
      sharedRoot: '/tmp/docs',
      connectorIds: ['docs'],
      expertPresetIds: ['standard'],
      skillPaths: ['/tmp/skill'],
    })
    const prepared = await withConnectors.projectBundles.prepareStart(created.id)
    expect(prepared.expertPresetIds).toEqual(['standard'])
    expect(enabled).toEqual(['docs:true'])
  })

  it('clears the connectors handle when that service unloads', async () => {
    const ctx = new Context()
    const holder = ctx.plugin((scope) => {
      scope.provide('connectors', {
        setEnabled: async () => {},
      })
    })
    await ctx.plugin(ProjectBundleRegistry, { root })
    await holder.dispose()
    const created = await ctx.projectBundles.create({ name: 'Solo', sharedRoot: '/tmp/solo' })
    await expect(ctx.projectBundles.prepareStart(created.id)).resolves.toMatchObject({ id: created.id })
  })

  it('refuses update or prepare on a missing id', async () => {
    await expect(registry.update('missing' as never, { name: 'X', sharedRoot: '/tmp/x' }))
      .rejects.toThrow('is not saved')
    await expect(registry.prepareStart('missing' as never)).rejects.toThrow('is not saved')
  })

  it('reloads from disk after a restart', async () => {
    const first = new Context()
    await first.plugin(ProjectBundleRegistry, { root })
    const created = await first.projectBundles.create({ name: 'Keep', sharedRoot: '/tmp/keep' })
    const second = new Context()
    await second.plugin(ProjectBundleRegistry, { root })
    expect(await second.projectBundles.list()).toMatchObject([{ id: created.id, name: 'Keep' }])
  })
})
