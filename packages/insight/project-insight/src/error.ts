/**
 * Structured project-insight failures. Extends {@link HarnessError} so tool
 * bodies surface the stable code in `tool/result.error` (the tools runtime
 * extracts `{ name, code }` from `HarnessError` subclasses).
 * @module @deepseek-ai/dsh-project-insight/error
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Closed set of project-insight failure codes. */
export type ProjectInsightErrorCode =
  | 'NO_SESSION'
  | 'NO_CWD'
  | 'DOC_UNREADABLE'
  | 'SCAN_FAILED'

/**
 * A structured project-insight failure with a stable code and context message.
 * The constructor keeps `(code, message)` order, matching platform-shell.
 */
export class ProjectInsightError extends HarnessError {
  override readonly code: ProjectInsightErrorCode

  constructor(
    code: ProjectInsightErrorCode,
    message: string,
  ) {
    super(message, code)
    this.code = code
    this.name = 'ProjectInsightError'
  }
}

/**
 * Recover the message text from an unknown throw value.
 * @param error - the throw value to read.
 * @returns the error message, or the stringified value for non-Error throws.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
