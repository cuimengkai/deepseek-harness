/**
 * Flow-engine vocabulary: the visual flow graph a canvas authors, plus the
 * durable run/status snapshots the run surface renders. Types only (plus the
 * id-brand factories) — every value is plain JSON data, browser-safe, so the
 * Client canvas and the Host service read one vocabulary without importing a
 * Cordis or Node runtime.
 * @module @deepseek-ai/dsh-flow/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ModelKind } from '@deepseek-ai/dsh-llm/types'
import type { WorkflowStopReason } from '@deepseek-ai/dsh-workflow/types'

/** Identifies one saved flow. Also the persisted file name (kebab-case). */
export type FlowId = Branded<'FlowId'>

/** Brand a string as a {@link FlowId}.
 * @param id - the raw id string.
 * @returns the same string, branded.
 */
export function FlowId(id: string): FlowId {
  return id as FlowId
}

/** Identifies one flow run. */
export type FlowRunId = Branded<'FlowRunId'>

/** Brand a string as a {@link FlowRunId}.
 * @param id - the raw id string (the service mints UUIDs; tests may pass fixtures).
 * @returns the same string, branded.
 */
export function FlowRunId(id: string): FlowRunId {
  return id as FlowRunId
}

/** The node kinds a canvas can place. */
export type FlowNodeType = 'start' | 'end' | 'agent' | 'condition' | 'loop'

/** The fields every flow node carries. */
export interface FlowNodeBase {
  /** Stable node id; also the workflow `phase` label the run surface keys on. */
  readonly id: string
  readonly type: FlowNodeType
  /** Canvas position in graph pixels. */
  readonly position: { readonly x: number; readonly y: number }
  /** Short display name shown on the node. */
  readonly label?: string
}

/** The single entry point. Exactly one per flow, with exactly one outgoing edge. */
export interface FlowStartNode extends FlowNodeBase {
  readonly type: 'start'
}

/** A terminal node. A flow may end at an end node or at any node with no outgoing edges. */
export interface FlowEndNode extends FlowNodeBase {
  readonly type: 'end'
}

/** One agent node's subagent delegation route, either the plain provider/model override or a per-kind binding. */
export interface FlowAgentOptions {
  /** Provider override for the node's own requests. */
  readonly provider?: string
  /** Model override for the node's own requests. */
  readonly model?: string
  /**
   * Per-kind model routes. A kind listed here routes that kind's requests to
   * the bound route (the node's own provider/model otherwise); presence is
   * additive, so an omitted kind keeps the node's default. Declaration only
   * until request routing consumes kinds (a Phase B/C follow-on).
   */
  readonly modelKinds?: Partial<Record<ModelKind, FlowModelKindBinding>>
}

/** The route one model kind binds to: either field may name just the provider or just the model, inheriting the node's other. */
export interface FlowModelKindBinding {
  readonly provider?: string
  readonly model?: string
}

/**
 * The preset-composition subset one agent node carries when the graph is a
 * preset composition projection (the B1a graph-backed composition): exactly
 * the JSON-safe fields of one composition row, so `graphToRows` round-trips
 * losslessly and the rows composer's validation accepts the result unchanged.
 * Session flow canvases never set it; flow validate/compile ignore it.
 */
export interface FlowAgentComposition {
  /** Stable row id inside the preset; unique across the rows of one preset. */
  readonly id?: string
  /** Module specifier the composition row imports, e.g. `@deepseek-ai/dsh-tool-bash`. */
  readonly module: string
  /** Config passed to the plugin, carried verbatim. */
  readonly config?: unknown
  /** Marks this row as a nested group, carried verbatim. */
  readonly group?: boolean | null
  /** Enablement, carried verbatim (`!!js` expressions as `{ __jsExpr }`). */
  readonly disabled?: unknown
  /** Required-service override, carried verbatim so an overwrite never drops it. */
  readonly inject?: unknown
}

