import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { PlatformShellService } from '../src/service.ts'
import { RoleId, UserId } from '../src/types.ts'
import { expectPlatformError } from './expect-platform-error.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function freshDbPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'platform-shell-service-'))
  dirs.push(directory)
  return join(directory, 'platform.db')
}

async function start(ctx: Context, config: object = {}): Promise<PlatformShellService> {
  await ctx.plugin(SessionStore)
  await ctx.plugin(PlatformShellService, config)
  return ctx.platformShell
}

async function dispose(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
}

describe('PlatformShellService', () => {
  it('registers on the context and seeds default roles', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, alice, RoleId('product'))
      expect(shell.canAccessWorkspace(alice, ws)).toBe(true)
      const member = shell.membership(alice, ws)
      expect(member?.permissions).toContain('asset.register')
    } finally {
      await dispose(ctx)
    }
  })

  it('denies a non-member and unknown actors with structured codes', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      const bob = shell.registerUser('Bob')
      shell.assignRole(ws, alice, RoleId('product'))
      expect(shell.canAccessWorkspace(bob, ws)).toBe(false)
      expectPlatformError(() => shell.canAccessWorkspace(UserId('ghost'), ws), 'UNKNOWN_ACTOR')
    } finally {
      await dispose(ctx)
    }
  })

  it('registers an asset and persists an audit row in the same mutation', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, alice, RoleId('product'))
      const asset = shell.registerAsset(alice, { workspaceId: ws, kind: 'requirement', content: 'R1', roleId: RoleId('product') })
      expect(asset.id).toBe('requirement-1')
      const rows = shell.listAudit(alice, { workspaceId: ws, action: 'asset.register' })
      expect(rows).toHaveLength(1)
      expect(rows[0].targetId).toBe('requirement-1')
    } finally {
      await dispose(ctx)
    }
  })

  it('walks a three-role lineage chain and grants workspace-scoped reads', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      const bob = shell.registerUser('Bob')
      const carol = shell.registerUser('Carol')
      shell.assignRole(ws, alice, RoleId('product'))
      shell.assignRole(ws, bob, RoleId('dev'))
      shell.assignRole(ws, carol, RoleId('qa'))
      const req = shell.registerAsset(alice, { workspaceId: ws, kind: 'requirement', content: 'R1', roleId: RoleId('product') }).id
      const code = shell.registerAsset(bob, { workspaceId: ws, kind: 'code', content: 'C1', roleId: RoleId('dev') }).id
      const test = shell.registerAsset(carol, { workspaceId: ws, kind: 'test-case', content: 'T1', roleId: RoleId('qa') }).id
      shell.linkAsset(bob, code, req)
      shell.linkAsset(carol, test, code)
      const chain = shell.ancestors(carol, test)
      expect(chain.map(e => e.parentId)).toContain(req)
      expect(shell.parents(bob, code).map(e => e.parentId)).toEqual([req])
      expect(shell.descendants(alice, req).map(e => e.assetId)).toContain(test)
    } finally {
      await dispose(ctx)
    }
  })

  it('drives a business approval through release with a granted scope', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      const admin = shell.registerUser('Admin')
      shell.assignRole(ws, alice, RoleId('product'))
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      const asset = shell.registerAsset(alice, { workspaceId: ws, kind: 'requirement', content: 'R1', roleId: RoleId('product') })
      const ticket = shell.submitTicket(alice, ws, asset.id)
      expect(ticket.status).toBe('draft')
      const reviewed = shell.transition(alice, ticket.id, 'review')
      expect(reviewed.status).toBe('review')
      const approved = shell.transition(admin, ticket.id, 'approved', { roles: [RoleId('product')], workspace: ws, expiresAt: 100 })
      expect(approved.reviewScope?.roles).toEqual([RoleId('product')])
      const released = shell.transition(admin, ticket.id, 'released')
      expect(released.status).toBe('released')
      const log = shell.transitions(admin, ticket.id)
      expect(log.map(t => t.to)).toEqual(['draft', 'review', 'approved', 'released'])
    } finally {
      await dispose(ctx)
    }
  })

  it('disposes cleanly and releases the database file', async () => {
    const path = await freshDbPath()
    const ctx = new Context()
    const shell = await start(ctx, { path })
    const ws = shell.createWorkspace('Platform')
    const alice = shell.registerUser('Alice')
    shell.assignRole(ws, alice, RoleId('product'))
    expect(shell.listAssets(alice, ws)).toEqual([])
    await dispose(ctx)
    // After disposal the database is closed; a fresh context re-opens the same
    // persisted file and still owns the workspace created before disposal.
    const reopened = new Context()
    try {
      await start(reopened, { path })
      expect(reopened.platformShell.listAssets(alice, ws)).toEqual([])
      expect(reopened.platformShell.canAccessWorkspace(alice, ws)).toBe(true)
    } finally {
      await dispose(reopened)
    }
  })
})
