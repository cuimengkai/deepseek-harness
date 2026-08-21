/**
 * Platform shell control-plane package entry: the durable business-object
 * store (tenant/RBAC, asset store + lineage, business approval, audit) exposed
 * as the `ctx.platformShell` service, plus the model-visible tools over it.
 * @module @deepseek-ai/dsh-experimental-platform-shell
 */

import type {} from '@deepseek-ai/dsh-session'

export { PlatformShellService as default, PlatformShellService, DEFAULT_ROLES } from './service.ts'
export { PlatformShellError, errorMessage, type PlatformShellErrorCode } from './error.ts'
export { registerPlatformShellTools, type ResolveActor } from './tools.ts'
export { registerCapabilityExecutionGate, type ResolveWorkspace } from './execution-gate.ts'
export type * from './types.ts'
