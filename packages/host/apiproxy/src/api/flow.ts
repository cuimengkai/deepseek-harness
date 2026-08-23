/**
 * flow domain contract: the visual flow-engine surface the canvas authors and
 * runs. The four store methods (list/get/save/delete) resolve the project root
 * from the payload `cwd` and read/write `.dsh/flows/` under it — project files,
 * so they are privileged (see PRIVILEGED_METHODS in dsh-client-connection); the
 * wire never carries a Host path. The four run methods (run/getRun/listRuns/
 * stop) address the flow engine's in-memory run surface by run id; `run`
 * resolves the session's agent as the parent of every child.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FlowGraph, FlowRunSnapshot, FlowRunSummary, FlowSummary } from '@deepseek-ai/dsh-flow/types'

/** flow-domain unary methods (the map keys flow.* of RpcMethodMap). */
export interface FlowApi {
  /** List the flows saved under `<cwd>/.dsh/flows`, newest last. */
  list(request: RpcRequest<{ cwd: string }>): Promise<RpcResponse<{ flows: FlowSummary[] }>>
  /** Read one saved flow, re-validated on load.
   * @throws flow-not-found when the flow does not exist, flow-version for a
   *   newer on-disk format, flow-invalid for a stored document that no longer
   *   validates.
   */
  get(request: RpcRequest<{ cwd: string; id: string }>): Promise<RpcResponse<FlowGraph>>
  /** Validate and persist a flow graph under `<cwd>/.dsh/flows`.
   * @throws flow-invalid when the graph fails validation.
   */
  save(request: RpcRequest<{ cwd: string; graph: FlowGraph }>): Promise<RpcResponse<{ id: string }>>
  /** Delete a saved flow.
   * @throws flow-not-found when no such flow exists.
   */
  delete(request: RpcRequest<{ cwd: string; id: string }>): Promise<RpcResponse<{}>>
  /**
   * Compile and start a flow run under the session's agent. The graph comes
   * from the payload (an unsaved canvas graph may run), so no project read is
   * involved; the run is off-loop and its children are attributed to the
   * session's main agent. The request signal aborts the run.
   * @throws flow-invalid for an invalid graph and flow-cap at the live-run
   *   ceiling.
   */
  run(request: RpcRequest<{ sessionId: SessionId; graph: FlowGraph; input?: unknown }>, signal: AbortSignal):
  Promise<RpcResponse<{ runId: string }>>
  /** Read one run's live snapshot; `null` when the run is unknown or pruned. */
  getRun(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: FlowRunSnapshot | null }>>
  /** List tracked runs, newest first, optionally filtered to one flow. */
  listRuns(request: RpcRequest<{ flowId?: string }>): Promise<RpcResponse<{ runs: FlowRunSummary[] }>>
  /** Cancel a live run.
   * @throws flow-run-not-found for an unknown or already-settled run.
   */
  stop(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{}>>
}
