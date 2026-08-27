/**
 * context-composition domain zod schemas (names derived from the map key:
 * contextCompositionReadRequestSchema / contextCompositionReadValueSchema).
 * The value schema restates the pure `types.ts` vocabulary so the browser
 * validates the wire without importing the host-side service graph.
 */

import { z } from 'zod'
import type { RequestPayload } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { ContextComposition } from '@deepseek-ai/dsh-context-composition/types'

/** One tool-schema row of the envelope's tool catalog. */
const contextToolRowSchema = z.object({
  name: z.string(),
  tokens: z.number().int().nonnegative(),
})

/** The request envelope the NEXT request compares against. */
const contextEnvelopeSchema = z.object({
  provider: z.string(),
  model: z.string(),
  system: z.string().nullable(),
  systemTokens: z.number().int().nonnegative(),
  tools: z.array(contextToolRowSchema),
  toolsTokens: z.number().int().nonnegative(),
})

/** One priced row of the model-visible conversation surface. */
const contextSurfaceRowSchema = z.object({
  seq: z.number().int().nonnegative(),
  role: z.string(),
  tokens: z.number().int().nonnegative(),
  preview: z.string().nullable(),
})

/** One completed compaction read back from the durable log. */
const contextCompactionEntrySchema = z.object({
  summarySeq: z.number().int().nonnegative(),
  model: z.string(),
  provider: z.string(),
  summary: z.string().nullable(),
  shadowedCount: z.number().int().nonnegative(),
  shadowedTokens: z.number().int().nonnegative(),
})

/** contextComposition.read request payload. */
export const contextCompositionReadRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'contextComposition.read'>>>

/** contextComposition.read response value. */
export const contextCompositionReadValueSchema = z.object({
  logRevision: z.number().int().nonnegative(),
  envelope: contextEnvelopeSchema.nullable(),
  surface: z.array(contextSurfaceRowSchema),
  surfaceTokens: z.number().int().nonnegative(),
  contextWindow: z.number().int().positive().nullable(),
  compactions: z.array(contextCompactionEntrySchema),
}) satisfies z.ZodType<Wire<ContextComposition>>
