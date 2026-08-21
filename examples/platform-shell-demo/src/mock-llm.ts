/**
 * Keyless scripted model for platform-shell-demo: the `platform-demo` provider
 * route resolves to this adapter, whose stream emits the tool calls each role
 * agent's scripted turn needs, one per generation step, finishing with a text
 * reply. The script is keyed by the session the loop stamps on the request, so
 * the five agents (product alice, dev bob, qa carol, platform-admin dana, and
 * the unbound mallory) each run their own chain against the real control-plane
 * store — proving the model-visible surface, the RBAC denials, and the durable
 * session log without any network.
 * @module platform-shell-demo-mock-llm
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

/** The text the tool render emitted, e.g. to derive ticket ids from it. */
function resultText(result: ToolResultBlock): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** The ticket id named in a tool result, e.g. `approval-1`. */
function ticketIdFrom(result: ToolResultBlock): string {
  return /approval-\d+/.exec(resultText(result))?.[0] ?? 'approval-1'
}

/** The workspace id the demo driver named in the first user message. */
function workspaceIdFrom(task: string): string {
  return /\bws-\d+\b/.exec(task)?.[0] ?? 'ws-1'
}

class PlatformShellAdapter extends LlmAdapter {
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

    switch (session) {
      case 'platform-alice': {
        if (last === undefined) {
          yield* this.toolCall('alice-register', 'register_asset', {
            workspaceId: workspaceIdFrom(task),
            kind: 'requirement',
            content: 'Login page with SSO',
            roleId: 'product',
          })
          return
        }
        if (last.toolCallId === CallId('alice-register')) {
          yield* this.toolCall('alice-submit', 'submit_ticket', {
            workspaceId: workspaceIdFrom(task),
            subjectAssetId: 'requirement-1',
          })
          return
        }
        if (last.toolCallId === CallId('alice-submit')) {
          yield* this.toolCall('alice-review', 'approve_ticket', { ticketId: ticketIdFrom(last), to: 'review' })
          return
        }
        if (last.toolCallId === CallId('alice-review')) {
          yield* this.toolCall('alice-approve', 'approve_ticket', {
            ticketId: ticketIdFrom(last),
            to: 'approved',
            roles: ['product'],
            expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
          })
          return
        }
        yield* this.textReply('Requirement registered and approved with a product review scope.')
        return
      }
      case 'platform-dev': {
        if (last === undefined) {
          yield* this.toolCall('dev-read', 'get_asset', { assetId: 'requirement-1' })
          return
        }
        if (last.toolCallId === CallId('dev-read')) {
          yield* this.toolCall('dev-register', 'register_asset', {
            workspaceId: workspaceIdFrom(task),
            kind: 'code',
            content: 'Implemented login page (SSO) in src/',
            roleId: 'dev',
          })
          return
        }
        if (last.toolCallId === CallId('dev-register')) {
          yield* this.toolCall('dev-link', 'link_asset', { assetId: 'code-2', parentId: 'requirement-1' })
          return
        }
        yield* this.textReply('Implemented the requirement; code-2 is linked from requirement-1.')
        return
      }
      case 'platform-qa': {
        if (last === undefined) {
          yield* this.toolCall('qa-read', 'get_asset', { assetId: 'code-2' })
          return
        }
        if (last.toolCallId === CallId('qa-read')) {
          yield* this.toolCall('qa-register', 'register_asset', {
            workspaceId: workspaceIdFrom(task),
            kind: 'test-case',
            content: 'Login flow tests derived from code-2',
            roleId: 'qa',
          })
          return
        }
        if (last.toolCallId === CallId('qa-register')) {
          yield* this.toolCall('qa-link', 'link_asset', { assetId: 'test-case-3', parentId: 'code-2' })
          return
        }
        if (last.toolCallId === CallId('qa-link')) {
          yield* this.toolCall('qa-ancestors', 'asset_ancestors', { assetId: 'test-case-3' })
          return
        }
        yield* this.textReply('Verified code-2; registered test-case-3 and traced its ancestry to requirement-1.')
        return
      }
      case 'platform-admin': {
        if (last === undefined) {
          yield* this.toolCall('admin-list', 'list_tickets', { workspaceId: workspaceIdFrom(task) })
          return
        }
        if (last.toolCallId === CallId('admin-list')) {
          yield* this.toolCall('admin-release', 'approve_ticket', { ticketId: ticketIdFrom(last), to: 'released' })
          return
        }
        yield* this.textReply('Released the approved requirement ticket.')
        return
      }
      case 'platform-mallory': {
        if (last === undefined) {
          yield* this.toolCall('mallory-read', 'get_asset', { assetId: 'requirement-1' })
          return
        }
        if (last.toolCallId === CallId('mallory-read')) {
          yield* this.textReply(last.isError
            ? `Read denied: not a member of the workspace (${resultText(last)})`
            : 'Unexpectedly read the asset — the denial did not fire')
          return
        }
        yield* this.textReply('Access check complete.')
        return
      }
      default:
        yield* this.textReply(`No scripted behavior for session ${session}.`)
    }
  }
}

export const name = 'platform-shell-demo-mock-llm'
export const inject = ['llm']

export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['platform-demo'], new PlatformShellAdapter())
}
