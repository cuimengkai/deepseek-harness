import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Closed set of platform-shell failure codes. */
export type PlatformShellErrorCode =
  | 'UNKNOWN_ASSET_KIND'
  | 'UNKNOWN_ACTOR'
  | 'UNKNOWN_WORKSPACE'
  | 'PERMISSION_DENIED'
  | 'ASSET_NOT_FOUND'
  | 'TICKET_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'INVALID_ARGUMENT'
  | 'CAPABILITY_NOT_FOUND'
  | 'CAPABILITY_DEPENDENCY_MISSING'
  | 'CAPABILITY_CONFLICT'
  | 'CAPABILITY_DISABLED'
  | 'VERSION_MISMATCH'
  | 'SCENARIO_NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'DUPLICATE_CAPABILITY'
  | 'DUPLICATE_SCENARIO'

/**
 * A structured platform-shell failure with a stable code and context message.
 * Extends {@link HarnessError} so tool bodies surface the platform code in
 * `tool/result.error` (the tools runtime extracts `{ name, code }` from
 * `HarnessError` subclasses); the constructor keeps `(code, message)` order.
 */
export class PlatformShellError extends HarnessError {
  override readonly code: PlatformShellErrorCode

  constructor(
    code: PlatformShellErrorCode,
    message: string,
  ) {
    super(message, code)
    this.code = code
    this.name = 'PlatformShellError'
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
