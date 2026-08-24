/**
 * Flow graph compilation: a validated {@link FlowGraph} becomes a workflow
 * script body plus its `WorkflowMeta`. Each node compiles to one `NODES` entry
 * in a recursive-CPS shape —
 *
 *   - start: `return await visit(successor)`
 *   - agent with one edge: run the child, record `OUT[id]`, then visit the edge
 *   - agent with >= 2 edges (parallel fan-out): `parallel([() => visit(a), ...])`
 *   - agent with a `subgraph` (an embedding node): run the sub-graph's start
 *     instead of a subagent, then the node's own continuation
 *   - condition: `phase(id)` then a ternary over the two labeled branches
 *   - loop: `phase(id)` then `for (const variable of iterable) await visit(body)`
 *     and finally the `after` branch
 *   - end (and any node with no outgoing edges): `return OUT`
 *
 * A graph with sub-graphs is flattened first (via {@link expandGraph}), so the
 * compiled script is one flat `NODES` map over namespaced ids and the run
 * surface keys on those ids too. `visit`/`OUT`/`NODES` are script locals, so
 * the only new vm globals are the workflow engine's own (`agent`, `parallel`,
 * `phase`, ...). Condition and loop expressions are injected verbatim and
 * evaluated in that realm, with `OUT` and `args` in scope — the same trust
 * model as a model-written workflow script. Agent prompts compile as template
 * literals so a loop body can interpolate its `${variable}` and prior outputs
 * `${OUT['<nodeId>']}`.
 *
 * The script is emitted deterministically (nodes in graph order), so an
 * unchanged graph recompiles to an identical script for snapshots.
 * @module @deepseek-ai/dsh-flow/compile
 */

import type { WorkflowMeta } from '@deepseek-ai/dsh-workflow/types'
import { expandGraph } from './expand.ts'
import type { FlowAgentNode, FlowEdge, FlowGraph, FlowNode } from './types.ts'
import { validateFlow } from './validate.ts'

/** A compiled flow: the workflow script body plus its identity block. */
export interface CompiledFlow {
  /** The plain-JS script body (wrapped by the workflow engine's runner). */
  readonly script: string
  /** The identity block the engine validates before running the body. */
  readonly meta: WorkflowMeta
}

/**
 * Compile a flow graph into a workflow script body and meta block.
 * @param graph - the flow to compile (must validate; an invalid graph throws).
 * @returns the script body and meta block.
 */
export function compileFlow(graph: FlowGraph): CompiledFlow {
  const validation = validateFlow(graph)
  if (!validation.ok) {
    throw new Error(`cannot compile an invalid flow: ${validation.errors.join('; ')}`)
  }

  const expanded = expandGraph(graph)
  const outBySource = new Map<string, FlowEdge[]>()
  for (const node of expanded.graph.nodes) outBySource.set(node.id, [])
  for (const edge of expanded.graph.edges) outBySource.get(edge.from)?.push(edge)

  // The root start is the top-level start (a sub-graph's start is owned by its
  // embedding node); the script must begin at the outer entry point.
  /* v8 ignore start -- a validated graph always has a root start that owns itself */
  const startId = expanded.graph.nodes.find(
    node => node.type === 'start' && expanded.owner.get(node.id) === node.id,
  )?.id ?? ''
  /* v8 ignore stop */
  /* v8 ignore start -- outBySource is seeded for every node id above */
  const entries = expanded.graph.nodes.map(node =>
    `  [${q(node.id)}, async () => ${compileNodeBody(node, outBySource.get(node.id) ?? [])}],`,
  )
  /* v8 ignore stop */

  const script = [
    'const OUT = {}',
    'async function visit(id) {',
    '  const fn = NODES.get(id)',
    "  if (fn === undefined) throw new Error('flow: no node ' + id)",
    '  return await fn()',
    '}',
    'const NODES = new Map([',
    ...entries,
    '])',
    `return await visit(${q(startId)})`,
  ].join('\n')

  const phases = expanded.graph.nodes.map(node => ({
    title: node.id,
    detail: `${node.type}${node.label === undefined ? '' : `: ${node.label}`}`,
  }))

  return {
    script,
    meta: {
      name: graph.id,
      description: graph.description === undefined ? `${graph.name} flow` : graph.description,
      phases,
    },
  }
}

