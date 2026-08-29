/**
 * Connector registry: persist, add-by-URL, enable/disable without mounting.
 * @module tests/service
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ConnectorRegistry, idFromName, serverNameFromName, toMcpClientConfig } from '../src/index.ts'
import type { ConnectorEntry } from '../src/index.ts'

describe('id helpers', () => {
  it('mints a kebab id and a unique suffix when taken', () => {
    expect(idFromName('GitHub MCP', new Set())).toBe('github-mcp')
    expect(idFromName('GitHub MCP', new Set(['github-mcp']))).toBe('github-mcp-2')
  })

  it('mints a legal MCP serverName', () => {
    expect(serverNameFromName('GitHub MCP', new Set())).toBe('GitHub_MCP')
    expect(serverNameFromName('!!!', new Set())).toBe('connector')
  })
})

describe('toMcpClientConfig', () => {
  it('projects an HTTP card and prefixes Bearer when needed', () => {
    const entry: ConnectorEntry = {
      id: 'gh' as ConnectorEntry['id'],
      name: 'GitHub',
      enabled: true,
      serverName: 'github',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      updatedAt: 1,
    }
    expect(toMcpClientConfig(entry, 'tok')).toMatchObject({
      transport: 'streamable-http',
      serverName: 'github',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer tok' },
      failOnStartupError: false,
    })
    const withBearer = toMcpClientConfig(entry, 'Bearer already')
    expect(withBearer.transport).toBe('streamable-http')
    if (withBearer.transport === 'streamable-http') {
      expect(withBearer.headers.Authorization).toBe('Bearer already')
    }
  })

  it('projects a stdio card', () => {
    const entry: ConnectorEntry = {
      id: 'fs' as ConnectorEntry['id'],
      name: 'FS',
      enabled: true,
      serverName: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server'],
      updatedAt: 1,
    }
    expect(toMcpClientConfig(entry)).toMatchObject({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server'],
    })
    const { args: _args, ...withoutArgs } = entry
    const withoutArgsCfg = toMcpClientConfig(withoutArgs)
    expect(withoutArgsCfg.transport).toBe('stdio')
    if (withoutArgsCfg.transport === 'stdio') {
      expect(withoutArgsCfg.args).toEqual([])
    }
  })
})

describe('ConnectorRegistry', () => {
  let root: string
  let registry: ConnectorRegistry

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-connectors-'))
    const ctx = new Context()
    await ctx.plugin(ConnectorRegistry, { root, mountClients: false })
    registry = ctx.connectors
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('adds an HTTP connector, lists it disabled when mountClients is off, and removes it', async () => {
    const added = await registry.addHttp({
      name: 'Docs',
      url: 'https://mcp.example.com',
      enabled: false,
    })
    expect(added).toMatchObject({
      name: 'Docs',
      transport: 'streamable-http',
      url: 'https://mcp.example.com',
      enabled: false,
      status: 'disabled',
    })
    expect(await registry.list()).toEqual([added])
    await registry.remove(added.id)
    expect(await registry.list()).toEqual([])
  })

  it('round-trips enable after a process restart from disk', async () => {
    const first = new Context()
    await first.plugin(ConnectorRegistry, { root, mountClients: false })
    const created = await first.connectors.addHttp({
      name: 'Keep',
      url: 'https://keep.example.com',
      enabled: false,
    })

    const second = new Context()
    await second.plugin(ConnectorRegistry, { root, mountClients: false })
    const listed = await second.connectors.list()
    expect(listed).toMatchObject([{ id: created.id, name: 'Keep', url: 'https://keep.example.com' }])
    const enabled = await second.connectors.setEnabled(created.id, true)
    expect(enabled.enabled).toBe(true)
    expect(enabled.status).toBe('disabled')
  })

  it('adds a stdio connector', async () => {
    const added = await registry.addStdio({
      name: 'Local FS',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      serverName: 'local_fs',
      enabled: false,
    })
    expect(added.transport).toBe('stdio')
    expect(added.command).toBe('npx')
    expect(added.serverName).toBe('local_fs')
    const second = await registry.addStdio({ name: 'Other FS', command: 'npx' })
    expect(second.serverName).toMatch(/^[A-Za-z0-9_-]+$/)
    await expect(registry.addStdio({ name: '  ', command: 'npx' })).rejects.toThrow('name is required')
  })

  it('refuses an empty name or url', async () => {
    await expect(registry.addHttp({ name: '  ', url: 'https://x' })).rejects.toThrow('name is required')
    await expect(registry.addHttp({ name: 'X', url: '  ' })).rejects.toThrow('url is required')
  })

  it('refuses an empty stdio command and a missing id', async () => {
    await expect(registry.addStdio({ name: 'X', command: '  ' })).rejects.toThrow('command is required')
    await expect(registry.setEnabled('missing' as ConnectorEntry['id'], true)).rejects.toThrow('is not saved')
  })

  it('marks a card mounted once ctx.plugin returns, even if the URL is dead', async () => {
    const ctx = new Context()
    await ctx.plugin(ConnectorRegistry, { root, mountClients: true })
    const added = await ctx.connectors.addHttp({
      name: 'Dead',
      url: 'https://dead.example.com',
    })
    expect(added.status).toBe('mounted')
    const named = await ctx.connectors.addHttp({
      name: 'Named',
      url: 'https://named.example.com',
      serverName: 'named_http',
      enabled: true,
    })
    expect(named.serverName).toBe('named_http')
    await ctx.connectors.remove(added.id)
  })

  it('records error when authorizationRef cannot resolve', async () => {
    const ctx = new Context()
    await ctx.plugin(ConnectorRegistry, { root, mountClients: true })
    const added = await ctx.connectors.addHttp({
      name: 'Auth',
      url: 'https://auth.example.com',
      authorizationRef: 'mcp_token',
    })
    expect(added.status).toBe('error')
    expect(added.error).toContain('credentials')

    const unsetRoot = await mkdtemp(join(tmpdir(), 'dsh-connectors-unset-'))
    const withCreds = new Context()
    withCreds.provide('credentials', {
      resolve: async () => undefined,
    })
    await withCreds.plugin(ConnectorRegistry, { root: unsetRoot, mountClients: true })
    const unset = await withCreds.connectors.addHttp({
      name: 'Unset',
      url: 'https://unset.example.com',
      authorizationRef: 'mcp_token',
    })
    expect(unset.status).toBe('error')
    expect(unset.error).toContain('unset')

    const emptyRoot = await mkdtemp(join(tmpdir(), 'dsh-connectors-empty-'))
    const emptyCreds = new Context()
    emptyCreds.provide('credentials', {
      resolve: async () => ({ value: '' }),
    })
    await emptyCreds.plugin(ConnectorRegistry, { root: emptyRoot, mountClients: true })
    const empty = await emptyCreds.connectors.addHttp({
      name: 'Empty',
      url: 'https://empty.example.com',
      authorizationRef: 'mcp_token',
    })
    expect(empty.status).toBe('error')
    expect(empty.error).toContain('unset')

    const tokRoot = await mkdtemp(join(tmpdir(), 'dsh-connectors-tok-'))
    const withTok = new Context()
    withTok.plugin((scope) => {
      scope.provide('credentials', {
        resolve: async () => ({ value: 'tok' }),
      })
    })
    const registryFiber = await withTok.plugin(ConnectorRegistry, { root: tokRoot, mountClients: true })
    const authed = await withTok.connectors.addHttp({
      name: 'Tok',
      url: 'https://tok.example.com',
      authorizationRef: 'mcp_token',
    })
    expect(authed.status).toBe('mounted')
    await registryFiber.dispose()
    await rm(unsetRoot, { recursive: true, force: true })
    await rm(emptyRoot, { recursive: true, force: true })
    await rm(tokRoot, { recursive: true, force: true })
  })
})
