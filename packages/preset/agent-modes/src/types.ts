/** Client-safe payloads and event declarations owned by the agent-mode domain. */
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type { ModeTrust } from './mode.ts'
import type { ModeBind } from './bind.ts'

export type { ModeTrust } from './mode.ts'
export type { ModeBind } from './bind.ts'

/**
 * One roster row as a client reads it. Path-free: a mode is addressed by id
 * everywhere off the Host.
 */
export interface AgentModeRow {
  /** Stable identifier; also the label's fallback. */
  readonly id: string
  /** Trust of the root this mode was discovered under. */
  readonly trust: ModeTrust
  /** Whether a session naming no mode resolves this one when a default is set. */
  readonly isDefault: boolean
  /** Display name the mode published. */
  readonly name?: string
  /** One sentence on what this mode is for. */
  readonly description?: string
  /** Bound agent preset id when the bind is healthy. */
  readonly preset?: string
  /** Bound entry flow id when the bind is healthy. */
  readonly entryFlow?: string
  /** Why this mode cannot compose a session; absent when it can. */
  readonly broken?: string
}

/** The roster one deployment currently supplies, with its authoring capability. */
export interface AgentModeRoster {
  /** Every mode the configured roots supply, first-root-wins per id. */
  readonly modes: readonly AgentModeRow[]
  /** Whether this deployment has a root locally authored modes go to. */
  readonly authorable: boolean
}

/** One mode's bind and entry flow beside the row it belongs to. */
export interface AgentModeDocument {
  /** The mode the document belongs to. */
  readonly agentMode: string
  /** Trust of the root this mode was discovered under. */
  readonly trust: ModeTrust
  /** The bind contract. */
  readonly bind: ModeBind
  /** The entry flow graph. */
  readonly entryGraph: FlowGraph
  /** Display name the mode published. */
  readonly name?: string
  /** One sentence on what this mode is for. */
  readonly description?: string
}

/** One mode's named flow graph. */
export interface AgentModeFlow {
  /** The mode the flow belongs to. */
  readonly agentMode: string
  /** Trust of the root this mode was discovered under. */
  readonly trust: ModeTrust
  /** The flow graph. */
  readonly graph: FlowGraph
}

/** Stable details for agent-mode failures returned by the Remote namespace. */
export interface AgentModeErrorDetailsMap {
  /** A required mode id is empty. */
  'bad-request': Record<never, never>
  /** No configured root supplies the requested id. */
  'agent-mode-not-found': { readonly agentMode: string; readonly available: readonly string[] }
  /** The id is unusable, or its bind/flow cannot be used. */
  'agent-mode-invalid': { readonly agentMode: string; readonly reason: string }
  /** The mode ships with the deployment and is not the user's to change. */
  'agent-mode-read-only': { readonly agentMode: string; readonly reason: string }
  /** A blank-session mode switch was refused because the conversation started. */
  'agent-mode-locked': { readonly agentMode: string; readonly sessionId: string }
  /** The host composition has no flow engine for try-run. */
  'flow-unavailable': Record<never, never>
  /** Try-run addressed an unknown or already-settled flow run. */
  'flow-run-not-found': { readonly runId: string }
  /** The mode operation failed without a caller-actionable classification. */
  internal: Record<never, never>
  /** Session scenario start addressed a session without an agent mode. */
  'agent-mode-missing': Record<never, never>
}

/** One agent-mode refusal as a client reads it. */
export type AgentModeError = {
  [Code in keyof AgentModeErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: AgentModeErrorDetailsMap[Code]
  }
}[keyof AgentModeErrorDetailsMap]

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentMode: string | null
  }
  interface SessionProjectionMap {
    /** Mode the Session was created under, or null when none. */
    agentMode: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One session committed a different agent mode to its durable log.
     * @mode emit
     * @param sessionId - the session whose mode changed.
     * @param agentMode - the mode recorded by the committed selection.
     */
    'agent-mode/selected'(sessionId: SessionId, agentMode: string): void
  }
}

export type { JsonValue }

export {}
