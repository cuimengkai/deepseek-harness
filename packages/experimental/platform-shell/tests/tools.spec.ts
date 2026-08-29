import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { PlatformShellService } from '../src/service.ts'
import { registerPlatformShellTools, type ResolveBaseRows } from '../src/tools.ts'
import { periodOf } from '../src/capability-market.ts'
import { PlatformShellError } from '../src/error.ts'
import { AssetId, CapabilityId, RoleId, UserId } from '../src/types.ts'

/**
 * Mount the tools topology: session store, tool runtime, the platform-shell
 * service, and the shell tools with an in-memory session→actor binding.
 * @param options - optional bindings, `resolveBaseRows` for the assembler tool.
 * @returns the context, service, and a helper executing tools on a named session.
 */
async function setup(options: { resolveBaseRows?: ResolveBaseRows } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(PlatformShellService, { path: ':memory:' })
  const shell = ctx.platformShell
  const users = new Map<string, UserId>()

  registerPlatformShellTools(ctx, {
    resolveActor: (session) => {
      const user = users.get(String(session.id))
      if (user === undefined) {
        throw new PlatformShellError('UNKNOWN_ACTOR', `no platform user bound to session ${session.id}`)
      }
      return user
    },
    ...(options.resolveBaseRows !== undefined ? { resolveBaseRows: options.resolveBaseRows } : {}),
  })

  const bind = (sessionId: string, user: UserId): void => {
    users.set(sessionId, user)
  }

  /** Resolve the live session for one named agent, creating it on first use. */
  const sessionOf = (sessionId: string): Session =>
    ctx.sessions.get(SessionId(sessionId)) ?? ctx.sessions.create(SessionId(sessionId))

  /** Execute one registered tool as one session's agent. */
  const run = async (sessionId: string, name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const agent: Agent = {
      ctx: new Context(),
      id: SessionId(sessionId),
      options: {},
      session: sessionOf(sessionId),
      inbox: undefined as never,
      status: 'idle',
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => { throw new Error('unused in tool spec') },
      cancel() {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
    return ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('tools-spec-call'),
      name,
      arguments: args,
      agent,
    })
  }

  return { ctx, shell, bind, sessionOf, run }
}

async function dispose(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
}

