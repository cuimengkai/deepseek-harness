import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PlatformShellService } from '../src/service.ts'
import { registerCapabilityExecutionGate } from '../src/execution-gate.ts'
import { PlatformShellError } from '../src/error.ts'
import { CapabilityId, RoleId, UserId, WorkspaceId } from '../src/types.ts'

/**
 * Mount the runtime-gate topology: session store, tool runtime, the platform
 * service, one demo-owned gated tool (`analyze_code`), and the execution gate
 * with an in-memory session→workspace binding.
 * @returns the context, service, and helpers for gating one tool call.
 */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(PlatformShellService, { path: ':memory:' })
  const shell = ctx.platformShell
  const workspaces = new Map<string, WorkspaceId>()

  ctx.tools.register(defineTool({
    name: 'analyze_code',
    description: 'Analyze a code snippet (gated by the code-analysis capability).',
    parameters: { code: { type: 'string', required: true, description: 'the source code to analyze' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lineCount: { type: 'number', required: true },
          finding: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `analyzed ${value.lineCount} lines` }],
    },
    async execute(args) {
      return { lineCount: args.code.split('\n').length, finding: 'no blocking issues' }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'ungated_probe',
    description: 'A tool no capability owns; the gate must delegate it unchanged.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true } },
      },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute() {
      return { ok: true }
    },
  }))
  registerCapabilityExecutionGate(ctx, {
    resolveWorkspace: (session) => {
      const workspace = workspaces.get(String(session.id))
      if (workspace === undefined) {
        throw new PlatformShellError('UNKNOWN_WORKSPACE', `no platform workspace bound to session ${session.id}`)
      }
      return workspace
    },
  })

  const bindWorkspace = (sessionId: string, workspaceId: WorkspaceId): void => {
    workspaces.set(sessionId, workspaceId)
  }

  /** Resolve the live session for one named agent, creating it on first use. */
  const sessionOf = (sessionId: string): Session =>
    ctx.sessions.get(SessionId(sessionId)) ?? ctx.sessions.create(SessionId(sessionId))

  /** Execute one tool as one session's agent. */
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
      inject: () => { throw new Error('unused in execution-gate spec') },
      cancel() {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
    return ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(`gate-call-${name}`),
      name,
      arguments: args,
      agent,
    })
  }

  return { ctx, shell, bindWorkspace, run }
}

async function dispose(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
}

/** Seed the market: one workspace, an admin, and code-analysis owning analyze_code. */
function seedGate(
  shell: PlatformShellService,
): { ws: WorkspaceId; admin: UserId } {
  const ws = shell.createWorkspace('Platform')
  const admin = shell.registerUser('Admin')
  shell.assignRole(ws, admin, RoleId('platform-admin'))
  shell.publishCapability(admin, {
    id: CapabilityId('code-analysis'),
    name: 'Code Analysis',
    roleId: RoleId('product'),
    execution: 'managed',
    version: '1.0.0',
    rate: 3,
    tools: ['analyze_code'],
  })
  return { ws, admin }
}

describe('runtime capability execution gate', () => {
  it('admits a gated tool while the gate is open and refuses it at invocation once closed', async () => {
    const { ctx, shell, bindWorkspace, run } = await setup()
    try {
      const { ws, admin } = seedGate(shell)
      bindWorkspace('session-a', ws)

      const open = await run('session-a', 'analyze_code', { code: 'const x = 1' })
      expect(open.isError).toBe(false)
      expect(open.value).toMatchObject({ lineCount: 1 })

      shell.setCapabilityGate(admin, CapabilityId('code-analysis'), { enabled: false, rollout: 1 })
      const closed = await run('session-a', 'analyze_code', { code: 'const y = 2' })
      expect(closed.isError).toBe(true)
      expect(closed.error?.info?.code).toBe('CAPABILITY_DISABLED')
      expect(closed.error?.message).toContain('code-analysis')
    } finally {
      await dispose(ctx)
    }
  })

  it('re-checks the rollout fraction per workspace, not from a cached snapshot', async () => {
    const { ctx, shell, bindWorkspace, run } = await setup()
    try {
      const { ws, admin } = seedGate(shell)
      bindWorkspace('session-a', ws)
      // Rollout 0 refuses every workspace; the gate must observe the flip live.
      shell.setCapabilityGate(admin, CapabilityId('code-analysis'), { enabled: true, rollout: 0 })
      const refused = await run('session-a', 'analyze_code', { code: 'const x = 1' })
      expect(refused.isError).toBe(true)
      expect(refused.error?.info?.code).toBe('CAPABILITY_DISABLED')
      shell.setCapabilityGate(admin, CapabilityId('code-analysis'), { enabled: true, rollout: 1 })
      const admitted = await run('session-a', 'analyze_code', { code: 'const x = 1' })
      expect(admitted.isError).toBe(false)
    } finally {
      await dispose(ctx)
    }
  })

  it('delegates unowned tools and refuses an unbound workspace loudly', async () => {
    const { ctx, shell, bindWorkspace, run } = await setup()
    try {
      const { ws } = seedGate(shell)
      bindWorkspace('session-a', ws)
      const probe = await run('session-a', 'ungated_probe', {})
      expect(probe.isError).toBe(false)

      // A gated tool from a session with no workspace binding fails loud with
      // UNKNOWN_WORKSPACE, never silently ungated.
      const unbound = await run('session-unbound', 'analyze_code', { code: 'const z = 3' })
      expect(unbound.isError).toBe(true)
      expect(unbound.error?.info?.code).toBe('UNKNOWN_WORKSPACE')
    } finally {
      await dispose(ctx)
    }
  })
})
