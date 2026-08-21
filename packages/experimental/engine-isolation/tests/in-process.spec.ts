import { describe, expect, it } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell/src/types.ts'
import { InProcessEngineDriver, type EngineRunner, type InProcessConfig } from '../src/in-process.ts'
import type { AgentRunRequest } from '../src/types.ts'

const sessionId = SessionId('session-inproc')
const workspaceId = WorkspaceId('ws-inproc')

function request(): AgentRunRequest {
  return { sessionId, workspaceId, drive: { prompt: 'run', provider: 'mock', model: 'mock-1', cwd: '/tmp' } }
}

function config(overrides: Partial<InProcessConfig> = {}): InProcessConfig {
  const run: EngineRunner = async () => {}
  const readLog = async (_id: SessionId): Promise<readonly SessionEvent[]> => []
  const listSessions = async (): Promise<readonly SessionId[]> => []
  return { run, storePath: '/shared/store.sqlite', logRoot: '/shared/logs', readLog, listSessions, ...overrides }
}

describe('InProcessEngineDriver', () => {
  it('drives through the runner and reports the current process as the engine', async () => {
    const calls: AgentRunRequest[] = []
    const driver = new InProcessEngineDriver(config({ run: async (req) => { calls.push(req) } }))
    const handle = await driver.drive(request())
    expect(calls).toEqual([request()])
    expect(handle).toEqual({
      sessionId,
      workspaceId,
      pid: process.pid,
      status: 'completed',
      storePath: '/shared/store.sqlite',
      logRoot: '/shared/logs',
    })
  })

  it('reports a run the runner started but failed as status failed in-band', async () => {
    const driver = new InProcessEngineDriver(config({ run: async () => { throw new Error('engine failure') } }))
    const handle = await driver.drive(request())
    expect(handle.status).toBe('failed')
    expect(handle.pid).toBe(process.pid)
  })

  it('delegates listSessions to the configured in-process closure', async () => {
    const listSessions = async (): Promise<readonly SessionId[]> => [SessionId('s1'), SessionId('s2')]
    const driver = new InProcessEngineDriver(config({ listSessions }))
    await expect(driver.listSessions(workspaceId)).resolves.toEqual([SessionId('s1'), SessionId('s2')])
  })

  it('delegates readLog to the configured in-process closure', async () => {
    const event: SessionEvent = { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } }
    const readLog = async (id: SessionId): Promise<readonly SessionEvent[]> => (id === sessionId ? [event] : [])
    const driver = new InProcessEngineDriver(config({ readLog }))
    await expect(driver.readLog(sessionId)).resolves.toEqual([event])
    await expect(driver.readLog(SessionId('other'))).resolves.toEqual([])
  })

  it('has the in-process engine kind', () => {
    expect(new InProcessEngineDriver(config()).kind).toBe('in-process')
  })
})
