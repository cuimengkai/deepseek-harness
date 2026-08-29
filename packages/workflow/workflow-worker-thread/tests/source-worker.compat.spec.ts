/**
 * Keyless runtime smoke for the source-mode workflow worker. The Node
 * compatibility matrix runs this WHOLE file, so renaming or removing its test
 * cannot turn the runtime proof into a successful zero-match filter.
 */

import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import WebRuntime from '@deepseek-ai/dsh-web'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

// A fresh thread compiles the source runtime. Leave contention headroom on
// shared CI runners without weakening any engine-level timeout assertion.
vi.setConfig({ testTimeout: 30_000 })

it('runs the default config through the source worker', async () => {
  const ctx = new Context()
  const subagents = await ctx.plugin(SubagentRuntime)
  const provider: SubagentProvider = {
    name: 'spawn',
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: () => Promise.reject(new Error('source-worker compat script must not start a child')),
  }
  ctx.subagents.registerProvider(provider)
  const web = await ctx.plugin(WebRuntime)
  const codeRuntime = await ctx.plugin(WorkerThreadCodeRuntime, {})
  const engine = await ctx.plugin(WorkerThreadWorkflowEngine, {})
  const parent = { id: SessionId('workflow-compat-parent'), options: {} } as unknown as Agent
  try {
    const run = ctx.workflowEngine.start({
      script: 'return 6 * 7',
      meta: { name: 'source-worker-compat', description: 'exercise the unbuilt worker entry' },
      parent,
    })
    try {
      await expect(run.result).resolves.toMatchObject({ value: 42, stopReason: 'completed', agentsStarted: 0 })
    } finally {
      await run.dispose()
    }
  } finally {
    await engine.dispose()
    await codeRuntime.dispose()
    await web.dispose()
    await subagents.dispose()
  }
})
