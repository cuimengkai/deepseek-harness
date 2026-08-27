/**
 * flow domain zod schemas (names derived from the map key: flowListRequestSchema /
 * flowListValueSchema, and so on). The value schemas re-declare the flow graph
 * and run vocabulary so the browser validates the wire without importing the
 * flow engine's host runtime.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { FlowGraph, FlowNodeStatus, FlowRunSnapshot, FlowRunSummary, FlowRunStatus, FlowSummary } from '@deepseek-ai/dsh-flow/types'

/** Canvas position of one flow node. */
const flowPositionSchema = z.object({ x: z.number(), y: z.number() })

const flowStartNodeSchema = z.object({
  id: z.string(),
  type: z.literal('start'),
  position: flowPositionSchema,
  label: z.string().optional(),
}) satisfies z.ZodType<Wire<{ id: string; type: 'start'; position: { x: number; y: number }; label?: string }>>

const flowEndNodeSchema = z.object({
  id: z.string(),
  type: z.literal('end'),
  position: flowPositionSchema,
  label: z.string().optional(),
}) satisfies z.ZodType<Wire<{ id: string; type: 'end'; position: { x: number; y: number }; label?: string }>>

const flowAgentNodeSchema = z.object({
  id: z.string(),
  type: z.literal('agent'),
  position: flowPositionSchema,
  label: z.string().optional(),
  prompt: z.string(),
  agentOptions: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    modelKinds: z.record(z.string(), z.object({
      provider: z.string().optional(),
      model: z.string().optional(),
    })).optional(),
  }).optional(),
  // The preset-composition subset a preset graph's agent node projects; a
  // session flow canvas never sends it.
  composition: z.object({
    id: z.string().min(1).optional(),
    module: z.string().min(1),
    config: z.unknown().optional(),
    group: z.boolean().nullable().optional(),
    disabled: z.unknown().optional(),
    inject: z.unknown().optional(),
  }).optional(),
}) satisfies z.ZodType<Wire<{
  id: string
  type: 'agent'
  position: { x: number; y: number }
  label?: string
  prompt: string
  agentOptions?: {
    provider?: string
    model?: string
    modelKinds?: Record<string, { provider?: string; model?: string }>
  }
  composition?: {
    id?: string
    module: string
    config?: unknown
    group?: boolean | null
    disabled?: unknown
    inject?: unknown
  }
}>>

const flowConditionNodeSchema = z.object({
  id: z.string(),
  type: z.literal('condition'),
  position: flowPositionSchema,
  label: z.string().optional(),
  expression: z.string(),
}) satisfies z.ZodType<Wire<{
  id: string
  type: 'condition'
  position: { x: number; y: number }
  label?: string
  expression: string
}>>

const flowLoopNodeSchema = z.object({
  id: z.string(),
  type: z.literal('loop'),
  position: flowPositionSchema,
  label: z.string().optional(),
  iterable: z.string(),
  variable: z.string(),
}) satisfies z.ZodType<Wire<{
  id: string
  type: 'loop'
  position: { x: number; y: number }
  label?: string
  iterable: string
  variable: string
}>>

/** One flow node, discriminated on `type`. */
const flowNodeSchema = z.discriminatedUnion('type', [
  flowStartNodeSchema,
  flowEndNodeSchema,
  flowAgentNodeSchema,
  flowConditionNodeSchema,
  flowLoopNodeSchema,
]) satisfies z.ZodType<Wire<FlowGraph['nodes'][number]>>

/** One directed connection between two nodes. */
const flowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
}) satisfies z.ZodType<Wire<{ id: string; from: string; to: string; label?: string }>>

/** The flow graph a canvas authors and the service persists/runs. Shared with the preset graph wire. */
export const flowGraphSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
}) satisfies z.ZodType<Wire<FlowGraph>>

/** Why a flow run currently is where it is. */
const flowRunStatusSchema = z.union([
  z.literal('running'),
  z.literal('completed'),
  z.literal('cancelled'),
  z.literal('error'),
]) satisfies z.ZodType<Wire<FlowRunStatus>>

