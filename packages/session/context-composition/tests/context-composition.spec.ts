import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, UserMessage } from '@deepseek-ai/dsh-llm'
import { estimateMessage, estimateSystemTokens, estimateToolsTokens } from '@deepseek-ai/dsh-token-meter/estimate'
import SessionStore, { Session, SessionId, canonicalHeader } from '@deepseek-ai/dsh-session'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import ContextCompositionService from '@deepseek-ai/dsh-context-composition'

function header(model: string, extras: Partial<Omit<EpochHeader, 'config'>> = {}): EpochHeader {
  return canonicalHeader({
    config: { provider: 'mock', model },
    ...extras,
  })
}

function userMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function assistantMessage(text: string): AssistantMessage {
  return createMessage({
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'mock', model: 'mock' },
  })
}

function service(): { ctx: Context; read: ContextCompositionService['read'] } {
  const ctx = new Context()
  const composition = new ContextCompositionService(ctx)
  return { ctx, read: session => composition.read(session) }
}

describe('ContextCompositionService registration', () => {
  it('exposes ctx.contextComposition and removes it on fiber dispose', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(ContextCompositionService)
    expect(ctx.get('contextComposition')).toBeInstanceOf(ContextCompositionService)
    await fiber.dispose()
    expect(ctx.get('contextComposition')).toBeUndefined()
  })
})

describe('context composition fold', () => {
  it('reads an empty session as a null envelope, empty surface, and no compactions', () => {
    const { read } = service()
    const session = Session.create(SessionId('empty'))
    const composition = read(session)
    expect(composition).toEqual({
      logRevision: 0,
      envelope: null,
      surface: [],
      surfaceTokens: 0,
      contextWindow: null,
      compactions: [],
    })
  })

  it('prices the envelope from the latest header with the meter catalog total and per-tool rows', () => {
    const { read } = service()
    const session = Session.create(SessionId('envelope'))
    session.append('request/header', { header: header('m-1'), reason: 'initial' })
    const changed = header('m-2', {
      system: 'You are a test.',
      tools: [
        { name: 'read', description: '', parameters: { type: 'object' } },
        { name: 'write', description: '', parameters: { type: 'object' } },
      ],
    })
    session.append('request/header', { header: changed, reason: 'change' })
    const { envelope } = read(session)
    expect(envelope).toMatchObject({ provider: 'mock', model: 'm-2', system: 'You are a test.' })
    expect(envelope!.tools.map(tool => tool.name)).toEqual(['read', 'write'])
    // The catalog total is the estimator's own figure: the projection must
    // never disagree with the meter's vocabulary.
    expect(envelope!.toolsTokens).toBe(estimateToolsTokens(changed))
    expect(envelope!.systemTokens).toBe(estimateSystemTokens(changed))
    expect(envelope!.toolsTokens).toBeGreaterThan(0)
  })

  it('prices every surface row with the meter heuristic and sums the totals', () => {
    const { read } = service()
    const session = Session.create(SessionId('surface'))
    session.append('request/header', { header: header('m-1'), reason: 'initial' })
    const first = userMessage('first line\nsecond line')
    const second = assistantMessage('assistant answer')
    session.append('user/message', first, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: second,
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    const composition = read(session)
    expect(composition.surface.map(row => row.role)).toEqual(['user', 'assistant'])
    // Row pricing equals the estimator's own figures: the projection must
    // never disagree with the meter's vocabulary.
    expect(composition.surface[0]).toMatchObject({
      preview: 'first line',
      tokens: estimateMessage(first),
    })
    expect(composition.surface[1]).toMatchObject({
      preview: 'assistant answer',
      tokens: estimateMessage(second),
    })
    expect(composition.surface.reduce((total, row) => total + row.tokens, 0))
      .toBe(composition.surfaceTokens)
    expect(composition.logRevision).toBe(session.events.length)
  })

  it('reads a null preview when a message carries no text block', () => {
    const { read } = service()
    const session = Session.create(SessionId('notext'))
    session.append('request/header', { header: header('m-1'), reason: 'initial' })
    session.append('user/message', userMessage(''), { surfaceOp: 'append' })
    const composition = read(session)
    expect(composition.surface[0]!.preview).toBeNull()
  })

  it('keeps the newest route capacity from request/context events', () => {
    const { read } = service()
    const session = Session.create(SessionId('capacity'))
    session.append('request/context', { provider: 'mock', model: 'm-1', contextWindow: 32_000 })
    session.append('request/context', { provider: 'mock', model: 'm-1', contextWindow: 65_536 })
    expect(read(session).contextWindow).toBe(65_536)
  })

  it('reports a null capacity when no adapter advertised one', () => {
    const { read } = service()
    const session = Session.create(SessionId('nocapacity'))
    session.append('request/context', { provider: 'mock', model: 'm-1' })
    expect(read(session).contextWindow).toBeNull()
  })

  it('removes the shadowed rows after a replacement surface op', () => {
    const { read } = service()
    const session = Session.create(SessionId('compacted'))
    session.append('request/header', { header: header('m-1'), reason: 'initial' })
    const first = session.append('user/message', userMessage('question one'), { surfaceOp: 'append' }).seq
    const second = session.append('user/message', userMessage('question two'), { surfaceOp: 'append' }).seq
    session.append('user/message', userMessage('compacted summary checkpoint'), {
      surfaceOp: { op: 'replace', start: first, end: second },
      sourceEventSeqs: [first, second],
    })
    const composition = read(session)
    expect(composition.surface.map(row => row.seq)).toEqual([session.events.length - 1])
    expect(composition.surface[0]!.preview).toBe('compacted summary checkpoint')
  })

  it('records each compaction summary with its writer route and shadow price', () => {
    const { read } = service()
    const session = Session.create(SessionId('summary'))
    session.append('request/header', { header: header('m-1'), reason: 'initial' })
    session.append('compaction/summary', {
      compactionId: CompactionId('c-1'),
      summary: [{ type: 'text', text: 'the summary text' }],
      shadowedRange: { start: 2, end: 3 },
      shadowedSeqs: [2, 3],
      shadowedTokenCount: 44,
      provider: 'mock',
      model: 'm-compact',
    })
    const composition = read(session)
    expect(composition.compactions).toEqual([{
      summarySeq: 1,
      model: 'm-compact',
      provider: 'mock',
      summary: 'the summary text',
      shadowedCount: 2,
      shadowedTokens: 44,
    }])
  })

  it('reports a null summary text when the summary carried no text block', () => {
    const { read } = service()
    const session = Session.create(SessionId('notextsummary'))
    session.append('compaction/summary', {
      compactionId: CompactionId('c-2'),
      summary: [],
      shadowedRange: { start: 2, end: 3 },
      shadowedSeqs: [2, 3],
      shadowedTokenCount: 44,
      provider: 'mock',
      model: 'm-compact',
    })
    expect(read(session).compactions[0]!.summary).toBeNull()
  })
})

describe('context composition over the session store', () => {
  it('reads a live store session through the service registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const composition = new ContextCompositionService(ctx)
    const session = ctx.sessions.create(SessionId('live'))
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })
    const result = composition.read(session)
    expect(result.surface).toHaveLength(1)
    expect(result.surfaceTokens).toBe(result.surface[0]!.tokens)
  })
})
