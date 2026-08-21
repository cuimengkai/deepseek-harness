/**
 * Runtime capability execution gate: the around-dispatch `tools/execute`
 * waterfall that re-checks each gated tool's fresh market gate per workspace
 * and refuses `CAPABILITY_DISABLED` at invocation time. This is what turns the
 * assembly-time gate (absence from the mounted composition) into a runtime
 * block; the read joins the live catalog row, so an operator's gate flip takes
 * effect on the next call (platform-capability-market §5).
 * @module @deepseek-ai/dsh-experimental-platform-shell/execution-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { assertGateOpen } from './capability-market.ts'
import type { WorkspaceId } from './types.ts'

/** Resolve the platform workspace one session runs in. */
export type ResolveWorkspace = (session: Session) => WorkspaceId

/**
 * Register the runtime capability execution gate. Every `tools/execute` call is
 * matched against the tool's owning capability (fresh gate state, never a
 * cached snapshot); a closed gate throws `CAPABILITY_DISABLED`, which the tools
 * runtime surfaces as an error result with that code. Unowned tools and
 * non-agent executions delegate unchanged — the platform tool body owns the
 * no-session error.
 * @param ctx - context with the mounted `platformShell` service and `tools` registry.
 * @param options - the session-to-workspace binding for the deployment.
 */
export function registerCapabilityExecutionGate(
  ctx: Context,
  options: { readonly resolveWorkspace: ResolveWorkspace },
): void {
  const { resolveWorkspace } = options
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const agent = exec.agent
    // A non-agent execution has no workspace to gate against; the platform tool
    // body owns the no-session failure, so delegate unchanged.
    if (agent === undefined) return next()
    const capability = ctx.platformShell.runtimeCapabilityOwningTool(exec.name)
    // An unowned tool is not gated by the market; delegate unchanged.
    if (capability === undefined) return next()
    assertGateOpen(capability, resolveWorkspace(agent.session))
    return next()
  })
}
