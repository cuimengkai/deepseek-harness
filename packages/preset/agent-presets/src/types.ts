/** Client-safe payloads and event declarations owned by the agent-preset domain. */
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type { PresetTrust } from './preset.ts'

export type { PresetTrust } from './preset.ts'

/**
 * One roster row as a client reads it. Path-free: a preset is addressed by id
 * everywhere off the Host, and the composition's location is the Host's own.
 */
export interface AgentPresetRow {
  /** Stable identifier; also the label's fallback. */
  readonly id: string
  /** Trust of the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string
}

/** The roster one deployment currently supplies, with its authoring capability. */
export interface AgentPresetRoster {
  /** Every preset the configured roots supply, first-root-wins per id. */
  readonly presets: readonly AgentPresetRow[]
  /** Whether this deployment has a root locally authored presets go to. */
  readonly authorable: boolean
}

/** Stable details for agent-preset failures returned by the Remote namespace. */
export interface AgentPresetErrorDetailsMap {
  /** A required preset id is empty. */
  'bad-request': Record<never, never>
  /** No configured root supplies the requested id. */
  'agent-preset-not-found': { readonly agentPreset: string; readonly available: readonly string[] }
  /** The id is unusable, already taken, or its composition cannot be installed. */
  'agent-preset-invalid': { readonly agentPreset: string; readonly reason: string }
  /** The preset ships with the deployment and is not the user's to change. */
  'agent-preset-read-only': { readonly agentPreset: string; readonly reason: string }
  /** The session's conversation has started, so its composition is fixed. */
  'agent-preset-locked': { readonly sessionId: SessionId; readonly agentPreset: string }
  /** The preset operation failed without a caller-actionable classification. */
  internal: Record<never, never>
}

/** One agent-preset refusal as a client reads it. */
export type AgentPresetError = {
  [Code in keyof AgentPresetErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: AgentPresetErrorDetailsMap[Code]
  }
}[keyof AgentPresetErrorDetailsMap]

/** One preset's composition text beside the row it belongs to. */
export interface AgentPresetDocument {
  /** The preset the composition belongs to. */
  readonly agentPreset: string
  /** Trust of the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** The composition exactly as stored. */
  readonly content: string
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
}

/** One preset's composition graph beside the row it belongs to. */
export interface AgentPresetGraph {
  /** The preset the graph belongs to. */
  readonly agentPreset: string
  /** Trust of the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** The composition graph, stored when current or regenerated from the rows. */
  readonly graph: FlowGraph
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
}

/**
 * One composition row the composer authors.
 *
 * The JSON-safe subset of a loader entry that may cross the wire: `config`,
 * `disabled`, and `inject` pass through as structured values rather than being
 * edited, so arbitrary plugin config and a platform-conditional `!!js`
 * expression (`{ __jsExpr }`) round-trip unchanged. `group` is carried so a
 * group row survives editing. `id` is required by the composer (every row it
 * writes has one), but stays optional here because a shipped composition read
 * back for editing may contain an id-less row.
 */
export interface ComposeRow {
  /** Stable id inside the preset; unique across the rows of one preset. */
  id?: string
  /** Module specifier imported by the entry. */
  name: string
  /** Config passed to the plugin, carried verbatim. */
  config?: JsonValue
  /** Marks this row as a nested group, carried verbatim. */
  group?: boolean | null
  /** Enablement, carried verbatim (`!!js` expressions as `{ __jsExpr }`). */
  disabled?: JsonValue
  /** Required-service override, carried verbatim so an overwrite never drops it. */
  inject?: JsonValue
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentPreset: string | null
  }
  interface SessionProjectionMap {
    /** Preset the Session runs, or null when the deployment composes none. */
    agentPreset: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One session committed a different agent preset to its durable log.
     * Consumers invalidate only state derived from that session's composition.
     * @mode emit
     * @param sessionId - the session whose composition changed.
     * @param agentPreset - the preset recorded by the committed selection.
     */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

export {}
