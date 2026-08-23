import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { FlowRunSnapshot } from '@deepseek-ai/dsh-flow/types'

const binScript = fileURLToPath(new URL('./fixtures/flow-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/flow.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface WireEvent {
  type: string
  [key: string]: unknown
}

/** Boot the real Loader tree once and run one branch of the demo flow. */
async function runBranch(branch: 'go' | 'no-go'): Promise<{ events: WireEvent[]; result: WireEvent }> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `flow-demo-${branch}`,
    tempDirPrefix: `flow-demo-${branch}-`,
    binScript,
    libBinScript: binScript,
    configPath,
    binArgs: [configPath, branch],
    tsconfigPath,
    env: {},
  })
  expect(stderr).toBe('')
  const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as WireEvent)
  expect(lines.length).toBeGreaterThan(0)
  const events = lines.slice(0, -1)
  const result = lines.at(-1)!
  expect(result.type).toBe('result')
  return { events, result }
}

/** Child attribution events, keyed by the agent node phase. */
function startsByPhase(events: WireEvent[]): Map<string, WireEvent> {
  const byPhase = new Map<string, WireEvent>()
  for (const event of events.filter(event => event.type === 'agent_start')) {
    byPhase.set(String(event.phase), event)
  }
  return byPhase
}

describe('flow demo keyless smoke', () => {
  it('routes the condition to the true branch (go=true): B runs, C stays pending', async () => {
    const { events, result } = await runBranch('go')

    const starts = startsByPhase(events)
    expect([...starts.keys()].sort()).toEqual(['a', 'b'])
    expect(new Set([...starts.values()].map(start => start.childId)).size).toBe(2)
    expect(events.filter(event => event.type === 'agent_end').map(event => event.outcome)).toEqual(['completed', 'completed'])

    expect(result.outcome).toEqual({ status: 'completed', agentsStarted: 2 })
    const snapshot = result.snapshot as unknown as FlowRunSnapshot
    expect(snapshot.status).toBe('completed')
    expect(snapshot.stopReason).toBe('completed')
    expect(snapshot.agentsStarted).toBe(2)
    expect(snapshot.nodeStatuses).toEqual({
      start: 'done',
      a: 'done',
      condition: 'done',
      b: 'done',
      c: 'pending',
      end: 'done',
    })
  })

  it('routes the condition to the false branch (go=false): C runs, B stays pending', async () => {
    const { events, result } = await runBranch('no-go')

    const starts = startsByPhase(events)
    expect([...starts.keys()].sort()).toEqual(['a', 'c'])
    expect(new Set([...starts.values()].map(start => start.childId)).size).toBe(2)

    expect(result.outcome).toEqual({ status: 'completed', agentsStarted: 2 })
    const snapshot = result.snapshot as unknown as FlowRunSnapshot
    expect(snapshot.nodeStatuses).toEqual({
      start: 'done',
      a: 'done',
      condition: 'done',
      b: 'pending',
      c: 'done',
      end: 'done',
    })
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