/** The body of one node's compiled function. */
function compileNodeBody(node: FlowNode, out: FlowEdge[]): string {
  switch (node.type) {
    case 'start': {
      const edge = out[0]
      /* v8 ignore next -- a start with no outgoing edge fails validation before the compiler emits it */
      if (edge === undefined) throw new Error(`start node "${node.id}" has no outgoing edge`)
      return `{ return await visit(${q(edge.to)}) }`
    }
    case 'end':
      return '{ return OUT }'
    case 'agent':
      if (node.subgraph !== undefined) return embeddingBody(node, out)
      return agentBody(node, out)
    case 'condition': {
      const trueEdge = out.find(edge => edge.label === 'true')
      const falseEdge = out.find(edge => edge.label === 'false')
      if (trueEdge === undefined || falseEdge === undefined) {
        throw new Error(`condition node "${node.id}" is missing a true/false edge`)
      }
      return `{
  phase(${q(node.id)})
  return (${node.expression}) ? await visit(${q(trueEdge.to)}) : await visit(${q(falseEdge.to)})
}`
    }
    case 'loop': {
      const bodyEdge = out.find(edge => edge.label === 'body')
      const afterEdge = out.find(edge => edge.label === 'after')
      if (bodyEdge === undefined || afterEdge === undefined) {
        throw new Error(`loop node "${node.id}" is missing a body/after edge`)
      }
      return `{
  phase(${q(node.id)})
  for (const ${node.variable} of (${node.iterable})) {
    await visit(${q(bodyEdge.to)})
  }
  return await visit(${q(afterEdge.to)})
}`
    }
  }
}

/** One agent node's compiled body (single edge, terminal, or parallel fan-out). */
function agentBody(node: FlowAgentNode, out: FlowEdge[]): string {
  const options = [
    `phase: ${q(node.id)}`,
    ...node.label === undefined ? [] : [`label: ${q(node.label)}`],
    ...node.agentOptions?.provider === undefined ? [] : [`provider: ${q(node.agentOptions.provider)}`],
    ...node.agentOptions?.model === undefined ? [] : [`model: ${q(node.agentOptions.model)}`],
    ...node.agentOptions?.modelKinds === undefined ? [] : [`modelKinds: ${JSON.stringify(node.agentOptions.modelKinds)}`],
  ].join(', ')
  const call = `OUT[${q(node.id)}] = await agent(${promptLiteral(node.prompt)}, { ${options} })`
  if (out.length === 0) {
    return `{
  ${call}
  return OUT
}`
  }
  if (out.length === 1) {
    const next = out[0]
    /* v8 ignore next -- a length-1 edge list always has an element; the guard answers out[0]'s optional type */
    if (next === undefined) throw new Error(`agent node "${node.id}" edge target is missing`)
    return `{
  ${call}
  return await visit(${q(next.to)})
}`
  }
  const branches = out.map(edge => `() => visit(${q(edge.to)})`).join(', ')
  return `{
  ${call}
  return await parallel([${branches}])
}`
}

/**
 * An embedding agent node's body: run the sub-graph's start (its nodes are
 * already flattened into `NODES` under namespaced ids), then the node's own
 * continuation. The sub-graph's own `agent()` calls ARE the orchestration; the
 * node's `agentOptions` are inherited route defaults its sub-nodes omit.
 * The node records no output of its own — a terminal sub-graph returns the
 * shared `OUT`, so capturing it under the node id would be self-referential.
 */
function embeddingBody(node: FlowAgentNode, out: FlowEdge[]): string {
  const subStartId = node.subgraph?.nodes.find(node => node.type === 'start')?.id
  /* v8 ignore next -- validation requires exactly one start per level, so the find always succeeds */
  if (subStartId === undefined) {
    throw new Error(`agent node "${node.id}" subgraph has no start node`)
  }
  const run = `await visit(${q(`${node.id}-sub-${subStartId}`)})`
  if (out.length === 0) {
    return `{
  ${run}
  return OUT
}`
  }
  if (out.length === 1) {
    const next = out[0]
    /* v8 ignore next -- a length-1 edge list always has an element; the guard answers out[0]'s optional type */
    if (next === undefined) throw new Error(`agent node "${node.id}" edge target is missing`)
    return `{
  ${run}
  return await visit(${q(next.to)})
}`
  }
  const branches = out.map(edge => `() => visit(${q(edge.to)})`).join(', ')
  return `{
  ${run}
  return await parallel([${branches}])
}`
}

/** A JS double-quoted string literal, quote-safe for user-authored ids and labels. */
function q(value: string): string {
  return JSON.stringify(value)
}

/**
 * A prompt as a JS template literal. Backslash and backtick are escaped so the
 * literal parses; `${...}` is left intact for interpolation of the enclosing
 * loop variable and prior outputs.
 */
function promptLiteral(prompt: string): string {
  return `\`${prompt.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}
