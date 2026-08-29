import type { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')
const OFF = ReasoningEffortId('off')

/** Keyless project-insight adapter: one real `scan_project` call followed by a final answer. */
class ProjectInsightMockAdapter extends LlmAdapter {
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
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const args = '{}'
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('project-insight-call'), name: 'scan_project', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('project-insight-call'), name: 'scan_project', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const toolText = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = `Project scan round trip complete: ${toolText.trim()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'project-insight-mock-llm'
export const inject = ['llm']

/** Register the keyless `insight-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['insight-mock'], new ProjectInsightMockAdapter())
}