describe('platform-shell tools', () => {
  it('register_asset writes the asset and appends asset/register on the session', async () => {
    const { ctx, shell, bind, sessionOf, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', alice)

      const result = await run('session-a', 'register_asset', {
        workspaceId: ws,
        kind: 'requirement',
        content: 'Login page with SSO',
        roleId: 'product',
      })
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({ asset: { id: 'requirement-1', workspaceId: ws } })
      expect(result.meta).toMatchObject({ code: 'registered' })
      const session = sessionOf('session-a')
      const registered = session.events.filter(e => e.type === 'asset/register')
      expect(registered).toHaveLength(1)
      expect(registered[0]).toMatchObject({
        data: { assetId: 'requirement-1', kind: 'requirement', roleId: 'product', workspaceId: ws },
      })
      expect(shell.assetExists(AssetId('requirement-1'))).toBe(true)
      // The agent-loop persists `result.meta` into the `tool/result` event; the
      // keyless demo snapshots that integration end to end.
      void ctx
    } finally {
      await dispose(ctx)
    }
  })

  it('get_asset reads an asset and appends asset/read, returning NOT-FOUND for misses', async () => {
    const { ctx, shell, bind, sessionOf, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      const mallory = shell.registerUser('Mallory')
      shell.assignRole(ws, alice, RoleId('product'))
      shell.assignRole(ws, mallory, RoleId('dev'))
      bind('session-a', alice)
      bind('session-b', mallory)
      const sessionB = sessionOf('session-b')

      await run('session-a', 'register_asset', {
        workspaceId: ws,
        kind: 'requirement',
        content: 'R1',
        roleId: 'product',
      })

      const read = await run('session-b', 'get_asset', { assetId: 'requirement-1' })
      expect(read.isError).toBe(false)
      expect(read.value).toMatchObject({ found: true, asset: { id: 'requirement-1', content: 'R1' } })
      expect(read.meta).toMatchObject({ code: 'read' })
      expect(sessionB.events.filter(e => e.type === 'asset/read')).toHaveLength(1)

      const miss = await run('session-b', 'get_asset', { assetId: 'code-99' })
      expect(miss.isError).toBe(false)
      expect(miss.value).toMatchObject({ found: false })
      expect(miss.meta).toMatchObject({ code: 'not-found' })
      expect(sessionB.events.filter(e => e.type === 'asset/read')).toHaveLength(1)
    } finally {
      await dispose(ctx)
    }
  })

  it('approve_ticket drives the lifecycle and appends matching transition events', async () => {
    const { ctx, shell, bind, sessionOf, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      const admin = shell.registerUser('Admin')
      shell.assignRole(ws, alice, RoleId('product'))
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      bind('session-a', alice)
      bind('session-b', admin)
      const sessionA = sessionOf('session-a')
      const sessionB = sessionOf('session-b')

      const asset = shell.registerAsset(alice, { workspaceId: ws, kind: 'requirement', content: 'R1', roleId: RoleId('product') })
      const ticket = shell.submitTicket(alice, ws, asset.id)

      const reviewed = await run('session-a', 'approve_ticket', { ticketId: ticket.id, to: 'review' })
      expect(reviewed.value).toMatchObject({ ticket: { status: 'review' } })
      const approved = await run('session-b', 'approve_ticket', {
        ticketId: ticket.id,
        to: 'approved',
        roles: ['product'],
        expiresAt: 100,
      })
      expect(approved.value).toMatchObject({ ticket: { status: 'approved' } })
      const released = await run('session-b', 'approve_ticket', { ticketId: ticket.id, to: 'released' })
      expect(released.value).toMatchObject({ ticket: { status: 'released' } })

      const events = [...sessionA.events, ...sessionB.events].filter(e => e.type === 'platform/approval/transition')
      expect(events).toHaveLength(3)
      expect(events.map(e => `${String(e.data.from)}→${e.data.to}`)).toEqual(['draft→review', 'review→approved', 'approved→released'])
    } finally {
      await dispose(ctx)
    }
  })

  it('audit_query lists rows scoped to the caller', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', alice)

      await run('session-a', 'register_asset', {
        workspaceId: ws,
        kind: 'requirement',
        content: 'R1',
        roleId: 'product',
      })
      const events = await run('session-a', 'audit_query', { action: 'asset.register' })
      expect(events.isError).toBe(false)
      expect(events.value).toMatchObject({ events: [{ action: 'asset.register', targetId: 'requirement-1' }] })
      expect(events.meta).toMatchObject({ code: 'queried', count: 1 })
    } finally {
      await dispose(ctx)
    }
  })

  it('denies an unbound session with the UNKNOWN_ACTOR code', async () => {
    const { ctx, run } = await setup()
    try {
      const result = await run('session-ghost', 'register_asset', {
        workspaceId: 'ws-1',
        kind: 'requirement',
        content: 'R1',
        roleId: 'product',
      })
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('UNKNOWN_ACTOR')
    } finally {
      await dispose(ctx)
    }
  })

  it('surfaces a PERMISSION_DENIED code for a member without the required permission', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const dev = shell.registerUser('Dev')
      shell.assignRole(ws, dev, RoleId('dev'))
      bind('session-a', dev)

      const audit = await run('session-a', 'audit_query', { workspaceId: ws })
      expect(audit.isError).toBe(true)
      expect(audit.error?.info?.code).toBe('PERMISSION_DENIED')

      const register = await run('session-a', 'register_asset', {
        workspaceId: ws,
        kind: 'requirement',
        content: 'R1',
        roleId: 'product',
      })
      expect(register.isError).toBe(true)
      expect(register.error?.info?.code).toBe('PERMISSION_DENIED')
    } finally {
      await dispose(ctx)
    }
  })

  it('executing a tool without an agent session yields UNKNOWN_ACTOR', async () => {
    const { ctx } = await setup()
    try {
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('tools-spec-call'),
        name: 'register_asset',
        arguments: { workspaceId: 'ws-1', kind: 'requirement', content: 'R1', roleId: 'product' },
      })
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('UNKNOWN_ACTOR')
    } finally {
      await dispose(ctx)
    }
  })

  it('propagates a non-miss platform error from get_asset instead of hiding it', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      const mallory = shell.registerUser('Mallory')
      shell.assignRole(ws, alice, RoleId('product'))
      // Mallory stays a non-member of ws, so her read of ws's asset is denied.
      bind('session-a', alice)
      bind('session-b', mallory)

      await run('session-a', 'register_asset', {
        workspaceId: ws,
        kind: 'requirement',
        content: 'R1',
        roleId: 'product',
      })
      const read = await run('session-b', 'get_asset', { assetId: 'requirement-1' })
      expect(read.isError).toBe(true)
      expect(read.error?.info?.code).toBe('PERMISSION_DENIED')
    } finally {
      await dispose(ctx)
    }
  })

  it('approve_ticket reports an absent ticket as TICKET_NOT_FOUND', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', alice)

      const result = await run('session-a', 'approve_ticket', { ticketId: 'approval-99', to: 'review' })
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('TICKET_NOT_FOUND')
    } finally {
      await dispose(ctx)
    }
  })

  it('audit_query lists rows by workspace alone and omits the action filter', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', alice)

      await run('session-a', 'register_asset', {
        workspaceId: ws,
        kind: 'requirement',
        content: 'R1',
        roleId: 'product',
      })
      const events = await run('session-a', 'audit_query', { workspaceId: ws })
      expect(events.isError).toBe(false)
      const actions = (events.value as { events: { action: string }[] }).events.map(e => e.action)
      expect(actions).toContain('asset.register')
      expect(actions).toContain('rbac.membership.assign')
    } finally {
      await dispose(ctx)
    }
  })

  it('submit_ticket, link_asset, and the ticket query tools drive the lifecycle tools', async () => {
    const { ctx, shell, bind, sessionOf, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      const bob = shell.registerUser('Bob')
      shell.assignRole(ws, alice, RoleId('product'))
      shell.assignRole(ws, bob, RoleId('dev'))
      bind('session-a', alice)
      bind('session-b', bob)
      const sessionA = sessionOf('session-a')

      // list_tickets empty render branch.
      const empty = await run('session-a', 'list_tickets', { workspaceId: ws })
      expect(empty.isError).toBe(false)
      expect(empty.value).toMatchObject({ tickets: [] })

      const req = await run('session-a', 'register_asset', {
        workspaceId: ws,
        kind: 'requirement',
        content: 'R1',
        roleId: 'product',
      })
      const reqId = (req.value as { asset: { id: string } }).asset.id
      const code = await run('session-b', 'register_asset', {
        workspaceId: ws,
        kind: 'code',
        content: 'C1',
        roleId: 'dev',
      })
      const codeId = (code.value as { asset: { id: string } }).asset.id

      // link_asset records the lineage edge.
      const linked = await run('session-b', 'link_asset', { assetId: codeId, parentId: reqId })
      expect(linked.isError).toBe(false)
      expect(linked.value).toMatchObject({ ok: true })

      // submit_ticket creates a draft ticket and appends the initial transition.
      const submitted = await run('session-a', 'submit_ticket', { workspaceId: ws, subjectAssetId: reqId })
      expect(submitted.isError).toBe(false)
      expect(submitted.value).toMatchObject({ ticket: { status: 'draft' } })
      expect(submitted.meta).toMatchObject({ code: 'submitted' })
      const ticketId = (submitted.value as { ticket: { id: string } }).ticket.id
      const transitions = sessionA.events.filter(e => e.type === 'platform/approval/transition')
      expect(transitions[0]).toMatchObject({ data: { ticketId, from: null, to: 'draft' } })

      // get_ticket reads the committed ticket.
      const readTicket = await run('session-a', 'get_ticket', { ticketId })
      expect(readTicket.isError).toBe(false)
      expect(readTicket.value).toMatchObject({ ticket: { id: ticketId, status: 'draft' } })
      expect(readTicket.meta).toMatchObject({ code: 'read' })

      // get_ticket on an absent ticket surfaces TICKET_NOT_FOUND.
      const missingTicket = await run('session-a', 'get_ticket', { ticketId: 'approval-77' })
      expect(missingTicket.isError).toBe(true)
      expect(missingTicket.error?.info?.code).toBe('TICKET_NOT_FOUND')

      // list_tickets non-empty render branch.
      const listed = await run('session-a', 'list_tickets', { workspaceId: ws })
      expect(listed.isError).toBe(false)
      expect(listed.value).toMatchObject({ tickets: [{ id: ticketId }] })
      expect(listed.meta).toMatchObject({ code: 'listed', count: 1 })
    } finally {
      await dispose(ctx)
    }
  })

  it('asset_ancestors and asset_descendants trace the lineage chain', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      const bob = shell.registerUser('Bob')
      const carol = shell.registerUser('Carol')
      shell.assignRole(ws, alice, RoleId('product'))
      shell.assignRole(ws, bob, RoleId('dev'))
      shell.assignRole(ws, carol, RoleId('qa'))
      bind('session-a', alice)
      bind('session-b', bob)
      bind('session-c', carol)

      const req = await run('session-a', 'register_asset', {
        workspaceId: ws,
        kind: 'requirement',
        content: 'R1',
        roleId: 'product',
      })
      const reqId = (req.value as { asset: { id: string } }).asset.id
      const code = await run('session-b', 'register_asset', {
        workspaceId: ws,
        kind: 'code',
        content: 'C1',
        roleId: 'dev',
      })
      const codeId = (code.value as { asset: { id: string } }).asset.id
      const test = await run('session-c', 'register_asset', {
        workspaceId: ws,
        kind: 'test-case',
        content: 'T1',
        roleId: 'qa',
      })
      const testId = (test.value as { asset: { id: string } }).asset.id
      await run('session-b', 'link_asset', { assetId: codeId, parentId: reqId })
      await run('session-c', 'link_asset', { assetId: testId, parentId: codeId })

      // Empty branch of the ancestors render.
      const none = await run('session-c', 'asset_ancestors', { assetId: reqId })
      expect(none.isError).toBe(false)
      expect(none.value).toMatchObject({ edges: [] })

      // Non-empty ancestry: test-case derives from code derives from the requirement.
      const ancestors = await run('session-c', 'asset_ancestors', { assetId: testId })
      expect(ancestors.isError).toBe(false)
      expect(ancestors.meta).toMatchObject({ code: 'traced', count: 2 })
      const parentIds = (ancestors.value as { edges: { parentId: string }[] }).edges.map(e => e.parentId)
      expect(parentIds).toContain(codeId)
      expect(parentIds).toContain(reqId)

      // Empty branch of the descendants render.
      const noneDown = await run('session-c', 'asset_descendants', { assetId: testId })
      expect(noneDown.isError).toBe(false)
      expect(noneDown.value).toMatchObject({ edges: [] })

      // Non-empty descendants from the requirement toward the leaves.
      const descendants = await run('session-a', 'asset_descendants', { assetId: reqId })
      expect(descendants.isError).toBe(false)
      expect(descendants.meta).toMatchObject({ code: 'traced', count: 2 })
      const childIds = (descendants.value as { edges: { assetId: string }[] }).edges.map(e => e.assetId)
      expect(childIds).toContain(codeId)
      expect(childIds).toContain(testId)
    } finally {
      await dispose(ctx)
    }
  })

  it('approve_ticket grants no scope when only one of roles and expiresAt is given', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', alice)

      const asset = shell.registerAsset(alice, { workspaceId: ws, kind: 'requirement', content: 'R1', roleId: RoleId('product') })
      const ticket = shell.submitTicket(alice, ws, asset.id)
      // `roles` without `expiresAt` must not fabricate a review scope.
      const reviewed = await run('session-a', 'approve_ticket', { ticketId: ticket.id, to: 'review', roles: ['product'] })
      expect(reviewed.isError).toBe(false)
      expect(reviewed.value).toMatchObject({ ticket: { status: 'review', reviewScope: null } })
    } finally {
      await dispose(ctx)
    }
  })
})

