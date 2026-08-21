/**
 * Keyless scripted model for capability-market-demo: the `market-demo` provider
 * route resolves to this adapter, whose stream emits the tool calls each agent's
 * scripted turn needs, one per generation step, finishing with a text reply. The
 * script is keyed by the session the loop stamps on the request and by the user
 * turn count, so the market operator, the product-engineering customer, and the
 * short-video-creation customer each run their own multi-turn chain against the
 * real control-plane store — proving the catalog publish, the assembly
 * rejections and fixes, the workbench serving, and the billing ledger without
 * any network.
 * @module capability-market-demo-mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
  type ToolResultBlock,
} from '@deepseek-ai/dsh-llm'

/** The workspace id the demo driver named in the FIRST user directive. */
function firstWorkspaceId(options: GenerateOptions): string {
  const text = firstUserText(options)
  return /\bws-\d+\b/.exec(text)?.[0] ?? 'ws-1'
}

/** Every workspace id named in the most recent user directive (settle turn). */
function workspaceIdsFrom(options: GenerateOptions): string[] {
  const text = lastUserText(options)
  return [...text.matchAll(/\bws-\d+\b/g)].map(match => match[0])
}

/** The `YYYY-MM` billing period named in the most recent user directive. */
function periodFrom(options: GenerateOptions): string {
  const text = lastUserText(options)
  return /\b\d{4}-\d{2}\b/.exec(text)?.[0] ?? '2026-08'
}

/** The first driver followup: the first message with the user source kind. */
function firstUserText(options: GenerateOptions): string {
  const message = options.messages.find(m => m.role === 'user' && m.source.kind === 'user')
  return message?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
}

/** The most recent driver directive, skipping injected user-surface messages. */
function lastUserText(options: GenerateOptions): string {
  for (let index = options.messages.length - 1; index >= 0; index -= 1) {
    const message = options.messages[index]
    // The tool-skill plugin injects its skill catalog as a user message with
    // source kind `skill-catalog`; only the demo driver's followups (source
    // kind `user`) count as directives.
    if (message === undefined || message.role !== 'user' || message.source.kind !== 'user') continue
    if (message.content.some(block => block.type === 'tool-result')) continue
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (text.trim().length > 0) return text
  }
  return ''
}

/** How many driver directives the session has received (turn counter, 1-based). */
function userTurnCount(options: GenerateOptions): number {
  return options.messages.filter(message =>
    message.role === 'user' && message.source.kind === 'user' && message.content.some(block => block.type === 'text'),
  ).length
}

/**
 * True when no tool result from the current turn has been emitted yet. A turn
 * begins right after the previous turn's final text reply (and the injected
 * skill catalog), so the last message carries no tool-result block — unless the
 * loop omits the assistant reply, in which case the previous turn's final tool
 * result is still the last block. Both layouts resolve to the turn's first step.
 */
function atTurnStart(last: ToolResultBlock | undefined, previousTurnFinal: string): boolean {
  return last === undefined || last.toolCallId === CallId(previousTurnFinal)
}

class CapabilityMarketAdapter extends LlmAdapter {
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

