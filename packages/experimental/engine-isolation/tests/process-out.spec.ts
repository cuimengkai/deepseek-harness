import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell/src/types.ts'
import { EngineIsolationError } from '../src/error.ts'
import { ProcessOutEngineDriver, parseWorkerResult, type ProcessOutConfig } from '../src/process-out.ts'
import type { AgentRunRequest } from '../src/types.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fixture = (name: string): string => join(packageRoot, 'tests', 'fixtures', name)

const dirs: string[] = []
afterEach(async () => {
  for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function scratch(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(directory)
  return directory
}

async function start(
  configOverrides: Partial<ProcessOutConfig> = {},
): Promise<{ ctx: Context; driver: ProcessOutEngineDriver; storeRoot: string; logRoot: string }> {
  const ctx = new Context()
  const spillDir = await scratch('engine-isolation-spill-')
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  const storeRoot = await scratch('engine-isolation-store-')
  const logRoot = await scratch('engine-isolation-log-')
  const driver = new ProcessOutEngineDriver(ctx, {
    workerScript: fixture('worker.mjs'),
    storeRoot,
    logRoot,
    cwd: packageRoot,
    graceMs: 10_000,
    ...configOverrides,
  })
  return { ctx, driver, storeRoot, logRoot }
}

async function dispose(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
}

const sessionId = SessionId('session-processout')
const workspaceId = WorkspaceId('ws-processout')

function request(): AgentRunRequest {
  return { sessionId, workspaceId, drive: { prompt: 'drive the isolated workspace', provider: 'mock', model: 'mock-1', cwd: packageRoot } }
}

describe('ProcessOutEngineDriver', () => {
  it('spawns a dedicated child engine and returns its reported handle', async () => {
    const { ctx, driver, storeRoot, logRoot } = await start()
    try {
      const handle = await driver.drive(request())
      expect(handle).toEqual({
        sessionId,
        workspaceId,
        pid: expect.any(Number) as number,
        status: 'completed',
        storePath: join(storeRoot, 'ws-processout', 'platform.sqlite'),
        logRoot: join(logRoot, 'ws-processout'),
      })
      expect(handle.pid).toBeGreaterThan(0)
      expect(handle.pid).not.toBe(process.pid)
    } finally {
      await dispose(ctx)
    }
  })

  it('commits a durable session log the driver can read back', async () => {
    const { ctx, driver } = await start()
    try {
      await driver.drive(request())
      const events = await driver.readLog(sessionId)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'turn/start', data: { turn: 1 } })
      const sessions = await driver.listSessions(workspaceId)
      expect(sessions).toEqual([sessionId])
    } finally {
      await dispose(ctx)
    }
  })

  it('throws ENGINE_SPAWN_FAILED when the child engine exits non-zero', async () => {
    const { ctx, driver } = await start({ workerScript: fixture('worker-fail.mjs') })
    try {
      await expect(driver.drive(request())).rejects.toMatchObject({ code: 'ENGINE_SPAWN_FAILED' })
    } finally {
      await dispose(ctx)
    }
  })

  it('throws ENGINE_SPAWN_FAILED when the child prints no valid result line', async () => {
    const { ctx, driver } = await start({ workerScript: fixture('worker-fail.mjs') })
    try {
      await expect(driver.drive(request())).rejects.toThrow(EngineIsolationError)
    } finally {
      await dispose(ctx)
    }
  })

  it('has the process-out engine kind', async () => {
    const { ctx, driver } = await start()
    try {
      expect(driver.kind).toBe('process-out')
    } finally {
      await dispose(ctx)
    }
  })
})

describe('parseWorkerResult', () => {
  it('parses the single result line from collected stdout', () => {
    expect(parseWorkerResult('junk\n{"ok":true,"sessionId":"s1","pid":42,"storePath":"/s","logRoot":"/l"}\n')).toEqual({
      ok: true,
      sessionId: 's1',
      pid: 42,
      storePath: '/s',
      logRoot: '/l',
    })
  })

  it('throws on empty stdout', () => {
    expect(() => parseWorkerResult('')).toThrow(EngineIsolationError)
  })

  it('throws on a non-JSON result line', () => {
    expect(() => parseWorkerResult('not json')).toThrow(EngineIsolationError)
  })

  it('throws on a JSON line missing a required field', () => {
    expect(() => parseWorkerResult('{"ok":true,"sessionId":"s1"}')).toThrow(EngineIsolationError)
  })
})
