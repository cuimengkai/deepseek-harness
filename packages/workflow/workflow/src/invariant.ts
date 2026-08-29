/** Package-owned workflow lifecycle invariants. @module @deepseek-ai/dsh-workflow/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowNodeEndInfo,
  WorkflowNodeInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-workflow'

/** Cordis companion plugin name. */
export const name = 'workflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

interface WorkflowTrace {
  meta: string
  agents: Map<number, WorkflowAgentInfo>
  starts: number
  nodes: Map<number, WorkflowNodeInfo>
}

/** Require every event for a run to retain its validated identity snapshot. */
function traceFor(
  traces: ReadonlyMap<string, WorkflowTrace>,
  info: WorkflowRunInfo,
  fail: InvariantFailure,
): WorkflowTrace {
  const trace = traces.get(info.id)
  if (trace === undefined) fail(`workflow event has no matching workflow/start for run ${JSON.stringify(info.id)}`)
  if (trace.meta !== JSON.stringify(info.meta)) {
    fail(`workflow event meta diverges from workflow/start for run ${JSON.stringify(info.id)}`)
  }
  return trace
}

/** Assert the immutable identity fields shared by an agent pair. */
function validateAgentEnd(start: WorkflowAgentInfo, end: WorkflowAgentEndInfo, fail: InvariantFailure): void {
  if (start.label !== end.label || start.phase !== end.phase || start.childId !== end.childId) {
    fail(`workflow/agent-end identity diverges from workflow/agent-start for seq ${end.seq}`)
  }
  const outcome: string = end.outcome
  if (outcome !== 'completed' && outcome !== 'failed' && outcome !== 'cancelled') {
    fail(`workflow/agent-end carries unknown outcome ${JSON.stringify(outcome)}`)
  }
}

/** Assert the immutable identity fields shared by a node-call pair. */
function validateNodeEnd(start: WorkflowNodeInfo, end: WorkflowNodeEndInfo, fail: InvariantFailure): void {
  if (start.phase !== end.phase) {
    fail(`workflow/node-end identity diverges from workflow/node-start for seq ${end.seq}`)
  }
  const outcome: string = end.outcome
  if (outcome !== 'completed' && outcome !== 'failed' && outcome !== 'cancelled') {
    fail(`workflow/node-end carries unknown outcome ${JSON.stringify(outcome)}`)
  }
}

/** Validate a terminal result against the accumulated run trace. */
function validateWorkflowEnd(trace: WorkflowTrace, result: WorkflowResultInfo, fail: InvariantFailure): void {
  if (trace.agents.size > 0) fail(`workflow/end has ${trace.agents.size} agent call(s) without workflow/agent-end`)
  if (trace.nodes.size > 0) fail(`workflow/end has ${trace.nodes.size} node call(s) without workflow/node-end`)
  if (!Number.isSafeInteger(result.agentsStarted) || result.agentsStarted < trace.starts) {
    fail('workflow/end agentsStarted must be a safe integer covering every observed agent start')
  }
  if (result.stopReason === 'completed' ? result.error !== undefined : typeof result.error !== 'string') {
    fail('workflow/end error must be absent exactly for completed runs')
  }
}