  /** The market operator: publish the catalog, gate it, then settle the ledger. */
  private * operatorChain(options: GenerateOptions): Generator<StreamChunk> {
    const last = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    const turn = userTurnCount(options)

    if (turn === 1) {
      if (last === undefined) {
        yield* this.toolCall('op-publish-analysis', 'publish_capability', {
          id: 'code-analysis', name: 'Code Analysis', roleId: 'product', execution: 'managed',
          version: '1.0.0', rate: 3, description: 'static analysis of code assets',
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-analysis')) {
        yield* this.toolCall('op-publish-reqmgt', 'publish_capability', {
          id: 'requirement-management', name: 'Requirement Management', roleId: 'product', execution: 'managed',
          version: '1.0.0', rate: 4, dependencies: [{ id: 'code-analysis', range: '>=1.0.0' }],
          description: 'captures and tracks product requirements',
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-reqmgt')) {
        yield* this.toolCall('op-publish-tcgen', 'publish_capability', {
          id: 'test-case-generation', name: 'Test Case Generation', roleId: 'qa', execution: 'managed',
          version: '1.0.0', rate: 2, dependencies: [{ id: 'code-analysis', range: '>=1.0.0' }],
          description: 'derives test cases from analyzed code',
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-tcgen')) {
        yield* this.toolCall('op-publish-tcexec', 'publish_capability', {
          id: 'test-execution', name: 'Test Execution', roleId: 'qa', execution: 'sandboxed',
          version: '1.0.0', rate: 6, dependencies: [{ id: 'test-case-generation', range: '>=1.0.0' }],
          description: 'runs generated test cases in a sandbox',
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-tcexec')) {
        // Deliberate catalog mistake: code-analysis is published at 1.0.0 but
        // code-refactor demands >=2.0.0, so the assembly refuses loudly.
        yield* this.toolCall('op-publish-refactor', 'publish_capability', {
          id: 'code-refactor', name: 'Code Refactor', roleId: 'dev', execution: 'managed',
          version: '1.0.0', rate: 7, dependencies: [{ id: 'code-analysis', range: '>=2.0.0' }],
          description: 'refactors code under analysis guidance',
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-refactor')) {
        yield* this.toolCall('op-publish-recorder', 'publish_capability', {
          id: 'short-video-recorder', name: 'Short Video Recorder', roleId: 'product', execution: 'managed',
          version: '1.0.0', rate: 5, description: 'records a short video clip',
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-recorder')) {
        yield* this.toolCall('op-publish-editor', 'publish_capability', {
          id: 'short-video-editor', name: 'Short Video Editor', roleId: 'product', execution: 'managed',
          version: '1.0.0', rate: 5, conflictsWith: ['short-video-recorder'],
          description: 'edits a short video clip',
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-editor')) {
        yield* this.toolCall('op-publish-publisher', 'publish_capability', {
          id: 'short-video-publisher', name: 'Short Video Publisher', roleId: 'product', execution: 'managed',
          version: '1.0.0', rate: 5, description: 'publishes a finished short video',
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-publisher')) {
        yield* this.toolCall('op-publish-wb-pe', 'publish_scenario', {
          id: 'product-engineering', name: 'Product Engineering', workbenchId: 'product-engineering',
          roleId: 'product', preset: 'product-engineering',
          capabilityIds: ['code-analysis', 'requirement-management', 'test-case-generation', 'test-execution', 'code-refactor'],
        })
        return
      }
      if (last.toolCallId === CallId('op-publish-wb-pe')) {
        yield* this.toolCall('op-publish-wb-sv', 'publish_scenario', {
          id: 'short-video-creation', name: 'Short Video Creation', workbenchId: 'short-video-creation',
          roleId: 'product', preset: 'short-video-creation',
          capabilityIds: ['short-video-recorder', 'short-video-editor', 'short-video-publisher'],
        })
        return
      }
      yield* this.textReply('Published the market catalog and both workbench scenarios.')
      return
    }

    if (turn === 2) {
      if (atTurnStart(last, 'op-publish-wb-sv')) {
        yield* this.toolCall('op-gate-disable', 'set_capability_gate', {
          capabilityId: 'code-analysis', enabled: false, rollout: 1,
        })
        return
      }
      yield* this.textReply('Disabled code-analysis; assemblies that depend on it now refuse.')
      return
    }

    if (turn === 3) {
      if (atTurnStart(last, 'op-gate-disable')) {
        yield* this.toolCall('op-gate-enable', 'set_capability_gate', {
          capabilityId: 'code-analysis', enabled: true, rollout: 1,
        })
        return
      }
      if (last?.toolCallId === CallId('op-gate-enable')) {
        yield* this.toolCall('op-gate-hold', 'set_capability_gate', {
          capabilityId: 'test-execution', enabled: true, rollout: 0,
        })
        return
      }
      yield* this.textReply('Re-enabled code-analysis and held test-execution at rollout 0.')
      return
    }

    if (turn === 4) {
      if (atTurnStart(last, 'op-gate-hold')) {
        yield* this.toolCall('op-gate-open', 'set_capability_gate', {
          capabilityId: 'test-execution', enabled: true, rollout: 1,
        })
        return
      }
      yield* this.textReply('Opened test-execution to the full rollout.')
      return
    }

    // Turn 5: read both workspace balances, then close both billing periods.
    const [first, second = first] = workspaceIdsFrom(options)
    const period = periodFrom(options)
    if (atTurnStart(last, 'op-gate-open')) {
      yield* this.toolCall('op-balance-1', 'account_balance', { workspaceId: first })
      return
    }
    if (last?.toolCallId === CallId('op-balance-1')) {
      yield* this.toolCall('op-balance-2', 'account_balance', { workspaceId: second })
      return
    }
    if (last?.toolCallId === CallId('op-balance-2')) {
      yield* this.toolCall('op-settle-1', 'settle_account', { workspaceId: first, period })
      return
    }
    if (last?.toolCallId === CallId('op-settle-1')) {
      yield* this.toolCall('op-settle-2', 'settle_account', { workspaceId: second, period })
      return
    }
    yield* this.textReply(`Settled ${first} and ${second} for ${period}.`)
  }

  /** The product-engineering customer: assembly rejections, fixes, and billing. */
  private * productChain(options: GenerateOptions): Generator<StreamChunk> {
    const last = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    const turn = userTurnCount(options)
    const ws = firstWorkspaceId(options)

    if (turn === 1) {
      if (last === undefined) {
        yield* this.toolCall('p-transitive', 'assemble_capabilities', {
          workspaceId: ws, scenarioId: 'product-engineering', selected: ['test-execution'],
        })
        return
      }
      if (last.toolCallId === CallId('p-transitive')) {
        yield* this.toolCall('p-version-bomb', 'assemble_capabilities', {
          workspaceId: ws, scenarioId: 'product-engineering', selected: ['code-refactor'],
        })
        return
      }
      yield* this.textReply('Resolved the transitive chain; assembling code-refactor failed on its version range.')
      return
    }

    if (turn === 2) {
      if (atTurnStart(last, 'p-version-bomb')) {
        yield* this.toolCall('p-version-fixed', 'assemble_capabilities', {
          workspaceId: ws, scenarioId: 'product-engineering', selected: ['code-refactor'],
        })
        return
      }
      if (last?.toolCallId === CallId('p-version-fixed')) {
        yield* this.toolCall('p-consume-reqmgt', 'consume_capability', {
          workspaceId: ws, capabilityId: 'requirement-management', qty: 2,
        })
        return
      }
      if (last?.toolCallId === CallId('p-consume-reqmgt')) {
        yield* this.toolCall('p-consume-tcexec', 'consume_capability', {
          workspaceId: ws, capabilityId: 'test-execution', qty: 15,
        })
        return
      }
      if (last?.toolCallId === CallId('p-consume-tcexec')) {
        yield* this.toolCall('p-consume-overdraft', 'consume_capability', {
          workspaceId: ws, capabilityId: 'code-analysis', qty: 1,
        })
        return
      }
      yield* this.textReply('Reassembled code-refactor after the catalog fix and metered consumption until the overdraft refused.')
      return
    }

    if (turn === 3) {
      if (atTurnStart(last, 'p-consume-overdraft')) {
        yield* this.toolCall('p-dep-disabled', 'assemble_capabilities', {
          workspaceId: ws, scenarioId: 'product-engineering', selected: ['requirement-management'],
        })
        return
      }
      yield* this.textReply('Requirement-management refused: its code-analysis dependency is disabled.')
      return
    }

    if (turn === 4) {
      if (atTurnStart(last, 'p-dep-disabled')) {
        yield* this.toolCall('p-rollout-0', 'assemble_capabilities', {
          workspaceId: ws, scenarioId: 'product-engineering', selected: ['test-execution'],
        })
        return
      }
      yield* this.textReply('Test-execution refused while its rollout is 0.')
      return
    }

    // Turn 5: the ledger read after the full rollout opens test-execution again.
    if (atTurnStart(last, 'p-rollout-0')) {
      yield* this.toolCall('p-ledger', 'assemble_capabilities', {
        workspaceId: ws, scenarioId: 'product-engineering', selected: ['test-execution'],
      })
      return
    }
    yield* this.textReply('Test-execution resolves again at full rollout; the workspace ledger holds the metered spend.')
  }

  /** The short-video-creation customer: list the workbench, hit the conflict, fix it, consume. */
  private * videoChain(options: GenerateOptions): Generator<StreamChunk> {
    const last = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    const ws = firstWorkspaceId(options)

    if (last === undefined) {
      yield* this.toolCall('v-list', 'list_scenarios', {})
      return
    }
    if (last.toolCallId === CallId('v-list')) {
      yield* this.toolCall('v-conflict', 'assemble_capabilities', {
        workspaceId: ws, scenarioId: 'short-video-creation', selected: ['short-video-recorder', 'short-video-editor'],
      })
      return
    }
    if (last.toolCallId === CallId('v-conflict')) {
      yield* this.toolCall('v-assemble', 'assemble_capabilities', {
        workspaceId: ws, scenarioId: 'short-video-creation', selected: ['short-video-recorder', 'short-video-publisher'],
      })
      return
    }
    if (last.toolCallId === CallId('v-assemble')) {
      yield* this.toolCall('v-consume', 'consume_capability', {
        workspaceId: ws, capabilityId: 'short-video-recorder', qty: 1,
      })
      return
    }
    yield* this.textReply('The short-video workbench refused the conflicting editor+recorder pair and resolved recorder+publisher.')
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const session = String(options.sessionId ?? '')
    switch (session) {
      case 'market-operator':
        yield* this.operatorChain(options)
        return
      case 'market-product':
        yield* this.productChain(options)
        return
      case 'market-video':
        yield* this.videoChain(options)
        return
      default:
        yield* this.textReply(`No scripted behavior for session ${session}.`)
    }
  }
}

export const name = 'capability-market-demo-mock-llm'
export const inject = ['llm']

export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['market-demo'], new CapabilityMarketAdapter())
}
