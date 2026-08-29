/**
 * Visual flow engine: compiles a node/edge flow graph (agents, conditions,
 * loops, parallel fan-out, and agent nodes that embed a sub-graph) into a
 * workflow script and runs it off-loop via `@deepseek-ai/dsh-workflow`. The
 * {@link FlowEngine} service owns the graph vocabulary, validation,
 * persistence, and the event-derived run surface; the canvas reads run status
 * by polling `getRun` — the service emits no events, so no forwarded RPC event
 * is required for v1.
 * @module @deepseek-ai/dsh-flow
 */

import { FlowEngine } from './service.ts'
import type {
  FlowEngineConfig,
  FlowRunHandle,
  FlowRunOutcome,
  FlowRunRequest,
} from './service.ts'

export { FlowError } from './error.ts'
export type { FlowErrorCode } from './error.ts'
export { FlowRunId } from './types.ts'
export type {
  FlowAggregateItem,
  FlowAggregateMode,
  FlowAggregateNode,
  FlowAgentNode,
  FlowAgentOptions,
  FlowClassifyClass,
  FlowClassifyNode,
  FlowCodeNode,
  FlowConditionNode,
  FlowEdge,
  FlowEndNode,
  FlowExtractNode,
  FlowExtractParam,
  FlowExtractParamType,
  FlowFile,
  FlowGraph,
  FlowHttpNode,
  FlowJoinNode,
  FlowId,
  FlowListNode,
  FlowListOp,
  FlowLoopNode,
  FlowModelKindBinding,
  FlowNode,
  FlowNodeBase,
  FlowNodeStatus,
  FlowNodeType,
  FlowRunSnapshot,
  FlowRunStatus,
  FlowRunSummary,
  FlowStartNode,
  FlowSummary,
  FlowTemplateNode,
} from './types.ts'
export { FLOW_FORMAT_VERSION } from './types.ts'
export { compileFlow } from './compile.ts'
export type { CompiledFlow, CompileFlowOptions } from './compile.ts'
export { expandGraph } from './expand.ts'
export type { ExpandedFlow } from './expand.ts'
export { validateFlow } from './validate.ts'
export type { FlowValidation, FlowValidationFailure, FlowValidationOk } from './validate.ts'
export { FlowEngine }
export type { FlowEngineConfig, FlowRunHandle, FlowRunOutcome, FlowRunRequest }

declare module '@deepseek-ai/cordis' {
  interface Context {
    flowEngine: FlowEngine
  }
}

export default FlowEngine
