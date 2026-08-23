/**
 * agent-presets domain zod schemas (names derived from map keys:
 * agentPresetListRequestSchema / agentPresetListValueSchema).
 */

import { z } from 'zod'
import { flowGraphSchema } from './flow.schema.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { AgentPresetEntry, ComposeRow } from './agent-presets.ts'

/** AgentPresetEntry row of agentPreset.list. */
export const agentPresetEntrySchema = z.object({
  id: z.string().min(1),
  trust: z.union([z.literal('system'), z.literal('user')]),
  isDefault: z.boolean(),
  name: z.string().optional(),
  description: z.string().optional(),
  broken: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<AgentPresetEntry>>

/** One composition row carried by agentPreset.read / agentPreset.compose. */
export const agentPresetComposeRowSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  config: z.unknown().optional(),
  group: z.boolean().nullable().optional(),
  disabled: z.unknown().optional(),
  inject: z.unknown().optional(),
}) satisfies z.ZodType<Wire<ComposeRow>>

/** agentPreset.list request payload. */
export const agentPresetListRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.list'>>>

/** agentPreset.list response value. */
export const agentPresetListValueSchema = z.object({
  presets: z.array(agentPresetEntrySchema),
  authorable: z.boolean(),
  hasDocument: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.list'>>>

/** agentPreset.select request payload. */
export const agentPresetSelectRequestSchema = z.object({
  sessionId: sessionIdSchema,
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.select'>>>

/** agentPreset.select response value. */
export const agentPresetSelectValueSchema = z.object({
  agentPreset: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.select'>>>

/** agentPreset.read request payload. */
export const agentPresetReadRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.read'>>>

/** agentPreset.read response value. */
export const agentPresetReadValueSchema = z.object({
  agentPreset: z.string(),
  trust: z.union([z.literal('system'), z.literal('user')]),
  content: z.string(),
  rows: z.array(agentPresetComposeRowSchema),
  name: z.string().optional(),
  description: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.read'>>>

/** agentPreset.copy request payload. */
export const agentPresetCopyRequestSchema = z.object({
  from: z.string().min(1),
  agentPreset: z.string().min(1),
  name: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.copy'>>>

/** agentPreset.copy response value. */
export const agentPresetCopyValueSchema = z.object({
  agentPreset: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.copy'>>>

/** agentPreset.openDocument request payload. */
export const agentPresetOpenDocumentRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.openDocument'>>>

/** agentPreset.openDocument response value. */
export const agentPresetOpenDocumentValueSchema = z.union([
  z.object({ opened: z.literal(true) }),
  z.object({ opened: z.literal(false), path: z.string() }),
]) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.openDocument'>>>

/** agentPreset.remove request payload. */
export const agentPresetRemoveRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.remove'>>>

/** agentPreset.remove response value. */
export const agentPresetRemoveValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.remove'>>>

/** agentPreset.compose request payload. */
export const agentPresetComposeRequestSchema = z.object({
  agentPreset: z.string().min(1),
  rows: z.array(agentPresetComposeRowSchema).min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  overwrite: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.compose'>>>

/** agentPreset.compose response value. */
export const agentPresetComposeValueSchema = z.object({
  agentPreset: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.compose'>>>

/** agentPreset.readGraph request payload. */
export const agentPresetReadGraphRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.readGraph'>>>

/** agentPreset.readGraph response value. */
export const agentPresetReadGraphValueSchema = z.object({
  agentPreset: z.string(),
  trust: z.union([z.literal('system'), z.literal('user')]),
  graph: flowGraphSchema,
  name: z.string().optional(),
  description: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.readGraph'>>>

/** agentPreset.saveGraph request payload. */
export const agentPresetSaveGraphRequestSchema = z.object({
  agentPreset: z.string().min(1),
  graph: flowGraphSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  overwrite: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.saveGraph'>>>

/** agentPreset.saveGraph response value. */
export const agentPresetSaveGraphValueSchema = z.object({
  agentPreset: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.saveGraph'>>>