describe('platform-shell market tools', () => {
  it('publish_capability and list_capabilities drive the catalog with reference events', async () => {
    const { ctx, shell, bind, sessionOf, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      bind('session-a', admin)
      const sessionA = sessionOf('session-a')

      const empty = await run('session-a', 'list_capabilities', {})
      expect(empty.isError).toBe(false)
      expect(empty.value).toMatchObject({ capabilities: [] })

      const base = await run('session-a', 'publish_capability', {
        id: 'base-llm',
        name: 'Base LLM',
        roleId: 'product',
        execution: 'managed',
        version: '2.0.0',
        rate: 3,
      })
      expect(base.isError).toBe(false)
      expect(base.value).toMatchObject({ capability: { id: 'base-llm', version: '2.0.0', rate: 3 } })
      expect(base.meta).toMatchObject({ code: 'published' })

      const rag = await run('session-a', 'publish_capability', {
        id: 'rag',
        name: 'RAG',
        roleId: 'product',
        execution: 'sandboxed',
        version: '1.0.0',
        rate: 2,
        dependencies: [{ id: 'base-llm', range: '>=2.0.0' }],
      })
      expect(rag.isError).toBe(false)
      expect(rag.value).toMatchObject({ capability: { id: 'rag', execution: 'sandboxed' } })

      const publishedEvents = sessionA.events.filter(e => e.type === 'capability/published')
      expect(publishedEvents).toHaveLength(2)
      expect(publishedEvents[0]).toMatchObject({ data: { capabilityId: 'base-llm', version: '2.0.0', roleId: 'product' } })

      const listed = await run('session-a', 'list_capabilities', {})
      expect(listed.isError).toBe(false)
      expect(listed.meta).toMatchObject({ code: 'listed', count: 2 })
    } finally {
      await dispose(ctx)
    }
  })

  it('rejects publishing against unknown dependency referents', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      bind('session-a', admin)

      const result = await run('session-a', 'publish_capability', {
        id: 'broken',
        name: 'Broken',
        roleId: 'product',
        execution: 'managed',
        version: '1.0.0',
        rate: 1,
        dependencies: [{ id: 'ghost-dep' }],
      })
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('CAPABILITY_NOT_FOUND')
    } finally {
      await dispose(ctx)
    }
  })

  it('assemble_capabilities resolves transitive dependencies and appends capability/selected', async () => {
    const { ctx, shell, bind, sessionOf, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', admin)
      bind('session-b', alice)
      const sessionB = sessionOf('session-b')

      await run('session-a', 'publish_capability', { id: 'base-llm', name: 'Base LLM', roleId: 'product', execution: 'managed', version: '2.0.0', rate: 3 })
      await run('session-a', 'publish_capability', { id: 'rag', name: 'RAG', roleId: 'product', execution: 'managed', version: '1.0.0', rate: 2, dependencies: [{ id: 'base-llm', range: '>=2.0.0' }] })
      await run('session-a', 'publish_scenario', {
        id: 'product-engineering',
        name: 'Product Engineering',
        workbenchId: 'product-engineering',
        roleId: 'product',
        preset: 'product-engineering',
        capabilityIds: ['base-llm', 'rag'],
      })

      const resolved = await run('session-b', 'assemble_capabilities', {
        workspaceId: ws,
        scenarioId: 'product-engineering',
        selected: ['rag'],
      })
      expect(resolved.isError).toBe(false)
      expect(resolved.value).toMatchObject({
        requested: ['rag'],
        resolved: [{ id: 'base-llm' }, { id: 'rag' }],
        preset: 'product-engineering',
      })
      expect(resolved.meta).toMatchObject({ code: 'resolved', count: 2 })
      const selected = sessionB.events.filter(e => e.type === 'capability/selected')
      expect(selected).toHaveLength(1)
      expect(selected[0]).toMatchObject({ data: { workspaceId: ws, capabilityIds: ['rag'], preset: 'product-engineering' } })
    } finally {
      await dispose(ctx)
    }
  })

  it('surfaces CAPABILITY_CONFLICT from assemble_capabilities', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', admin)
      bind('session-b', alice)

      await run('session-a', 'publish_capability', { id: 'sql-db', name: 'SQL', roleId: 'product', execution: 'managed', version: '1.0.0', rate: 1 })
      await run('session-a', 'publish_capability', { id: 'vector-db', name: 'Vector', roleId: 'product', execution: 'managed', version: '1.0.0', rate: 1, conflictsWith: ['sql-db'] })
      await run('session-a', 'publish_scenario', {
        id: 'db-stack', name: 'DB Stack', workbenchId: 'db-stack', roleId: 'product', preset: 'db-stack',
        capabilityIds: ['sql-db', 'vector-db'],
      })

      const result = await run('session-b', 'assemble_capabilities', {
        workspaceId: ws,
        scenarioId: 'db-stack',
        selected: ['sql-db', 'vector-db'],
      })
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('CAPABILITY_CONFLICT')
    } finally {
      await dispose(ctx)
    }
  })

  it('assemble_preset renders and validates a preset tree and appends preset/assembled', async () => {
    const { ctx, shell, bind, sessionOf, run } = await setup({
      resolveBaseRows: async () => [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'base persona' } },
      ],
    })
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', admin)
      bind('session-b', alice)
      const sessionB = sessionOf('session-b')

      // Rows are an operator-authored fragment of the publish request; the
      // publish tool's model surface omits them, so seed through the service.
      shell.publishCapability(admin, {
        id: CapabilityId('content-planning'),
        name: 'Content Planning', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1,
        tools: ['plan_content'],
        rows: [
          { id: 'content-planning', name: 'persona-row', config: { section: 'capability:content-planning', order: 10, text: 'plan' } },
        ],
      })
      shell.publishCapability(admin, {
        id: CapabilityId('content-publishing'),
        name: 'Content Publishing', roleId: RoleId('product'), execution: 'managed', version: '1.0.0', rate: 1,
        tools: ['publish_content'],
        rows: [
          { id: 'content-publishing', name: 'persona-row', config: { section: 'capability:content-publishing', order: 20, text: 'publish' } },
        ],
      })
      await run('session-a', 'publish_scenario', {
        id: 'content-marketing', name: 'Content Marketing', workbenchId: 'content-marketing',
        roleId: 'product', preset: 'content-marketing',
        capabilityIds: ['content-planning', 'content-publishing'],
      })

      const assembled = await run('session-b', 'assemble_preset', {
        workspaceId: ws,
        scenarioId: 'content-marketing',
        roleId: 'product',
        rolePreset: 'content-marketing',
        preset: 'assembled-content-marketing',
        selected: ['content-planning', 'content-publishing'],
      })
      expect(assembled.isError).toBe(false)
      expect(assembled.value).toMatchObject({
        preset: 'assembled-content-marketing',
        resolved: [{ id: 'content-planning' }, { id: 'content-publishing' }],
        report: { rowIdConflicts: [], toolNameConflicts: [], disabledOnPlatform: [] },
      })
      // Base rows first, capability rows appended in catalog order.
      const value = assembled.value as { rows: Array<{ id: string }> } | undefined
      const rows = value?.rows ?? []
      expect(rows.map(row => row.id)).toEqual(['persona', 'content-planning', 'content-publishing'])
      expect(assembled.meta).toMatchObject({ code: 'assembled', rows: 3 })

      const presetEvents = sessionB.events.filter(e => e.type === 'preset/assembled')
      expect(presetEvents).toHaveLength(1)
      expect(presetEvents[0]).toMatchObject({
        data: { workspaceId: ws, scenarioId: 'content-marketing', preset: 'assembled-content-marketing', capabilityIds: ['content-planning', 'content-publishing'], rows: [{ id: 'persona' }, { id: 'content-planning' }, { id: 'content-publishing' }] },
      })
    } finally {
      await dispose(ctx)
    }
  })

  it('refuses assemble_preset without a resolveBaseRows binding', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      bind('session-a', admin)

      const result = await run('session-a', 'assemble_preset', {
        workspaceId: ws,
        scenarioId: 'content-marketing',
        roleId: 'product',
        rolePreset: 'content-marketing',
        preset: 'assembled-content-marketing',
        selected: [],
      })
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('INVALID_ARGUMENT')
    } finally {
      await dispose(ctx)
    }
  })

  it('consume_capability, account_balance, and settle_account run the billing loop', async () => {
    const { ctx, shell, bind, sessionOf, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', admin)
      bind('session-b', alice)
      const sessionA = sessionOf('session-a')

      await run('session-a', 'publish_capability', { id: 'code-gen', name: 'Code Gen', roleId: 'product', execution: 'managed', version: '1.0.0', rate: 4 })
      // Funding is an operator service call; the model-facing surface only meters.
      shell.creditAccount(admin, ws, 100)

      const usage = await run('session-b', 'consume_capability', { workspaceId: ws, capabilityId: 'code-gen', qty: 2 })
      expect(usage.isError).toBe(false)
      expect(usage.value).toMatchObject({ usage: { cost: 8, qty: 2 } })
      expect(usage.meta).toMatchObject({ code: 'metered', cost: 8 })

      const balance = await run('session-a', 'account_balance', { workspaceId: ws })
      expect(balance.isError).toBe(false)
      expect(balance.value).toMatchObject({ found: true, account: { balance: 92 } })
      expect(balance.meta).toMatchObject({ code: 'read' })

      const settled = await run('session-a', 'settle_account', { workspaceId: ws, period: periodOf(Date.now()) })
      expect(settled.isError).toBe(false)
      expect(settled.value).toMatchObject({ settlement: { status: 'settled', amount: 8 } })
      expect(settled.meta).toMatchObject({ code: 'settled' })
      const settlementEvents = sessionA.events.filter(e => e.type === 'billing/settlement')
      expect(settlementEvents).toHaveLength(1)
      expect(settlementEvents[0]).toMatchObject({ data: { workspaceId: ws, period: periodOf(Date.now()), status: 'settled' } })
    } finally {
      await dispose(ctx)
    }
  })

  it('refuses a disabled capability and an overdraft with structured codes', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      const alice = shell.registerUser('Alice')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      shell.assignRole(ws, alice, RoleId('product'))
      bind('session-a', admin)
      bind('session-b', alice)

      await run('session-a', 'publish_capability', { id: 'premium', name: 'Premium', roleId: 'product', execution: 'managed', version: '1.0.0', rate: 10 })
      await run('session-a', 'set_capability_gate', { capabilityId: 'premium', enabled: false, rollout: 1 })
      shell.creditAccount(admin, ws, 20)

      const gated = await run('session-b', 'consume_capability', { workspaceId: ws, capabilityId: 'premium' })
      expect(gated.isError).toBe(true)
      expect(gated.error?.info?.code).toBe('CAPABILITY_DISABLED')

      await run('session-a', 'set_capability_gate', { capabilityId: 'premium', enabled: true, rollout: 1 })
      const overdraft = await run('session-b', 'consume_capability', { workspaceId: ws, capabilityId: 'premium', qty: 3 })
      expect(overdraft.isError).toBe(true)
      expect(overdraft.error?.info?.code).toBe('INSUFFICIENT_BALANCE')
    } finally {
      await dispose(ctx)
    }
  })

  it('reports account_balance as not-found before an account exists', async () => {
    const { ctx, shell, bind, run } = await setup()
    try {
      const ws = shell.createWorkspace('Platform')
      const admin = shell.registerUser('Admin')
      shell.assignRole(ws, admin, RoleId('platform-admin'))
      bind('session-a', admin)

      const balance = await run('session-a', 'account_balance', { workspaceId: ws })
      expect(balance.isError).toBe(false)
      expect(balance.value).toMatchObject({ found: false, account: { balance: 0 } })
      expect(balance.meta).toMatchObject({ code: 'not-found' })
    } finally {
      await dispose(ctx)
    }
  })
})
