import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { PlatformShellService } from '../src/service.ts'
import { registerPlatformShellTools } from '../src/tools.ts'
import { PlatformShellError } from '../src/error.ts'
import { RoleId, UserId } from '../src/types.ts'

/**
 * Mount the tools topology: session store, tool runtime, the platform-shell
 * service, and the shell tools with an in-memory session→actor binding.
 * @returns the context, service, and a helper executing tools on a named session.
 */
async function setup() {
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
      runMaintenance: () => Promise.resolve(),
      whenIdle: () => Promise.resolve(),
    }
    return ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('tools-spec-call'),
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
      expect(shell.assetExists('requirement-1')).toBe(true)
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
        callId: CallId('tools-spec-call'),
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
