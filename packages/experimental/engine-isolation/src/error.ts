/**
 * Engine-isolation package error with a stable structured code. Process-out
 * failures that carry a code are the stable contract; the message text is
 * context for the operator.
 * @module @deepseek-ai/dsh-experimental-engine-isolation/error
 */

/** The stable error codes the engine-isolation package can throw. */
export type EngineIsolationErrorCode = 'ENGINE_SPAWN_FAILED'

/**
 * A structured engine-isolation failure.
 * @param code - the stable failure code.
 * @param message - human-readable failure context.
 */
export class EngineIsolationError extends Error {
  constructor(
    readonly code: EngineIsolationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'EngineIsolationError'
  }
}