/** One subagent invocation. */
export interface FlowAgentNode extends FlowNodeBase {
  readonly type: 'agent'
  /**
   * The subagent's instruction. Compiled as a JS template literal, so it may
   * interpolate the enclosing loop's `${variable}` and prior outputs
   * `${OUT['<nodeId>']}`; a literal backtick must be escaped as `\``. A preset
   * composition graph carries `''`: its node projects a composition row, never
   * a compiled subagent. An embedding node (one with a `subgraph`) runs its
   * sub-graph instead of a subagent, so its prompt is unused and may be empty.
   */
  readonly prompt: string
  /** Per-node provider/model override, mapped to `agent(prompt, { provider, model })`. */
  readonly agentOptions?: FlowAgentOptions
  /**
   * The preset-composition row this node projects, present only on preset
   * composition graphs (B1a). The session flow canvas never sets it, and
   * validate/compile ignore it.
   */
  readonly composition?: FlowAgentComposition
  /**
   * A self-contained sub-graph this node embeds: the node runs the sub-graph
   * instead of a subagent, so the sub-graph's own agent nodes ARE the
   * orchestration. Its `agentOptions` act as inherited route defaults for
   * sub-nodes that omit their own. Sub-node ids are namespaced by
   * {@link .../expand.ts | expandGraph} as `${nodeId}-sub-${subNodeId}`, so
   * sub-internal `OUT` references are rewritten to the namespaced ids.
   */
  readonly subgraph?: FlowGraph
}

/** An exclusive branch: exactly two outgoing edges labeled `true` and `false`. */
export interface FlowConditionNode extends FlowNodeBase {
  readonly type: 'condition'
  /**
   * A JS boolean expression evaluated in the run's script realm, where `OUT`
   * (agent outputs by node id) and `args` (the run input) are in scope.
   */
  readonly expression: string
}

/** A repeat-until-exhausted loop: exactly two outgoing edges labeled `body` and `after`. */
export interface FlowLoopNode extends FlowNodeBase {
  readonly type: 'loop'
  /** A JS iterable expression over `OUT`/`args`. */
  readonly iterable: string
  /** A valid JS identifier bound to each item while the body runs. */
  readonly variable: string
}

/** Any flow node, discriminated on `type`. */
export type FlowNode = FlowStartNode | FlowEndNode | FlowAgentNode | FlowConditionNode | FlowLoopNode

/** One directed connection between two nodes. */
export interface FlowEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  /**
   * Branch label. A condition node's outgoing edges carry `true`/`false`; a
   * loop node's carry `body`/`after`; all other edges carry none.
   */
  readonly label?: string
}

/** The flow graph a canvas authors and the service persists/runs. */
export interface FlowGraph {
  /** Stable kebab-case id (also the file name). */
  readonly id: string
  /** Display name. */
  readonly name: string
  readonly description?: string
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly FlowEdge[]
}

/** The persisted on-disk document version; readers refuse any other. */
export const FLOW_FORMAT_VERSION = 1

/** The on-disk flow document under `<cwd>/.dsh/flows/<id>.flow.json`. */
export interface FlowFile {
  readonly formatVersion: typeof FLOW_FORMAT_VERSION
  readonly flow: FlowGraph
}

/** One node's live-run status. */
export type FlowNodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

/** Why a flow run currently is where it is. */
export type FlowRunStatus = 'running' | 'completed' | 'cancelled' | 'error'

/** Listing row for the flows pane. */
export interface FlowSummary {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly nodeCount: number
  /** Unix ms of the last save (the file's mtime). */
  readonly updatedAt: number
}

/** One live or settled run, as `listRuns` exposes it. */
export interface FlowRunSummary {
  readonly runId: string
  readonly flowId: string
  readonly flowName: string
  readonly status: FlowRunStatus
  /** Unix ms the run started. */
  readonly startedAt: number
}

/** A run's live snapshot, as `getRun` exposes it. */
export interface FlowRunSnapshot {
  readonly runId: string
  readonly flowId: string
  readonly flowName: string
  readonly status: FlowRunStatus
  /** Why a settled run ended; present iff `status` is not `running`. */
  readonly stopReason?: WorkflowStopReason
  /** Failure or cancellation text, present when the run ended with a message. */
  readonly error?: string
  /** How many `agent()` calls the run accepted. */
  readonly agentsStarted: number
  /** Node status by node id. */
  readonly nodeStatuses: Readonly<Record<string, FlowNodeStatus>>
}
