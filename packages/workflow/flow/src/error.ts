/**
 * Typed flow-engine failures. A stable `code` lets the RPC map each failure to
 * a routable response without parsing `message`.
 * @module @deepseek-ai/dsh-flow/error
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable machine-routable failure classes for the flow capability. */
export type FlowErrorCode =
  | 'FLOW_INVALID' // a graph fails validation, or an on-disk doc is malformed/oversized
  | 'FLOW_NOT_FOUND' // no flow by that id
  | 'FLOW_VERSION' // an on-disk doc carries an unsupported formatVersion
  | 'FLOW_RUN_NOT_FOUND' // no live or settled run by that id
  | 'FLOW_CAP' // the live-run or history bound is exhausted
  | 'FLOW_ENGINE_ABSENT' // the composition lacks the workflowEngine service

/** A flow operation that cannot be honored, with a routable `code`. */
export class FlowError extends HarnessError {
  constructor(message: string, code: FlowErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'FlowError'
  }
}
