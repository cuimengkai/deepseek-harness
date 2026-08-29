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
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
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
export type FlowNodeType = 'start' | 'end' | 'agent' | 'condition' | 'loop' | 'http' | 'template' | 'code' | 'aggregate' | 'list' | 'classify' | 'extract' | 'join'

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
   * additive, so an omitted kind keeps the node's default. The child's single
   * request channel is always kind `text`, so only a `text` entry affects a
   * live request today; other kinds carry into the child's durable options
   * for a future request channel that issues them.
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
  readonly config?: JsonValue
  /** Marks this row as a nested group, carried verbatim. */
  readonly group?: boolean | null
  /** Enablement, carried verbatim (`!!js` expressions as `{ __jsExpr }`). */
  readonly disabled?: JsonValue
  /** Required-service override, carried verbatim so an overwrite never drops it. */
  readonly inject?: JsonValue
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
   * When {@link systemPrompt} is set, compile concatenates system then this
   * user template with a blank line between them.
   */
  readonly prompt: string
  /**
   * Optional system instruction prepended to {@link prompt} at compile time
   * (Dify-style SYSTEM / USER split). Omitted on legacy graphs.
   */
  readonly systemPrompt?: string
  /** Per-node provider/model override, mapped to `agent(prompt, { provider, model })`. */
  readonly agentOptions?: FlowAgentOptions
  /**
   * The preset-composition row this node projects, present only on preset
   * composition graphs (B1a). The session flow canvas never sets it, and
   * validate/compile ignore it.
   */
  readonly composition?: FlowAgentComposition
  /**
   * Optional child agent-preset id. When set, compile emits it into `agent()`
   * options; the workflow worker forwards it on the child start, and
   * in-process child composition mounts that preset instead of joining the
   * parent composition, stamping the child session header's `agentPreset`.
   */
  readonly childPresetId?: string
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

/**
 * One GET retrieval through the host's `ctx.web` capability — Dify's HTTP
 * Request node, scoped to GET-only with no custom headers for this engine:
 * `ctx.web`'s SSRF/redirect/size/time policy is the node's only allow-list,
 * so it never grows a parallel, flow-specific one. Method and header support
 * are a documented gap (see the package README), not silently dropped.
 */
export interface FlowHttpNode extends FlowNodeBase {
  readonly type: 'http'
  /**
   * The request URL. Compiled as a JS template literal, so it may
   * interpolate the enclosing loop's `${variable}` and prior outputs
   * `${OUT['<nodeId>']}`, exactly like {@link FlowAgentNode.prompt}.
   */
  readonly url: string
}

/**
 * A pure string interpolation over upstream outputs — Dify's Template node.
 * No hook call and no host round trip: the compiled body evaluates the
 * template literal synchronously in the workflow script realm, records
 * `OUT[id]`, and continues. `phase(id)` still opens and closes a run-surface
 * gate around it, exactly like a `condition`/`loop` node, so the canvas sees
 * it move through `running` before the next node event settles it.
 */
export interface FlowTemplateNode extends FlowNodeBase {
  readonly type: 'template'
  /**
   * The template source. Compiled as a JS template literal, so it may
   * interpolate the enclosing loop's `${variable}` and prior outputs
   * `${OUT['<nodeId>']}`, exactly like {@link FlowAgentNode.prompt}.
   */
  readonly template: string
}

/**
 * One program run against a real sandbox — Dify's Code node. Unlike
 * {@link FlowTemplateNode}, the source is never textually interpolated: it
 * is forwarded byte for byte to the host's `ctx.codeRuntime` (never a bare
 * `eval` in the workflow's own script realm), which runs it as the body of
 * an async function alongside a `const OUT = {...}` prelude carrying the
 * flow's current outputs, so the program accesses prior nodes as real object
 * member access (`OUT['<nodeId>']`), not string interpolation.
 */
export interface FlowCodeNode extends FlowNodeBase {
  readonly type: 'code'
  /**
   * The program source, exactly as authored. It runs as the body of an
   * async function with `OUT` (the flow's outputs so far, snapshotted at
   * call time) in scope; top-level `await` and `return` are available. No
   * host bindings are exposed in v1 — only `OUT` data access.
   */
  readonly source: string
}

/** How an aggregate node combines its items. */
export type FlowAggregateMode = 'object' | 'first' | 'concat'

/** One named expression an aggregate node evaluates. */
export interface FlowAggregateItem {
  /** Key written into the object result when {@link FlowAggregateMode} is `object`. */
  readonly name: string
  /**
   * A JS expression evaluated in the run's script realm, where `OUT` and
   * `args` are in scope — the same trust model as a condition expression.
   */
  readonly expression: string
}

/**
 * A pure script-realm combine over named upstream expressions — Dify's
 * Variable Aggregator. No hook and no host round trip: the compiled body
 * evaluates each item, combines them per {@link mode}, records `OUT[id]`,
 * and continues. `phase(id)` opens and closes a run-surface gate around it,
 * like a template node. Join-after-parallel is still refused, so this node
 * combines serial or exclusively-branched outputs, not live parallel arms.
 */
