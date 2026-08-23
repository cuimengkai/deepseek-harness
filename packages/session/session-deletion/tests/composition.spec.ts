/**
 * Real-composition guard for stop-then-delete: the agent-loop factory, real
 * JSONL persistence, and cascade deletion boot together; deleting a used
 * agent's session disposes the live agent and removes its durable log.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SessionDeletion from '../src/index.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function mountComposition(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delete-composition-'))
  dirs.push(root)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionDeletion)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('ok')]))
  return ctx
}

describe('session deletion over a live agent composition', () => {
  it('disposes a used agent and removes its durable log (stop-then-delete)', async () => {
    const ctx = await mountComposition()
    try {
      const id = SessionId('drop-live')
      const agent = ctx.agentLoop.create(id, { provider: 'mock', model: 'mock' }, { cwd: '/work' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)

      expect(ctx.agents.get(id)).toBe(agent)
      expect(ctx.sessions.get(id)).toBe(agent.session)
      expect((await ctx.sessionPersistence.list()).map(header => header.id)).toEqual([id])

      const result = await ctx.sessionDeletion.deleteSession(id)
      expect(result).toEqual({ deleted: [id], notFound: [] })

      // The agent and its session left the registries; the durable log is gone.
      expect(ctx.agents.get(id)).toBeUndefined()
      expect(ctx.sessions.get(id)).toBeUndefined()
      expect(await ctx.sessionPersistence.list()).toEqual([])
      const [record] = ctx.sessionDeletion.listDeletions()
      expect(record?.id).toBe(id)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
