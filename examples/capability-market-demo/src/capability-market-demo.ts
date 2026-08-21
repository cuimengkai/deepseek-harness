/**
 * capability-market-demo host plugin: registers the platform-shell market tools
 * with a session→platform-user binding, the runtime capability execution gate
 * with a session→workspace binding, and one demo-owned tool (`analyze_code`)
 * whose execution the code-analysis capability's gate governs. The service
 * itself is mounted by the composition row `id: platform-shell` (a file-backed
 * SQLite control-plane store); this plugin adds only the consumers (the market
 * tools every agent sees, the gated analysis tool, and the around-dispatch
 * gate) and the bindings the demo driver populates before each agent runs.
 * @module capability-market-demo
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  PlatformShellError,
  registerCapabilityExecutionGate,
  registerPlatformShellTools,
  type ResolveActor,
  type ResolveWorkspace,
  type UserId,
  type WorkspaceId,
} from '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts'

export const name = 'capability-market-demo'
export const inject = ['tools', 'platformShell']

/** The demo's session→platform-user binding, populated by the demo driver. */
const actors = new Map<string, UserId>()

/**
 * Bind one agent session id to the platform user acting through it.
 * @param sessionId - the agent-loop session id, e.g. `market-product`.
 * @param userId - the platform user the session acts as.
 */
export function bindActor(sessionId: string, userId: UserId): void {
  actors.set(sessionId, userId)
}

/** Resolve the acting platform user for one session; unknown sessions fail loud. */
const resolveActor: ResolveActor = (session: Session) => {
  const user = actors.get(String(session.id))
  if (user === undefined) {
    throw new PlatformShellError('UNKNOWN_ACTOR', `no platform user bound to session ${session.id}`)
  }
  return user
}

/** The demo's session→workspace binding, populated by the demo driver. */
const workspaces = new Map<string, WorkspaceId>()

/**
 * Bind one agent session id to the platform workspace it runs in.
 * @param sessionId - the agent-loop session id, e.g. `market-product`.
 * @param workspaceId - the workspace the session runs in.
 */
export function bindWorkspace(sessionId: string, workspaceId: WorkspaceId): void {
  workspaces.set(sessionId, workspaceId)
}

/** Resolve the platform workspace one session runs in; unknown sessions fail loud. */
const resolveWorkspace: ResolveWorkspace = (session: Session) => {
  const workspace = workspaces.get(String(session.id))
  if (workspace === undefined) {
    throw new PlatformShellError('UNKNOWN_WORKSPACE', `no platform workspace bound to session ${session.id}`)
  }
  return workspace
}

/** The demo-owned tool the code-analysis capability's gate governs at runtime. */
const analyzeCodeTool = defineTool({
  name: 'analyze_code',
  description: 'Analyze a code snippet for issues. Execution is governed by the code-analysis capability\'s market gate for the calling workspace.',
  parameters: { code: { type: 'string', required: true, description: 'the source code to analyze' } },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lineCount: { type: 'number', required: true },
        finding: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: `analyzed ${value.lineCount} lines: ${value.finding}` }],
    presentationMeta: (_args, value) => ({ code: 'analyzed', lineCount: value.lineCount }),
  },
  async execute(args) {
    // Synthetic analysis: the point of the tool is the gate around it, not a
    // real linter.
    return { lineCount: args.code.split('\n').length, finding: 'no blocking issues' }
  },
})

export const apply = (ctx: Context): void => {
  registerPlatformShellTools(ctx, { resolveActor })
  ctx.tools.register(analyzeCodeTool)
  registerCapabilityExecutionGate(ctx, { resolveWorkspace })
}
