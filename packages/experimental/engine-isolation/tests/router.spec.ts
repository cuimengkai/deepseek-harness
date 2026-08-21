import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { PlatformShellService } from '@deepseek-ai/dsh-experimental-platform-shell/src/service.ts'
import { RoleId, WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell/src/types.ts'
import { resolveEngineDriver, type DriverSet } from '../src/router.ts'
import type { EngineDriver, EngineKind } from '../src/types.ts'

function fakeDriver(kind: EngineKind): EngineDriver {
  return {
    kind,
    drive: async () => { throw new Error(`fake ${kind} driver must not drive in a router spec`) },
    listSessions: async () => [],
    readLog: async () => [],
  }
}

async function start(): Promise<{ ctx: Context; shell: PlatformShellService; drivers: DriverSet }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(PlatformShellService, { path: ':memory:' })
  const inProcess = fakeDriver('in-process')
  const processOut = fakeDriver('process-out')
  return { ctx, shell: ctx.platformShell, drivers: { inProcess, processOut } }
}

async function dispose(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
}

describe('resolveEngineDriver', () => {
  it('routes a shared workspace to the in-process driver', async () => {
    const { ctx, shell, drivers } = await start()
    try {
      const shared = shell.createWorkspace('Shared')
      expect(resolveEngineDriver(ctx, drivers, shared)).toBe(drivers.inProcess)
    } finally {
      await dispose(ctx)
    }
  })

  it('routes an isolated workspace to the process-out driver', async () => {
    const { ctx, shell, drivers } = await start()
    try {
      const isolated = shell.createWorkspace('Isolated', { isolated: true })
      expect(resolveEngineDriver(ctx, drivers, isolated)).toBe(drivers.processOut)
    } finally {
      await dispose(ctx)
    }
  })

  it('re-routes a workspace after its isolation record flips', async () => {
    const { ctx, shell, drivers } = await start()
    try {
      const workspace = shell.createWorkspace('Flippable')
      const admin = shell.registerUser('Admin')
      shell.assignRole(workspace, admin, RoleId('platform-admin'))
      expect(resolveEngineDriver(ctx, drivers, workspace)).toBe(drivers.inProcess)
      shell.setWorkspaceIsolation(admin, workspace, true)
      expect(resolveEngineDriver(ctx, drivers, workspace)).toBe(drivers.processOut)
      shell.setWorkspaceIsolation(admin, workspace, false)
      expect(resolveEngineDriver(ctx, drivers, workspace)).toBe(drivers.inProcess)
    } finally {
      await dispose(ctx)
    }
  })

  it('fails loud for an unknown workspace', async () => {
    const { ctx, shell, drivers } = await start()
    try {
      shell.createWorkspace('Known')
      expect(() => resolveEngineDriver(ctx, drivers, WorkspaceId('ws-ghost'))).toThrow()
    } finally {
      await dispose(ctx)
    }
  })
})
