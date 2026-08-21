/**
 * Keyless scripted model for engine-isolation-demo: the `engine-demo` provider
 * route resolves to this adapter, whose stream emits one `register_asset` tool
 * call then a text reply, per generation step. The script is keyed by the
 * session the loop stamps on the request, so the parent's shared drive
 * (`engine-shared`) and the child worker's isolated drive (`engine-isolated`)
 * each register their own requirement asset against their own workspace — the
 * workspace id is read off the task directive both drives carry. This proves
 * the model-visible tool surface, the actor binding, and the durable session
 * log without any network.
 * @module engine-isolation-demo-mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The workspace id the demo driver named in the first user message. */
function workspaceIdFrom(task: string): string {
  return /\bws-[\w-]+\b/.exec(task)?.[0] ?? 'ws-1'
}

class EngineDemoAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  /** Emit one scripted tool call, finishing the generation step. */
  private * toolCall(callId: string, name: string, args: unknown): Generator<StreamChunk> {
    const serialized = JSON.stringify(args)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: CallId(callId), name, argumentsDelta: serialized }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(callId), name, arguments: serialized } }
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }

  /** Emit the final text reply, finishing the turn. */
  private * textReply(text: string): Generator<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: text.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const session = String(options.sessionId ?? '')
    const task = options.messages[0]?.content.find(block => block.type === 'text')?.text ?? ''
    const last = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')

    if (session === 'engine-shared' || session === 'engine-isolated') {
      const content = session === 'engine-shared' ? 'R-shared' : 'R-isolated'
      if (last === undefined) {
        yield* this.toolCall(`${session}-register`, 'register_asset', {
          workspaceId: workspaceIdFrom(task),
          kind: 'requirement',
          content,
          roleId: 'product',
        })
        return
      }
      if (last.toolCallId === CallId(`${session}-register`)) {
        yield* this.textReply(`Registered ${content} as the ${session} workspace's requirement asset.`)
        return
      }
    }
    yield* this.textReply(`No scripted behavior for session ${session}.`)
  }
}

export const name = 'engine-isolation-demo-mock-llm'
export const inject = ['llm']

export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['engine-demo'], new EngineDemoAdapter())
}
