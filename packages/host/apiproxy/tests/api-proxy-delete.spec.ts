/** session.delete RPC: visibility gate, success, and live-refusal mapping. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { SessionDeletionError } from '@deepseek-ai/dsh-session-deletion'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`delete-${String(nextRpc++)}`), payload }
}

interface Stub {
  deleteSession: ReturnType<typeof vi.fn>
}

/** Boot the api proxy with a stubbed deletion seam and one visible live session. */
async function composed(
  deleteSession: Stub['deleteSession'] = vi.fn(async () => ({ deleted: [], notFound: [] })),
): Promise<{ ctx: Context; deleteSession: Stub['deleteSession'] }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionDeletion', { deleteSession, listDeletions: vi.fn() } as never)
  return { ctx, deleteSession }
}

function apiProxy(ctx: Context): ReturnType<typeof createApiProxy> {
  return createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
  })
}

describe('session.delete RPC', () => {
  it('deletes a visible session and returns the scope outcome', async () => {
    const { ctx, deleteSession } = await composed(
      vi.fn(async () => ({ deleted: [sid('visible')], notFound: [] })),
    )
    ctx.sessions.create(sid('visible'), { meta: { cwd: '/work' } })
    const api = apiProxy(ctx)

    const response = await api.sessions.delete(request({ sessionId: sid('visible') }))
    expect(response.result).toEqual({ ok: true, value: { deleted: [sid('visible')], notFound: [] } })
    expect(deleteSession).toHaveBeenCalledWith(sid('visible'))
  })

  it('refuses a session invisible to list with session-not-found', async () => {
    const { ctx, deleteSession } = await composed()
    const api = apiProxy(ctx)

    const response = await api.sessions.delete(request({ sessionId: sid('ghost') }))
    if (!response.result.ok) {
      expect(response.result.error.code).toBe('session-not-found')
    } else {
      throw new Error('expected session-not-found')
    }
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('surfaces a clear error when the deletion seam is not composed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    ctx.sessions.create(sid('visible'), { meta: { cwd: '/work' } })
    const api = apiProxy(ctx)

    const response = await api.sessions.delete(request({ sessionId: sid('visible') }))
    if (!response.result.ok) {
      expect(response.result.error.code).toBe('internal')
      expect(response.result.error.message).toContain('not composed')
    } else {
      throw new Error('expected internal')
    }
  })

  it('maps a live-tree refusal to session-live with the member ids', async () => {
    const liveId = sid('live-member')
    const { ctx, deleteSession } = await composed(
      vi.fn(async () => { throw new SessionDeletionError('live', [liveId]) }),
    )
    ctx.sessions.create(sid('visible'), { meta: { cwd: '/work' } })
    const api = apiProxy(ctx)

    const response = await api.sessions.delete(request({ sessionId: sid('visible') }))
    if (!response.result.ok) {
      expect(response.result.error.code).toBe('session-live')
      if ('liveSessions' in response.result.error.details) {
        expect(response.result.error.details.liveSessions).toEqual([liveId])
      }
    } else {
      throw new Error('expected session-live')
    }
    expect(deleteSession).toHaveBeenCalledWith(sid('visible'))
  })
})
