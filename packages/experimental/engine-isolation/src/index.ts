/**
 * Engine-isolation package entry: the D3 engine-driver seam mounted as
 * `ctx.engineIsolation`, the in-process and process-out drivers, and the
 * isolation router. This is an experimental, source-only package with no built
 * runtime; consumers import it through the workspace `./src/*` exports.
 * @module @deepseek-ai/dsh-experimental-engine-isolation
 */

import type {} from '@deepseek-ai/dsh-session'

export { EngineIsolationService as default, EngineIsolationService, type EngineIsolationConfig } from './service.ts'
export { InProcessEngineDriver, type EngineRunner, type InProcessConfig } from './in-process.ts'
export { ProcessOutEngineDriver, parseWorkerResult, type ProcessOutConfig, type WorkerResult } from './process-out.ts'
export { resolveEngineDriver, type DriverSet } from './router.ts'
export { EngineIsolationError, type EngineIsolationErrorCode } from './error.ts'
export type * from './types.ts'
