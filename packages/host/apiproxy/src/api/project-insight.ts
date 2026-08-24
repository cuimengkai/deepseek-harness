/**
 * project-insight domain contract: the versioned workspace scan document the
 * develop-mode insight tabs render.
 *
 * `read` is privileged (see PRIVILEGED_METHODS in dsh-client-connection):
 * reading the document reads project files and the freshness check walks the
 * tree — reconnaissance. The request carries a working directory the Host
 * resolves to a project root; the wire never carries a Host path. The document
 * is bounded at scan time (source/manifest/edge caps) and by the whole-doc
 * byte guard, so `read` forwards it as produced.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { ProjectInsightDoc } from '@deepseek-ai/dsh-project-insight'

/** Whether a stored document exists and matches the current tree. */
export type ProjectInsightReadStatus = 'none' | 'fresh' | 'stale' | 'error'

/** projectInsight.read response value. */
export interface ProjectInsightReadResult {
  readonly status: ProjectInsightReadStatus
  /** Project root basename — identity only, never a Host path. */
  readonly root: string
  /** The stored document, when one exists and parses. */
  readonly doc?: ProjectInsightDoc
  /** Human-readable failure text when `status` is `'error'`. */
  readonly error?: string
}

/** project-insight-domain unary methods (the map key projectInsight.* of RpcMethodMap). */
export interface ProjectInsightApi {
  /**
   * Read the stored project-insight document for a working directory.
   *
   * Resolves the project root upward from `cwd`, reads the committed `.dsh/insight/`
   * document, and reports fresh/stale by recomputing the stat-only structural
   * signature. A project never scanned reports `none`; an over-cap, unparsable,
   * or wrong-version document reports `error`. No scan is triggered here — the host-plane
   * auto-scan hook owns that, and the client learns of completion through the
   * forwarded `project-insight/updated` event — so a stale result is the
   * caller's signal to wait for the scan or re-open.
   */
  read(request: RpcRequest<{ cwd: string }>, signal: AbortSignal):
  Promise<RpcResponse<ProjectInsightReadResult>>
}
