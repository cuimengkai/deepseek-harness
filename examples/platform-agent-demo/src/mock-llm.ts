import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class PlatformDemoAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  /**
   * Emit one text block that honors the session's output-token quota. The
   * adapter is the provider boundary: `options.maxTokens` is the cap the
   * workspace's session runs under, so when the reply would exceed it the
   * adapter truncates and finishes with `max-tokens` — the durable turn-outcome
   * the loop records on `turn/end`. Usage is derived from the emitted text so
   * the quota check is honest.
   * @param options - the generation request carrying the session's `maxTokens`.
   * @param text - the full reply the model wants to produce.
   * @returns the stream chunks for the (possibly capped) reply.
   */
  private * textReply(options: GenerateOptions, text: string): Generator<StreamChunk> {
    const cap = options.maxTokens
    // A capped reply truncates at the token budget; an uncapped one passes through.
    const capped = cap !== undefined && text.length > cap
    const emitted = capped ? text.slice(0, cap) : text
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: emitted }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: emitted } }
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: emitted.length } }
    yield { type: 'finish', reason: capped ? { kind: 'max-tokens' } : { kind: 'stop' } }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const lastToolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')

    if (lastToolResult === undefined) {
      // The user's task is the FIRST user message; later user-role blocks are
      // runtime-context and skills-catalog injections, so `.at(-1)` would read
      // the skills catalog (which always contains "implement").
      const task = options.messages[0]?.content.find(block => block.type === 'text')?.text ?? ''
      const isDev = task.toLowerCase().includes('implement')
      const isQa = task.toLowerCase().includes('verify') || task.toLowerCase().includes('test')
      if (isDev) {
        const args = JSON.stringify({ id: 'requirement-1' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: CallId('demo-read-req'), name: 'get_asset', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('demo-read-req'), name: 'get_asset', arguments: args } }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else if (isQa) {
        // QA reads the developer's produced code asset, then registers its test cases.
        const args = JSON.stringify({ id: 'code-2' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: CallId('demo-read-code'), name: 'get_asset', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('demo-read-code'), name: 'get_asset', arguments: args } }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        const args = JSON.stringify({ kind: 'requirement', role: 'product', content: 'Login page with SSO' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: CallId('demo-require-1'), name: 'register_asset', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('demo-require-1'), name: 'register_asset', arguments: args } }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
      return
    }

    if (lastToolResult.toolCallId === CallId('demo-read-req')) {
      // Dev read the product's requirement; now register the produced code.
      const args = JSON.stringify({ kind: 'code', role: 'dev', content: 'Implemented login page (SSO) in src/' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('demo-code-1'), name: 'register_asset', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('demo-code-1'), name: 'register_asset', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    // T4 ACL: after the dev registers code, it attempts to write OUTSIDE its own
    // workspace into the product role's workspace (the sibling directory). The
    // sandboxed filesystem fence denies the write with FS_SANDBOX_DENIED — the
    // dev's workspace-write policy only permits its own workspace + temp roots.
    if (lastToolResult.toolCallId === CallId('demo-read-code')) {
      // QA read the dev's produced code; now register the test cases it derived.
      const args = JSON.stringify({ kind: 'test-case', role: 'qa', content: 'Login flow tests derived from code-2' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('demo-test-1'), name: 'register_asset', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('demo-test-1'), name: 'register_asset', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    if (lastToolResult.toolCallId === CallId('demo-code-1')) {
      const args = JSON.stringify({ file_path: '../product/pii-leak.txt', content: 'should never land' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('demo-acl-attempt'), name: 'write', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('demo-acl-attempt'), name: 'write', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    if (lastToolResult.toolCallId === CallId('demo-acl-attempt')) {
      // The attempted write was EXCLUDED by the sandbox (FS_SANDBOX_DENIED).
      // The model retries the SAME operation with a strictly-wider sandbox
      // permission and a justification — the escalation advertisement the
      // denial carried. approveEscalation routes it through ctx.approval, the
      // scripted answerer grants 'allowed-once', and only then does the write
      // execute. T6: the AI-execution approval seam sits between the denial
      // and the granted retry.
      const args = JSON.stringify({
        file_path: '../product/pii-leak.txt',
        content: 'approved by escalation',
        sandbox_permissions: 'danger-full-access',
        justification: 'Need to place the handoff note in the product workspace so the product role sees it.',
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('demo-escalate-attempt'), name: 'write', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('demo-escalate-attempt'), name: 'write', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    if (lastToolResult.toolCallId === CallId('demo-escalate-attempt')) {
      // The approved escalation executed the write. Reference the approval
      // outcome in the final reply, capped by the session's token quota.
      const toolText = lastToolResult.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      const reply = `Done — escalation approved: write ${lastToolResult.isError ? 'failed' : 'succeeded'} (${toolText})`
      yield* this.textReply(options, reply)
      return
    }

    // Final textual answer. Reference the traced handoff when the chain is
    // complete, capped by the session's token quota.
    const toolText = lastToolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = `Done — traceable handoff: ${toolText}`
    yield* this.textReply(options, reply)
  }
}

export const name = 'platform-demo-mock-llm'
export const inject = ['llm']

export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['platform-demo'], new PlatformDemoAdapter())
}