export interface FlowAggregateNode extends FlowNodeBase {
  readonly type: 'aggregate'
  readonly items: readonly FlowAggregateItem[]
  readonly mode: FlowAggregateMode
}

/** The closed set of list operators a list node may apply. */
export type FlowListOp = 'first' | 'last' | 'length' | 'reverse' | 'flatten'

/**
 * A pure script-realm list operator — Dify's List Operator. The compiled
 * body evaluates {@link source} in the script realm, coerces a non-array
 * to a one-element list (null/undefined to `[]`), applies {@link op},
 * records `OUT[id]`, and continues. `phase(id)` gates the run surface
 * like a template node. Filter-by-predicate is deferred: v1 is the
 * closed {@link FlowListOp} set, not an open expression language.
 */
export interface FlowListNode extends FlowNodeBase {
  readonly type: 'list'
  /** A JS expression over `OUT`/`args` that should yield an array. */
  readonly source: string
  readonly op: FlowListOp
}

/** One exclusive class a classify node may emit. */
export interface FlowClassifyClass {
  /** Stable class id; also the outgoing-edge label that class visits. */
  readonly id: string
  /** Optional display name for the canvas inspector. */
  readonly name?: string
}

/**
 * An LLM-backed exclusive classifier — Dify's Question Classifier. Compiles
 * to `agent(query, { schema })` whose structured output is `{ class }` over
 * the closed {@link classes} set, then visits the outgoing edge labeled with
 * that class id (or `default` when the child returns null / an unknown
 * class). Class edges are mutually exclusive, like a condition.
 */
export interface FlowClassifyNode extends FlowNodeBase {
  readonly type: 'classify'
  /**
   * The text to classify. Compiled as a JS template literal, so it may
   * interpolate `${variable}` and `${OUT['<nodeId>']}` like an agent prompt.
   */
  readonly query: string
  readonly classes: readonly FlowClassifyClass[]
}

/** Scalar JSON Schema types a parameter-extractor field may declare. */
export type FlowExtractParamType = 'string' | 'number' | 'integer' | 'boolean'

/** One named field a parameter-extractor node asks the model to fill. */
export interface FlowExtractParam {
  readonly name: string
  readonly type: FlowExtractParamType
  readonly description?: string
  /** When true, the compiled schema lists this name in `required`. */
  readonly required?: boolean
}

/**
 * An LLM-backed structured extractor — Dify's Parameter Extractor. Compiles
 * to `agent(query, { schema })` whose schema is the object of
 * {@link parameters}. Continuation is unlabeled, like an agent node.
 */
export interface FlowExtractNode extends FlowNodeBase {
  readonly type: 'extract'
  /**
   * The text to extract from. Compiled as a JS template literal, so it may
   * interpolate `${variable}` and `${OUT['<nodeId>']}` like an agent prompt.
   */
  readonly query: string
  readonly parameters: readonly FlowExtractParam[]
}

/**
 * An explicit reconverge after a parallel fan-out — Dify's join. Incoming
 * branches may all run; the compiler waits for every arm (`parallel()`)
 * then visits this node once. Arms whose only successor is this join
 * return `OUT` instead of visiting it. `phase(id)` gates the run surface.
 */
export interface FlowJoinNode extends FlowNodeBase {
  readonly type: 'join'
}

/** Any flow node, discriminated on `type`. */
export type FlowNode =
  | FlowStartNode
  | FlowEndNode
  | FlowAgentNode
  | FlowConditionNode
  | FlowLoopNode
  | FlowHttpNode
  | FlowTemplateNode
  | FlowCodeNode
  | FlowAggregateNode
  | FlowListNode
  | FlowClassifyNode
  | FlowExtractNode
  | FlowJoinNode

/** One directed connection between two nodes. */
export interface FlowEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  /**
   * Branch label. A condition node's outgoing edges carry `true`/`false`; a
   * loop node's carry `body`/`after`; a classify node's carry a class id or
   * `default`; all other edges carry none.
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
  /**
   * Per-node outputs from the script's returned `OUT` map, present after a
   * completed run when the workflow result value is a plain object. Values
   * are the emitting hook's return — `agent()`'s text/structured JSON,
   * `http()`'s `WebFetchResult` JSON, or `code()`'s `CodeRunResult` JSON;
   * absent keys never ran or returned nothing JSON-safe.
   */
  readonly nodeOutputs?: Readonly<Record<string, JsonValue>>
  /**
   * Per-node input snapshot: `OUT` as it stood when `visit(id)` began.
   * Present after a completed run when the script returned the `{ OUT, IN }`
   * envelope. Used by the Variable Inspector to show what a node saw and to
   * seed a downstream re-run.
   */
  readonly nodeInputs?: Readonly<Record<string, JsonValue>>
  /**
   * Wall-clock ms from `workflow/agent-start` to `workflow/agent-end` for
   * agent nodes that produced both events (live once the call ends).
   */
  readonly nodeDurationsMs?: Readonly<Record<string, number>>
}
