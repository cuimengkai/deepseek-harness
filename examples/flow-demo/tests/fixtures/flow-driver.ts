#!/usr/bin/env node
/** Snapshot-only Loader driver: run one branching flow and stream its run surface as canonical JSONL. */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
// Type-only Context merge: `ctx.flowEngine` and the `workflow/*` event payloads.
import type {} from '@deepseek-ai/dsh-flow'
import type { WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowRunInfo } from '@deepseek-ai/dsh-workflow'

const NAME = 'flow-demo-driver'
const [configPath, branch] = process.argv.slice(2)
if (configPath === undefined || (branch !== 'go' && branch !== 'no-go')) {
  throw new Error(`${NAME}: expected <config-path> <go|no-go>`)
}

/** The branching demo graph: `condition` routes by `args.go` to B or C. */
const BRANCH_GRAPH: FlowGraph = {
  id: 'branch-demo',
  name: 'Branching Demo',
  description: 'Keyless branching demo: condition routes to B when go is true',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
    {
      id: 'a',
      type: 'agent',
      position: { x: 140, y: 0 },
      prompt: 'Summarize the incoming request in one sentence.',
      agentOptions: { provider: 'flow-mock', model: 'flow-mock' },
    },
    { id: 'condition', type: 'condition', position: { x: 320, y: 0 }, expression: 'args.go === true' },
    {
      id: 'b',
      type: 'agent',
      position: { x: 480, y: -90 },
      prompt: 'Process the go=true branch.',
      agentOptions: { provider: 'flow-mock', model: 'flow-mock' },
    },
    {
      id: 'c',
      type: 'agent',
      position: { x: 480, y: 90 },
      prompt: 'Process the go=false branch.',
      agentOptions: { provider: 'flow-mock', model: 'flow-mock' },
    },
    { id: 'end', type: 'end', position: { x: 640, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'a' },
    { id: 'e2', from: 'a', to: 'condition' },
    { id: 'e3', from: 'condition', to: 'b', label: 'true' },
    { id: 'e4', from: 'condition', to: 'c', label: 'false' },
    { id: 'e5', from: 'b', to: 'end' },
    { id: 'e6', from: 'c', to: 'end' },
  ],
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))

  const agent = ctx.get('agents')?.roots()[0]
  if (agent === undefined) throw new Error(`${NAME}: no root agent mounted`)

  // Stream the per-child attribution so the test can prove distinct children
  // ran. The flow engine's own listeners run first (registered at mount), so
  // the settled result line below is emitted only after every event line.
  ctx.on('workflow/agent-start', (info: WorkflowRunInfo, child: WorkflowAgentInfo) => {
    process.stdout.write(`${JSON.stringify({
      type: 'agent_start',
      runId: info.id,
      childId: child.childId,
      phase: child.phase,
      label: child.label,
    })}\n`)
  })
  ctx.on('workflow/agent-end', (info: WorkflowRunInfo, child: WorkflowAgentEndInfo) => {
    process.stdout.write(`${JSON.stringify({
      type: 'agent_end',
      runId: info.id,
      childId: child.childId,
      phase: child.phase,
      outcome: child.outcome,
    })}\n`)
  })

  const handle = ctx.flowEngine.run({
    graph: BRANCH_GRAPH,
    parent: agent,
    input: { go: branch === 'go' },
  })
  const outcome = await handle.result
  const snapshot = ctx.flowEngine.getRun(handle.runId)
  process.stdout.write(`${JSON.stringify({ type: 'result', runId: handle.runId, outcome, snapshot })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
