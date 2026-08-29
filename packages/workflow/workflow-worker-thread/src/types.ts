/**
 * Non-protocol wire vocabulary for the worker-thread engine: the `workerData` init payload and
 * the child-port interfaces the worker-side runtime consumes. Host/worker messages are defined in
 * `./protocol.ts`; transported child requests and results are plain JSON for structured clone.
 * @module @deepseek-ai/dsh-workflow-worker-thread/types
 */

import type { CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import type { ContentBlock, ModelKind } from '@deepseek-ai/dsh-llm'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { WebFetchResult } from '@deepseek-ai/dsh-web'
import type { WorkflowMeta } from '@deepseek-ai/dsh-workflow'

/**
 * The per-run limits the worker-side runtime enforces. The host keeps the
 * knobs only it can act on (`provider`, `disposeGraceMs`).
 */
export interface WorkerLimits {
  /** Concurrent `agent()` ceiling (already auto-resolved; ≥ 1). */
  maxConcurrentAgents: number
  /** Total `agent()` calls per run (the runaway-loop backstop). */
  maxTotalAgents: number
  /** Items accepted by one `parallel()`/`pipeline()` call. */
  maxItemsPerCall: number
  /** vm timeout for the script's initial synchronous slice (inside the worker). */
  syncTimeoutMs: number
}

/** The `workerData` payload one run is initialized with (host → worker, once, at spawn). */
export interface WorkerInit {
  /** The validated meta block (plain data off the start request, validated host-side). */
  meta: WorkflowMeta
  /** The plain-JS script body, exactly as the start request carried it. */
  body: string
  /** The run's `args` value; the workerData structured clone is the copy that isolates the caller. */
  args?: unknown
  /** The worker-enforced limits. */
  limits: WorkerLimits
}

/** What the worker asks the host to start for one `agent()` call (options already validated worker-side). */
export interface ChildStartRequest {
  /** The child's prompt text. */
  prompt: string
  /** The structured-output schema, if the call passed one (already subset-checked). */
  schema?: ObjectJsonSchema
  /** The per-child provider override, if the call passed one. */
  provider?: string
  /** The per-child model override, if the call passed one. */
  model?: string
  /**
   * Per-kind model routes, if the call passed them; forwarded onto the
   * child's `AgentOptions.modelKinds`, whose `text` entry then overrides the
   * child's provider/model for its (single) request channel.
   */
  modelKinds?: Partial<Record<ModelKind, { provider?: string; model?: string }>>
  /**
   * Optional child agent-preset id. When set, the host mounts that preset on
   * the child instead of joining the parent's standing composition.
   */
  childPresetId?: string
}

/**
 * The JSON projection of a child's `SubagentResult` crossing the port. The
 * seam's `stopReason` union is merge-extensible, so it degrades to `string`
 * on the wire — the runtime only ever branches on `'completed'`.
 */
export interface ChildResult {
  /** The child's final assistant output blocks. */
  output: ContentBlock[]
  /** The structured value, present iff the request carried a schema AND the provider honored it. */
  structured?: unknown
  /** Why the child run ended (`'completed'` is the only value the runtime branches on). */
  stopReason: string
}

/**
 * The worker-side handle for one started child — the RPC mirror of the
 * subagent seam's run handle, reduced to what the runtime consumes.
 */
export interface ChildHandle {
  /** The child agent's id (minted host-side by the subagent seam). */
  readonly id: string
  /**
   * Resolves with the child's terminal {@link ChildResult}; REJECTS only when
   * the host reports an infrastructure fault (`child-failed`) — a child that
   * failed for its own reasons resolves with a non-`completed` stop reason.
   */
  readonly result: Promise<ChildResult>
  /** Ask the host to dispose the child; resolves on the host's ack. */
  dispose(): Promise<void>
}

/**
 * The worker-side port the runtime starts child agents through — the seam
 * that lets the execution core stay ignorant of the thread boundary.
 */
export interface ChildPort {
  /**
   * Start one child agent on the host (the `agent()` hook's start half).
   * @param request - the prompt and validated options.
   * @returns the published child handle; rejects when synchronous start or the
   *   provider's asynchronous start fails.
   */
  startAgent(request: ChildStartRequest): Promise<ChildHandle>
}

/** What the worker asks the host to retrieve for one `http()` call. */
export interface HttpFetchRequest {
  /** The request URL (already interpolated worker-side). */
  readonly url: string
}

/**
 * The JSON projection of one `http()` call's result crossing the port —
 * `ctx.web.fetch`'s own result shape (already plain JSON).
 */
export type HttpFetchOutcome = WebFetchResult

/**
 * The worker-side port the runtime issues `http()` calls through — the single
 * request/response seam for the flow engine's HTTP Request node, mirroring
 * {@link ChildPort} but with no published-child lifecycle: one call is one
 * round trip.
 */
export interface HttpPort {
  /**
   * Retrieve one URL on the host through `ctx.web.fetch` (the `http()` hook's
   * only half — there is no separate dispose).
   * @param request - the URL to retrieve.
   * @returns the retrieval outcome; rejects when the host has no usable web
   *   fetch provider or the provider itself fails.
   */
  fetch(request: HttpFetchRequest): Promise<HttpFetchOutcome>
}

/** What the worker asks the host to run for one `code()` call. */
export interface CodeExecuteRequest {
  /**
   * The full program text, already carrying its `const OUT = <json>;`
   * prelude (spliced in worker-side, ahead of the flow-authored source) so
   * the sandboxed program sees the flow's current outputs as ordinary data,
   * never as a host binding call.
   */
  readonly program: string
}

/**
 * The JSON projection of one `code()` call's result crossing the port —
 * `ctx.codeRuntime.run()`'s own result shape (already plain JSON: a
 * completion `value`, ordered `logs`, and an optional `error`).
 */
export type CodeExecuteOutcome = CodeRunResult

/**
 * The worker-side port the runtime issues `code()` calls through — the
 * single request/response seam for the flow engine's Code node, mirroring
 * {@link HttpPort}: one call is one round trip, with no published-child
 * lifecycle.
 */
export interface CodePort {
  /**
   * Run one program on the host through `ctx.codeRuntime.run()` (the
   * `code()` hook's only half — there is no separate dispose).
   * @param request - the program to run.
   * @returns the run's outcome; rejects only when the host has no usable
   *   code runtime — a failed or budget-exceeded program still resolves,
   *   per {@link CodeRunResult}'s own contract.
   */
  execute(request: CodeExecuteRequest): Promise<CodeExecuteOutcome>
}
