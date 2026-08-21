import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionDeletionError } from '@deepseek-ai/dsh-session-deletion'
import * as commandSessionDelete from '@deepseek-ai/dsh-command-session-delete'

const DELETED_ID = SessionId('deleted-session')

async function harness(): Promise<{ ctx: Context; deleteSession: ReturnType<typeof vi.fn> }> {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  const deleteSession = vi.fn(async () => ({ deleted: [DELETED_ID], notFound: [] }))
  ctx.provide('sessionDeletion', { deleteSession, listDeletions: vi.fn() } as never)
  await ctx.plugin(commandSessionDelete)
  return { ctx, deleteSession }
}

function agent(): Agent {
  const session = Session.create(SessionId('command-session-delete'))
  return {
    session,
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
}

async function run(
  ctx: Context,
  agent: Agent,
  input: string,
): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>> {
  const execution = await ctx.commands.execute(agent, input, [], new AbortController().signal)
  if (execution === undefined) throw new Error('session-delete command was not registered')
  return execution
}
describe('command-session-delete', () => {
  it('deletes the named session and reports the count', async () => {
    const { ctx, deleteSession } = await harness()
    const { result } = await run(ctx, agent(), '/session-delete deleted-session')
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.text).toBe('Deleted 1 session(s).')
    }
    expect(deleteSession).toHaveBeenCalledWith(DELETED_ID)
  })

  it('reports a session that has no durable artifact as not found', async () => {
    const { ctx, deleteSession } = await harness()
    deleteSession.mockResolvedValueOnce({ deleted: [], notFound: [DELETED_ID] })
    const { result } = await run(ctx, agent(), '/session-delete deleted-session')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain('not found')
    }
  })

  it('maps a live-tree refusal to a human outcome', async () => {
    const { ctx, deleteSession } = await harness()
    deleteSession.mockRejectedValueOnce(new SessionDeletionError('live', [DELETED_ID]))
    const { result } = await run(ctx, agent(), '/session-delete deleted-session')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain('Cannot delete running session(s)')
      expect(result.text).toContain('deleted-session')
    }
  })

  it('requires exactly one session id argument', async () => {
    const { ctx, deleteSession } = await harness()
    for (const input of ['/session-delete', '/session-delete a b']) {
      const { result } = await run(ctx, agent(), input)
      expect(result.kind).toBe('error')
      if (result.kind === 'error') {
        expect(result.text).toContain('Usage: /session-delete')
      }
    }
    expect(deleteSession).not.toHaveBeenCalled()
  })
})
