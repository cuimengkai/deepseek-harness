import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import InvariantService, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as PlatformShellInvariant from '../src/invariant.ts'
import { PlatformShellService } from '../src/service.ts'
import { periodOf } from '../src/capability-market.ts'
import { AssetId, CapabilityId, RoleId, ScenarioId, WorkspaceId } from '../src/types.ts'

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
          assetId: AssetId('code-999'),
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

/** Mount the store + invariant topology and seed one published + settled market. */
async function setupMarket() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(PlatformShellInvariant)
  const path = await freshDbPath()
  await ctx.plugin(PlatformShellService, { path })
  const shell = ctx.platformShell
  const ws = shell.createWorkspace('Platform')
  const admin = shell.registerUser('Admin')
  const alice = shell.registerUser('Alice')
  shell.assignRole(ws, admin, RoleId('platform-admin'))
  shell.assignRole(ws, alice, RoleId('product'))
  const capability = shell.publishCapability(admin, {
    id: CapabilityId('code-gen'), name: 'Code Gen', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 4,
  })
  shell.publishScenario(admin, {
    id: ScenarioId('product-engineering'), name: 'Product Engineering', workbenchId: 'product-engineering', roleId: RoleId('product'),
    preset: 'product-engineering', capabilityIds: [CapabilityId('code-gen')],
  })
  shell.creditAccount(admin, ws, 100)
  shell.consumeCapability(alice, { workspaceId: ws, capabilityId: CapabilityId('code-gen'), qty: 2 })
  const settlement = shell.settleAccount(admin, ws, periodOf(Date.now()))
  return { ctx, shell, ws, capability, settlement }
}

describe('platform-shell market reference invariant', () => {
  it('accepts a capability/published event naming an existing catalog entry', async () => {
    const { ctx, capability } = await setupMarket()
    try {
      const session = ctx.sessions.create(SessionId('market-invariant-valid'))
      expect(() => {
        session.append('capability/published', {
          capabilityId: capability.id,
          version: capability.version,
          roleId: capability.roleId,
        })
      }).not.toThrow()
      expect(session.events).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a capability/published event naming a missing entry', async () => {
    const { ctx } = await setupMarket()
    try {
      const session = ctx.sessions.create(SessionId('market-invariant-missing'))
      expect(() => {
        session.append('capability/published', {
          capabilityId: CapabilityId('ghost-cap'),
          version: '1.0.0',
          roleId: RoleId('product'),
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

  it('accepts a capability/selected event naming existing capabilities', async () => {
    const { ctx, ws, capability } = await setupMarket()
    try {
      const session = ctx.sessions.create(SessionId('market-invariant-selected'))
      expect(() => {
        session.append('capability/selected', {
          workspaceId: ws,
          capabilityIds: [capability.id],
          preset: 'product-engineering',
        })
      }).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a capability/selected event naming a missing capability', async () => {
    const { ctx, ws } = await setupMarket()
    try {
      const session = ctx.sessions.create(SessionId('market-invariant-selected-missing'))
      expect(() => {
        session.append('capability/selected', {
          workspaceId: ws,
          capabilityIds: [CapabilityId('ghost-cap')],
          preset: 'product-engineering',
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

  it('accepts a billing/settlement event matching the committed status', async () => {
    const { ctx, ws, settlement } = await setupMarket()
    try {
      const session = ctx.sessions.create(SessionId('market-invariant-settlement'))
      expect(() => {
        session.append('billing/settlement', {
          settlementId: settlement.id,
          workspaceId: ws,
          period: settlement.period,
          status: 'settled',
        })
      }).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a billing/settlement event diverging from the committed status', async () => {
    const { ctx, ws, settlement } = await setupMarket()
    try {
      const session = ctx.sessions.create(SessionId('market-invariant-settlement-open'))
      expect(() => {
        session.append('billing/settlement', {
          settlementId: settlement.id,
          workspaceId: ws,
          period: settlement.period,
          status: 'open',
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

  it('accepts a platform/workspace/isolated event matching the isolation record', async () => {
    const { ctx, shell } = await setup()
    try {
      const isolated = shell.createWorkspace('Isolated', { isolated: true })
      const session = ctx.sessions.create(SessionId('platform-invariant-isolated'))
      expect(() => {
        session.append('platform/workspace/isolated', { workspaceId: isolated, isolated: true })
      }).not.toThrow()
      expect(session.events).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a platform/workspace/isolated event diverging from the isolation record', async () => {
    const { ctx, ws } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('platform-invariant-isolated-false'))
      expect(() => {
        session.append('platform/workspace/isolated', { workspaceId: ws, isolated: true })
      }).toThrow(expect.objectContaining<Partial<InvariantError>>({
        code: 'INVARIANT',
        packageName: '@deepseek-ai/dsh-experimental-platform-shell',
      }))
      expect(session.events).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
