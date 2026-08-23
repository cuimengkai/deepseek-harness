import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  ReasoningEffortId,
  type ContentBlock,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')
const OFF = ReasoningEffortId('off')

/** Keyless flow adapter: echo the last user turn so each child's transcript is readable. */
class FlowMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: OFF, name: 'Off' },
          { id: HIGH, name: 'High' },
        ],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const lastUser = [...options.messages].reverse().find(message => message.role === 'user')
    const text = (lastUser?.content ?? [])
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = `flow-mock: ${text.trim() || '(no user text)'}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'flow-mock-llm'
export const inject = ['llm']

/** Register the keyless `flow-mock` adapter every flow child resolves. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['flow-mock'], new FlowMockAdapter())
}