/** Install workflow start/end and child-call pairing checks. */
const install: InvariantInstaller = (ctx, fail) => {
  const traces = new Map<string, WorkflowTrace>()
  const stagedStarts = new WeakSet<WorkflowRunInfo>()
  const stagedAgentStarts = new WeakSet<WorkflowAgentInfo>()
  const stagedAgentEnds = new WeakSet<WorkflowAgentEndInfo>()
  const stagedNodeStarts = new WeakSet<WorkflowNodeInfo>()
  const stagedNodeEnds = new WeakSet<WorkflowNodeEndInfo>()
  const stagedEnds = new WeakSet<WorkflowResultInfo>()

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'workflow/start') {
      const info = args[0] as WorkflowRunInfo
      if (String(info.id).length === 0 || info.meta.name.length === 0 || info.meta.description.length === 0) {
        fail('workflow/start id, meta.name, and meta.description must be non-empty')
      }
      if (traces.has(info.id)) fail(`workflow/start repeated run id ${JSON.stringify(info.id)}`)
      stagedStarts.add(info)
      return
    }
    if (eventName === 'workflow/node-start') {
      const node = args[1] as WorkflowNodeInfo
      const trace = traceFor(traces, args[0] as WorkflowRunInfo, fail)
      if (!Number.isSafeInteger(node.seq) || node.seq < 1 || node.phase.length === 0) {
        fail('workflow/node-start seq must be positive and phase must be non-empty')
      }
      if (trace.nodes.has(node.seq)) fail(`workflow/node-start repeated seq ${node.seq}`)
      stagedNodeStarts.add(node)
      return
    }
    if (eventName === 'workflow/node-end') {
      const node = args[1] as WorkflowNodeEndInfo
      const trace = traceFor(traces, args[0] as WorkflowRunInfo, fail)
      const start = trace.nodes.get(node.seq)
      if (start === undefined) return fail(`workflow/node-end has no matching start for seq ${node.seq}`)
      validateNodeEnd(start, node, fail)
      stagedNodeEnds.add(node)
      return
    }
    if (!eventName.startsWith('workflow/')) return
    const info = args[0] as WorkflowRunInfo
    const trace = traceFor(traces, info, fail)
    if (eventName === 'workflow/agent-start') {
      const agent = args[1] as WorkflowAgentInfo
      if (!Number.isSafeInteger(agent.seq) || agent.seq < 1 || String(agent.childId).length === 0) {
        fail('workflow/agent-start seq must be positive and childId must be non-empty')
      }
      if (trace.agents.has(agent.seq)) fail(`workflow/agent-start repeated seq ${agent.seq}`)
      stagedAgentStarts.add(agent)
      return
    }
    if (eventName === 'workflow/agent-end') {
      const agent = args[1] as WorkflowAgentEndInfo
      const start = trace.agents.get(agent.seq)
      if (start === undefined) return fail(`workflow/agent-end has no matching start for seq ${agent.seq}`)
      validateAgentEnd(start, agent, fail)
      stagedAgentEnds.add(agent)
      return
    }
    if (eventName === 'workflow/end') {
      const result = args[1] as WorkflowResultInfo
      validateWorkflowEnd(trace, result, fail)
      stagedEnds.add(result)
    }
  }, { global: true })

  ctx.on('workflow/start', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same run-info object */
    if (!stagedStarts.delete(info)) return
    traces.set(info.id, { meta: JSON.stringify(info.meta), agents: new Map(), starts: 0, nodes: new Map() })
  }, { global: true })
  ctx.on('workflow/agent-start', (info, agent) => {
    /* v8 ignore next -- internal/dispatch stages the same agent object */
    if (!stagedAgentStarts.delete(agent)) return
    const trace = traceFor(traces, info, fail)
    trace.agents.set(agent.seq, agent)
    trace.starts += 1
  }, { global: true })
  ctx.on('workflow/agent-end', (info, agent) => {
    /* v8 ignore next -- internal/dispatch stages the same agent object */
    if (!stagedAgentEnds.delete(agent)) return
    traceFor(traces, info, fail).agents.delete(agent.seq)
  }, { global: true })
  ctx.on('workflow/node-start', (info, node) => {
    /* v8 ignore next -- internal/dispatch stages the same node object */
    if (!stagedNodeStarts.delete(node)) return
    traceFor(traces, info, fail).nodes.set(node.seq, node)
  }, { global: true })
  ctx.on('workflow/node-end', (info, node) => {
    /* v8 ignore next -- internal/dispatch stages the same node object */
    if (!stagedNodeEnds.delete(node)) return
    traceFor(traces, info, fail).nodes.delete(node.seq)
  }, { global: true })
  ctx.on('workflow/end', (info, result) => {
    /* v8 ignore next -- internal/dispatch stages the same result object */
    if (!stagedEnds.delete(result)) return
    traces.delete(info.id)
  }, { global: true })
}

/**
 * Register the workflow invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
