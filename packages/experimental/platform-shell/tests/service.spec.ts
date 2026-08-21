import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { PlatformShellService } from '../src/service.ts'
import { periodOf } from '../src/capability-market.ts'
import { CapabilityId, RoleId, ScenarioId, UserId } from '../src/types.ts'
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
      expect(rows[0]?.targetId).toBe('requirement-1')
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

/** Seed one workspace with a platform-admin operator and a product consumer. */
function seedMarket(shell: PlatformShellService): { ws: ReturnType<PlatformShellService['createWorkspace']>; admin: UserId; alice: UserId } {
  const ws = shell.createWorkspace('Platform')
  const admin = shell.registerUser('Admin')
  const alice = shell.registerUser('Alice')
  shell.assignRole(ws, admin, RoleId('platform-admin'))
  shell.assignRole(ws, alice, RoleId('product'))
  return { ws, admin, alice }
}

describe('PlatformShellService capability market', () => {
  it('publishes, lists, reads, gates, and unpublishes a capability', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const { ws, admin, alice } = seedMarket(shell)
      void ws
      const published = shell.publishCapability(admin, {
        id: CapabilityId('requirement-management'),
        name: 'Requirement Management',
        roleId: RoleId('product'),
        execution: 'managed',
        version: '1.0.0',
        rate: 5,
      })
      expect(shell.capabilityExists(published.id)).toBe(true)
      expect(shell.getCapability(alice, published.id)).toMatchObject({ enabled: true, rollout: 1, rate: 5 })
      expect(shell.listCapabilities(alice).map(c => c.id)).toEqual([CapabilityId('requirement-management')])

      const gated = shell.setCapabilityGate(admin, published.id, { enabled: false, rollout: 0.5 })
      expect(gated).toMatchObject({ enabled: false, rollout: 0.5 })

      shell.unpublishCapability(admin, published.id)
      expect(shell.capabilityExists(published.id)).toBe(false)
    } finally {
      await dispose(ctx)
    }
  })

  it('denies a non-operator publishing or gating a capability', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const { admin, alice } = seedMarket(shell)
      expectPlatformError(
        () => shell.publishCapability(alice, { id: CapabilityId('x'), name: 'X', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1 }),
        'PERMISSION_DENIED',
      )
      shell.publishCapability(admin, { id: CapabilityId('x'), name: 'X', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1 })
      expectPlatformError(
        () => shell.setCapabilityGate(alice, CapabilityId('x'), { enabled: false, rollout: 0.5 }),
        'PERMISSION_DENIED',
      )
    } finally {
      await dispose(ctx)
    }
  })

  it('rejects a duplicate capability and an unknown dependency loudly', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const { admin } = seedMarket(shell)
      shell.publishCapability(admin, { id: CapabilityId('a'), name: 'A', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1 })
      expectPlatformError(
        () => shell.publishCapability(admin, { id: CapabilityId('a'), name: 'A2', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1 }),
        'DUPLICATE_CAPABILITY',
      )
      expectPlatformError(
        () => shell.publishCapability(admin, {
          id: CapabilityId('b'), name: 'B', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1,
          dependencies: [{ id: CapabilityId('ghost-dep') }],
        }),
        'CAPABILITY_NOT_FOUND',
      )
    } finally {
      await dispose(ctx)
    }
  })

  it('publishes a scenario and resolves a selection within its workbench', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const { ws, admin, alice } = seedMarket(shell)
      shell.publishCapability(admin, { id: CapabilityId('base-llm'), name: 'Base LLM', roleId: RoleId('product'), execution: 'managed', version: '2.0.0', rate: 3 })
      shell.publishCapability(admin, {
        id: CapabilityId('rag'), name: 'RAG', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 2,
        dependencies: [{ id: CapabilityId('base-llm'), range: '>=2.0.0' }],
      })
      shell.publishScenario(admin, {
        id: ScenarioId('product-engineering'),
        name: 'Product Engineering',
        workbenchId: 'product-engineering',
        roleId: RoleId('product'),
        preset: 'product-engineering',
        capabilityIds: [CapabilityId('base-llm'), CapabilityId('rag')],
      })
      expect(shell.scenarioExists(ScenarioId('product-engineering'))).toBe(true)
      expect(shell.listScenarios(alice).map(s => s.workbenchId)).toEqual(['product-engineering'])

      const resolved = shell.resolveCapabilities(alice, {
        workspaceId: ws,
        scenarioId: ScenarioId('product-engineering'),
        selected: [CapabilityId('rag')],
      })
      // The dependency on base-llm resolves transitively ahead of the selection.
      expect(resolved.requested).toEqual([CapabilityId('rag')])
      expect(resolved.resolved.map(c => c.id)).toEqual([CapabilityId('base-llm'), CapabilityId('rag')])
      expect(resolved.preset).toBe('product-engineering')
    } finally {
      await dispose(ctx)
    }
  })

  it('rejects an out-of-workbench selection and a conflicting pair', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const { ws, admin, alice } = seedMarket(shell)
      shell.publishCapability(admin, { id: CapabilityId('sql-db'), name: 'SQL', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1 })
      shell.publishCapability(admin, { id: CapabilityId('vector-db'), name: 'Vector', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1, conflictsWith: [CapabilityId('sql-db')] })
      shell.publishScenario(admin, {
        id: ScenarioId('db-stack'), name: 'DB Stack', workbenchId: 'db-stack', roleId: RoleId('product'), preset: 'db-stack',
        capabilityIds: [CapabilityId('sql-db'), CapabilityId('vector-db')],
      })
      expectPlatformError(
        () => shell.resolveCapabilities(alice, { workspaceId: ws, scenarioId: ScenarioId('db-stack'), selected: [CapabilityId('sql-db'), CapabilityId('vector-db')] }),
        'CAPABILITY_CONFLICT',
      )
      // A capability outside the workbench's set is refused as invalid.
      shell.publishCapability(admin, { id: CapabilityId('code-gen'), name: 'Code Gen', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1 })
      expectPlatformError(
        () => shell.resolveCapabilities(alice, { workspaceId: ws, scenarioId: ScenarioId('db-stack'), selected: [CapabilityId('code-gen')] }),
        'INVALID_ARGUMENT',
      )
    } finally {
      await dispose(ctx)
    }
  })

  it('credits, meters consumption, and settles one account', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const { ws, admin, alice } = seedMarket(shell)
      shell.publishCapability(admin, { id: CapabilityId('code-gen'), name: 'Code Gen', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 4 })
      expect(shell.accountBalance(admin, ws)).toBeUndefined()
      shell.creditAccount(admin, ws, 100)
      expect(shell.accountBalance(admin, ws)?.balance).toBe(100)

      const usage = shell.consumeCapability(alice, { workspaceId: ws, capabilityId: CapabilityId('code-gen'), qty: 2 })
      expect(usage.cost).toBe(8)
      expect(shell.accountBalance(admin, ws)?.balance).toBe(92)
      expect(shell.listUsage(admin, ws).map(u => u.cost)).toEqual([8])

      const period = periodOf(Date.now())
      const settled = shell.settleAccount(admin, ws, period)
      expect(settled.status).toBe('settled')
      expect(settled.amount).toBe(8)
      expect(shell.settlementStatus(settled.id)).toBe('settled')
    } finally {
      await dispose(ctx)
    }
  })

  it('refuses an overdraft and a gated-off consumption', async () => {
    const ctx = new Context()
    try {
      const shell = await start(ctx)
      const { ws, admin, alice } = seedMarket(shell)
      shell.publishCapability(admin, { id: CapabilityId('premium'), name: 'Premium', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 10 })
      // A disabled capability is refused even with a funded account.
      shell.setCapabilityGate(admin, CapabilityId('premium'), { enabled: false, rollout: 1 })
      shell.creditAccount(admin, ws, 100)
      expectPlatformError(
        () => shell.consumeCapability(alice, { workspaceId: ws, capabilityId: CapabilityId('premium') }),
        'CAPABILITY_DISABLED',
      )
      // A funded capability can be overdrawn only as far as the balance allows.
      shell.setCapabilityGate(admin, CapabilityId('premium'), { enabled: true, rollout: 1 })
      expectPlatformError(
        () => shell.consumeCapability(alice, { workspaceId: ws, capabilityId: CapabilityId('premium'), qty: 11 }),
        'INSUFFICIENT_BALANCE',
      )
    } finally {
      await dispose(ctx)
    }
  })
})
