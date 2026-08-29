/**
 * The context-composition read controller: a landed read renders `ready`
 * (or `empty` when the session has no requests and no surface rows); a
 * rejected or `ok:false` read surfaces as an error; a newer load or dispose
 * supersedes every older in-flight read via the generation counter.
 */

import { describe, expect, it } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ContextComposition } from '@deepseek-ai/dsh-context-composition/types'
import { ContextCompositionController } from '../src/client/context-store.ts'

const SID = 's-1' as SessionId

/** A minimal landed composition: one user row and a known capacity. */
const COMPOSITION: ContextComposition = {
  logRevision: 4,
  envelope: {
    provider: 'mock',
    model: 'm-1',
    system: 'You are a test.',
    systemTokens: 5,
    tools: [{ name: 'read', tokens: 12 }],
    toolsTokens: 12,
  },
  surface: [{ seq: 3, role: 'user', tokens: 10, preview: 'hello' }],
  surfaceTokens: 10,
  contextWindow: 32_000,
  compactions: [],
}

/** A wire whose read promises the test settles by hand, in order. */
function readWire() {
  const pending: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = []
  const calls: { sessionId: SessionId }[] = []
  const wire = {
    contextComposition: {
      read: (request: { sessionId: SessionId }) => {
        calls.push(request)
        return new Promise((resolve, reject) => pending.push({ resolve, reject }))
      },
    },
  } as unknown as Pick<ClientRemote, 'contextComposition'>
  return {
    wire,
    calls,
    answerOk: (value: ContextComposition): void => {
      const slot = pending.shift()!
      slot.resolve({ ok: true as const, value })
    },
    answerErr: (message: string): void => {
      const slot = pending.shift()!
      slot.resolve({ ok: false as const, error: { code: 'internal', message } })
    },
    rejectLast: (error: Error): void => {
      const slot = pending.shift()!
      slot.reject(error)
    },
  }
}

/** Flush the microtask chain an awaited read continuation runs on. */
const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

/** One controller over the hand-settled wire, with its store snapshot read out. */
function controller() {
  const { wire, calls, answerOk, answerErr, rejectLast } = readWire()
  const subject = new ContextCompositionController(wire, SID)
  return {
    subject,
    calls,
    answerOk,
    answerErr,
    rejectLast,
    state: () => subject.store.getSnapshot(),
  }
}

describe('the context-composition read controller', () => {
  it('starts idle and stays idle until load', () => {
    const { state } = controller()
    expect(state()).toEqual({ status: 'idle', error: null, composition: null })
  })

  it('addresses the bound session id on every read', async () => {
    const { subject, calls, answerOk, state } = controller()
    subject.load()
    expect(calls).toEqual([{ sessionId: SID }])
    answerOk(COMPOSITION)
    await flush()
    expect(state().status).toBe('ready')
  })

  it('marks the read loading until the wire answers', () => {
    const { subject, state } = controller()
    subject.load()
    expect(state()).toMatchObject({ status: 'loading', error: null })
  })

  it('renders ready with the landed composition', async () => {
    const { subject, answerOk, state } = controller()
    subject.load()
    answerOk(COMPOSITION)
    await flush()
    expect(state()).toEqual({ status: 'ready', error: null, composition: COMPOSITION })
  })

  it('renders empty when the session has no requests and no surface rows', async () => {
    const { subject, answerOk, state } = controller()
    subject.load()
    answerOk({
      logRevision: 0,
      envelope: null,
      surface: [],
      surfaceTokens: 0,
      contextWindow: null,
      compactions: [],
    })
    await flush()
    expect(state()).toMatchObject({ status: 'empty', error: null })
  })

  it('surfaces an ok:false read as an error with the wire message', async () => {
    const { subject, answerErr, state } = controller()
    subject.load()
    answerErr('session is not live')
    await flush()
    expect(state()).toEqual({ status: 'error', error: 'session is not live (internal)', composition: null })
  })

  it('surfaces a transport rejection as an error', async () => {
    const { subject, rejectLast, state } = controller()
    subject.load()
    rejectLast(new Error('network down'))
    await flush()
    expect(state()).toEqual({ status: 'error', error: 'network down', composition: null })
  })

  it('does not start a second read while one is in flight', () => {
    const { subject, calls } = controller()
    subject.load()
    subject.load()
    expect(calls).toHaveLength(1)
  })

  it('discards an older in-flight read after a dispose', async () => {
    const { subject, answerOk, state } = controller()
    subject.load()
    subject.dispose()
    answerOk(COMPOSITION)
    await flush()
    expect(state()).toEqual({ status: 'idle', error: null, composition: null })
  })

  it('discards an older in-flight read after a newer load supersedes it', async () => {
    const { subject, answerOk, state } = controller()
    subject.load()
    subject.dispose()
    subject.load()
    // The first (stale) read resolves; the second (current) read is still
    // pending, so the snapshot must stay on loading, not the stale value.
    answerOk(COMPOSITION)
    await flush()
    expect(state().status).toBe('loading')
  })

  it('restarts a fresh read cleanly after a dispose', async () => {
    const { subject, answerOk, state } = controller()
    subject.load()
    subject.dispose()
    subject.load()
    answerOk(COMPOSITION)
    answerOk(COMPOSITION)
    await flush()
    expect(state().status).toBe('ready')
  })
})