/** One node's live-run status. */
const flowNodeStatusSchema = z.union([
  z.literal('pending'),
  z.literal('running'),
  z.literal('done'),
  z.literal('failed'),
  z.literal('cancelled'),
]) satisfies z.ZodType<Wire<FlowNodeStatus>>

/** Listing row for the flows pane. */
const flowSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  nodeCount: z.number().int().nonnegative(),
  updatedAt: z.number().int(),
}) satisfies z.ZodType<Wire<FlowSummary>>

/** One live or settled run, as listRuns exposes it. */
const flowRunSummarySchema = z.object({
  runId: z.string(),
  flowId: z.string(),
  flowName: z.string(),
  status: flowRunStatusSchema,
  startedAt: z.number().int(),
}) satisfies z.ZodType<Wire<FlowRunSummary>>

/** A run's live snapshot, as getRun exposes it. */
const flowRunSnapshotSchema = flowRunSummarySchema.extend({
  stopReason: z.union([
    z.literal('completed'),
    z.literal('cancelled'),
    z.literal('error'),
  ]).optional(),
  error: z.string().optional(),
  agentsStarted: z.number().int().nonnegative(),
  nodeStatuses: z.record(z.string(), flowNodeStatusSchema),
}) satisfies z.ZodType<Wire<FlowRunSnapshot>>

// ---- flow.list ----
/** `flow.list` request payload: the working directory whose stored flows to enumerate. */
export const flowListRequestSchema = z.object({
  cwd: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'flow.list'>>>
/** `flow.list` response value: the flow summaries stored under the working directory. */
export const flowListValueSchema = z.object({
  flows: z.array(flowSummarySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'flow.list'>>>

// ---- flow.get ----
/** `flow.get` request payload: the working directory and flow id to load. */
export const flowGetRequestSchema = z.object({
  cwd: z.string().min(1),
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'flow.get'>>>
/** `flow.get` response value: the stored flow graph. */
export const flowGetValueSchema = flowGraphSchema satisfies z.ZodType<Wire<ResponseValue<'flow.get'>>>

// ---- flow.save ----
/** `flow.save` request payload: the working directory and the flow graph to persist. */
export const flowSaveRequestSchema = z.object({
  cwd: z.string().min(1),
  graph: flowGraphSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'flow.save'>>>
/** `flow.save` response value: the id under which the graph was stored. */
export const flowSaveValueSchema = z.object({
  id: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'flow.save'>>>

// ---- flow.delete ----
/** `flow.delete` request payload: the working directory and flow id to remove. */
export const flowDeleteRequestSchema = z.object({
  cwd: z.string().min(1),
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'flow.delete'>>>
/** `flow.delete` response value: empty on success. */
export const flowDeleteValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'flow.delete'>>>

// ---- flow.run ----
/** `flow.run` request payload: the session to drive, the flow graph, and the optional run input. */
export const flowRunRequestSchema = z.object({
  sessionId: sessionIdSchema,
  graph: flowGraphSchema,
  input: z.unknown().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'flow.run'>>>
/** `flow.run` response value: the started run's id. */
export const flowRunValueSchema = z.object({
  runId: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'flow.run'>>>

// ---- flow.getRun ----
/** `flow.getRun` request payload: the run id to look up. */
export const flowGetRunRequestSchema = z.object({
  runId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'flow.getRun'>>>
/** `flow.getRun` response value: the run snapshot, or null when the id is unknown. */
export const flowGetRunValueSchema = z.object({
  run: flowRunSnapshotSchema.nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'flow.getRun'>>>

// ---- flow.listRuns ----
/** `flow.listRuns` request payload: optionally restrict the listing to one flow's runs. */
export const flowListRunsRequestSchema = z.object({
  flowId: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'flow.listRuns'>>>
/** `flow.listRuns` response value: the run summaries the filter selected. */
export const flowListRunsValueSchema = z.object({
  runs: z.array(flowRunSummarySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'flow.listRuns'>>>

// ---- flow.stop ----
/** `flow.stop` request payload: the run id to stop. */
export const flowStopRequestSchema = z.object({
  runId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'flow.stop'>>>
/** `flow.stop` response value: empty once the stop was requested. */
export const flowStopValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'flow.stop'>>>
