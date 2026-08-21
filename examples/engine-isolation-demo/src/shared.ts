/**
 * Shared drive glue for engine-isolation-demo: the host demo driver and the
 * process-out child worker both wait on the same agent-loop status events and
 * read persisted JSONL logs back, so the durable-read surface stays identical
 * across process boundaries. This is example glue, not a package; keep it here
 * only while both processes consume it.
 * @module engine-isolation-demo-shared
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Wait until an agent reaches the given status, then resolve.
 * @param ctx - context carrying the agent-loop status stream.
 * @param agent - the agent to watch.
 * @param target - the status name that settles the wait.
 * @returns a promise resolving on the target status.
 */
export function waitForStatus(ctx: Context, agent: Agent, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      dispose()
      reject(new Error(`agent ${agent.session.id} never reached ${target}`))
    }, 60_000)
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent) return
      if (status === target) {
        clearTimeout(timeout)
        dispose()
        resolve()
      }
    })
  })
}

/**
 * Resolve the Agent handle for one created agent by session id.
 * @param ctx - context carrying the agent registry.
 * @param sessionId - the agent-loop session id.
 * @returns the registered agent, or undefined when absent.
 */
export function findAgent(ctx: Context, sessionId: string): Agent | undefined {
  return ctx.agents.get(SessionId(sessionId))
}

/**
 * Read one session's persisted JSONL log back from a session-persistence root
 * (the traceability surface, shared across process boundaries).
 * @param persistenceRoot - the JSONL backend root to search.
 * @param sessionId - the session whose log to read.
 * @returns the persisted events, or an empty list when absent.
 */
export async function readPersistedEvents(persistenceRoot: string, sessionId: string): Promise<SessionEvent[]> {
  const files = await readdir(persistenceRoot, { recursive: true })
  const logFile = files.find(file => file.includes(sessionId) && file.endsWith('.jsonl'))
  if (logFile === undefined) return []
  const raw = await readFile(join(persistenceRoot, logFile), 'utf8')
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as SessionEvent)
}
