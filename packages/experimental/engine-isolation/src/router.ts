/**
 * Isolation router: maps one workspace to the engine driver that runs its
 * agent — the process-out driver for isolated workspaces, the in-process
 * driver for shared ones. The isolation record is authoritative in the
 * platform control-plane store, so the router consults the store's probe and
 * never guesses; an unknown workspace fails loud.
 * @module @deepseek-ai/dsh-experimental-engine-isolation/router
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-platform-shell/src/service.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell'
import type { EngineDriver } from './types.ts'

/** The two candidate drivers a workspace's engine can be. */
export interface DriverSet {
  readonly inProcess: EngineDriver
  readonly processOut: EngineDriver
}

/**
 * Resolve the engine driver one workspace's runs use.
 * @param ctx - context carrying the platformShell control-plane service.
 * @param drivers - the in-process and process-out candidates.
 * @param workspaceId - the workspace to route.
 * @returns the process-out driver for an isolated workspace, the in-process
 * driver for a shared one.
 * @throws the platform store's UNKNOWN_WORKSPACE when the workspace does not exist.
 */
export function resolveEngineDriver(ctx: Context, drivers: DriverSet, workspaceId: WorkspaceId): EngineDriver {
  return ctx.platformShell.workspaceIsolation(workspaceId) ? drivers.processOut : drivers.inProcess
}
