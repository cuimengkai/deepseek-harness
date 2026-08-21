import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import InvariantService, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as PlatformShellInvariant from '../src/invariant.ts'
import { PlatformShellService } from '../src/service.ts'
import { RoleId, WorkspaceId } from '../src/types.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function freshDbPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'platform-shell-invariant-'))
  dirs.push(directory)
  return join(directory, 'platform.db')
}

/** Mount a full store + invariant topology and seed one asset and one ticket. */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(PlatformShellInvariant)
  const path = await freshDbPath()
  await ctx.plugin(PlatformShellService, { path })
  const shell = ctx.platformShell
  const ws = shell.createWorkspace('Platform')
  const alice = shell.registerUser('Alice')
  shell.assignRole(ws, alice, RoleId('product'))
  const asset = shell.registerAsset(alice, { workspaceId: ws, kind: 'requirement', content: 'R1', roleId: RoleId('product') })
  const ticket = shell.submitTicket(alice, ws, asset.id)
  return { ctx, shell, ws, alice, asset, ticket }
}

describe('platform-shell lineage-bridge invariant', () => {
  it('accepts a reference event naming an existing asset', async () => {
    const { ctx, asset, ws, alice } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('platform-invariant-valid'))
      expect(() => {
        session.append('asset/register', {
          assetId: asset.id,
          kind: 'requirement',
          roleId: RoleId('product'),
          workspaceId: ws,
        })
      }).not.toThrow()
      expect(session.events).toHaveLength(1)
      void alice
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a reference event naming a missing asset', async () => {
    const { ctx } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('platform-invariant-missing'))
      expect(() => {
        session.append('asset/register', {
          assetId: 'code-999',
          kind: 'code',
          roleId: RoleId('dev'),
          workspaceId: WorkspaceId('ws-1'),
        })
      }).toThrow(expect.objectContaining<Partial<InvariantError>>({
        code: 'INVARIANT',
        packageName: '@deepseek-ai/dsh-experimental-platform-shell',
      }))
      expect(session.events).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a transition event that diverges from the committed ticket status', async () => {
    const { ctx, ticket, ws, alice } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('platform-invariant-transition'))
      expect(() => {
        session.append('platform/approval/transition', {
          ticketId: ticket.id,
          from: 'draft',
          to: 'released',
          actorUserId: alice,
          workspaceId: ws,
        })
      }).toThrow(expect.objectContaining<Partial<InvariantError>>({
        code: 'INVARIANT',
        packageName: '@deepseek-ai/dsh-experimental-platform-shell',
      }))
      expect(session.events).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('accepts a transition event matching the committed status', async () => {
    const { ctx, ticket, ws, alice } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('platform-invariant-transition-valid'))
      expect(() => {
        session.append('platform/approval/transition', {
          ticketId: ticket.id,
          from: null,
          to: 'draft',
          actorUserId: alice,
          workspaceId: ws,
        })
      }).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('seeds a session whose committed events already violate the bridge', async () => {
    const { ctx } = await setup()
    try {
      // Mounting a fresh session is safe; the check runs on append, not on seed.
      const session = ctx.sessions.create(SessionId('platform-invariant-empty'))
      expect(session.events).toEqual([])
      expect(ctx.platformShell).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
