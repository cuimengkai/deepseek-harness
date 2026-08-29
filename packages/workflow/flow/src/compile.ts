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
 *   - http: `await http(url, { phase })`, record `OUT[id]`, then visit
 *   - template: `phase(id)` then assign the interpolated template to `OUT[id]`
 *   - code: `await code(source, { phase, out: OUT })`, record `OUT[id]`, then visit
 *   - aggregate: `phase(id)` then combine named expressions per mode into `OUT[id]`
 *   - list: `phase(id)` then apply a closed list operator to a source expression
 *   - classify: `await agent(query, { schema: { class } })`, then exclusive
 *     visit of the matching class (or `default`) edge
 *   - extract: `await agent(query, { schema })` from named parameters, then visit
 *   - join: `phase(id)` then visit the single successor (arms stop before
 *     entering; the fan-out site visits the join after `parallel()`)
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
import type { FlowAggregateNode, FlowAgentNode, FlowClassifyNode, FlowCodeNode, FlowEdge, FlowExtractNode, FlowGraph, FlowHttpNode, FlowListNode, FlowNode, FlowTemplateNode } from './types.ts'
import { validateFlow } from './validate.ts'

/** A compiled flow: the workflow script body plus its identity block. */
export interface CompiledFlow {
  /** The plain-JS script body (wrapped by the workflow engine's runner). */
  readonly script: string
  /** The identity block the engine validates before running the body. */
  readonly meta: WorkflowMeta
}

/** Optional compile inputs that change the emitted script. */
export interface CompileFlowOptions {
  /**
   * Per-node output seed. A seedable node whose id is a key here writes
   * that value to `OUT[id]` and takes its continuation without running
   * `agent()` / `http()` / `code()` or a script-realm body.
   */
  readonly seed?: Readonly<Record<string, unknown>>
}

/**
 * Compile a flow graph into a workflow script body and meta block.
 * @param graph - the flow to compile (must validate; an invalid graph throws).
 * @param options - optional seed map compiled into the script as `SEED`.
 * @returns the script body and meta block.
 */
export function compileFlow(graph: FlowGraph, options?: CompileFlowOptions): CompiledFlow {
  const validation = validateFlow(graph)
  if (!validation.ok) {
    throw new Error(`cannot compile an invalid flow: ${validation.errors.join('; ')}`)
  }

  const expanded = expandGraph(graph)
  const outBySource = new Map<string, FlowEdge[]>()
  const nodes = new Map(expanded.graph.nodes.map(node => [node.id, node]))
  for (const node of expanded.graph.nodes) outBySource.set(node.id, [])
  for (const edge of expanded.graph.edges) outBySource.get(edge.from)?.push(edge)
  const ctx: CompileCtx = { nodes, outBySource }

  // The root start is the top-level start (a sub-graph's start is owned by its
  // embedding node); the script must begin at the outer entry point.
  /* v8 ignore start -- a validated graph always has a root start that owns itself */
  const startId = expanded.graph.nodes.find(
    node => node.type === 'start' && expanded.owner.get(node.id) === node.id,
  )?.id ?? ''
  /* v8 ignore stop */
  /* v8 ignore start -- outBySource is seeded for every node id above */
  const entries = expanded.graph.nodes.map(node =>
    `  [${q(node.id)}, async () => ${compileNodeBody(node, outBySource.get(node.id) ?? [], ctx)}],`,
  )
  /* v8 ignore stop */

  const seedCont = expanded.graph.nodes.flatMap((node) => {
    /* v8 ignore next -- outBySource is seeded for every node id above */
    const out = outBySource.get(node.id) ?? []
    const cont = seedContinue(node, out, ctx)
    return cont === undefined ? [] : [`  ${q(node.id)}: async () => { ${cont} },`]
  })

  const script = [
    `const SEED = ${JSON.stringify(options?.seed ?? {})}`,
    'const OUT = {}',
    'const IN = {}',
    'const SEED_CONT = {',
    ...seedCont,
    '}',
    'async function visit(id) {',
    '  const fn = NODES.get(id)',
    "  if (fn === undefined) throw new Error('flow: no node ' + id)",
    '  IN[id] = Object.assign({}, OUT)',
    '  if (Object.prototype.hasOwnProperty.call(SEED, id) && Object.prototype.hasOwnProperty.call(SEED_CONT, id)) {',
    '    OUT[id] = SEED[id]',
    '    return await SEED_CONT[id]()',
    '  }',
    '  return await fn()',
    '}',
    'const NODES = new Map([',
    ...entries,
    '])',
    `const _done = await visit(${q(startId)})`,
    'return { OUT: _done, IN }',
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

/** Graph lookup used when a continuation must stop at, or visit, a join. */
interface CompileCtx {
  readonly nodes: ReadonlyMap<string, FlowNode>
  readonly outBySource: ReadonlyMap<string, FlowEdge[]>
}

/** The body of one node's compiled function. */
function compileNodeBody(node: FlowNode, out: FlowEdge[], ctx: CompileCtx): string {
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
      if (node.subgraph !== undefined) return embeddingBody(node, out, ctx)
      return agentBody(node, out, ctx)
    case 'http':
      return httpBody(node, out, ctx)
    case 'template':
      return templateBody(node, out, ctx)
    case 'code':
      return codeBody(node, out, ctx)
    case 'aggregate':
      return aggregateBody(node, out, ctx)
    case 'list':
      return listBody(node, out, ctx)
    case 'classify':
      return classifyBody(node, out)
    case 'extract':
      return extractBody(node, out, ctx)
    case 'join':
      return `{
  phase(${q(node.id)})
  ${unlabeledContinue(node.id, out, ctx)}
}`
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
function agentBody(node: FlowAgentNode, out: FlowEdge[], ctx: CompileCtx): string {
  const childPreset = node.childPresetId?.trim()
  const options = [
    `phase: ${q(node.id)}`,
    ...node.label === undefined ? [] : [`label: ${q(node.label)}`],
    ...node.agentOptions?.provider === undefined ? [] : [`provider: ${q(node.agentOptions.provider)}`],
    ...node.agentOptions?.model === undefined ? [] : [`model: ${q(node.agentOptions.model)}`],
    ...node.agentOptions?.modelKinds === undefined ? [] : [`modelKinds: ${JSON.stringify(node.agentOptions.modelKinds)}`],
    ...childPreset === undefined || childPreset === '' ? [] : [`childPresetId: ${q(childPreset)}`],
  ].join(', ')
  const call = `OUT[${q(node.id)}] = await agent(${agentInstructionLiteral(node)}, { ${options} })`
  return syncContinue(node.id, call, out, ctx)
}

/** One http node's compiled body (single edge, terminal, or parallel fan-out) — the `http()` analog of {@link agentBody}. */
function httpBody(node: FlowHttpNode, out: FlowEdge[], ctx: CompileCtx): string {
  const call = `OUT[${q(node.id)}] = await http(${templateLiteral(node.url)}, { phase: ${q(node.id)} })`
  return syncContinue(node.id, call, out, ctx)
}

/**
 * One template node's compiled body (single edge, terminal, or parallel
 * fan-out) — a pure synchronous interpolation, so unlike {@link httpBody} it
 * opens and closes its own run-surface gate with `phase(id)` rather than
 * calling a hook that reports its own start/end.
 */
function templateBody(node: FlowTemplateNode, out: FlowEdge[], ctx: CompileCtx): string {
  const call = `phase(${q(node.id)})\n  OUT[${q(node.id)}] = ${templateLiteral(node.template)}`
  return syncContinue(node.id, call, out, ctx)
}

/**
 * One code node's compiled body (single edge, terminal, or parallel
 * fan-out) — the `code()` analog of {@link httpBody}. Unlike an agent
 * prompt or an http url, the source is quoted as an OPAQUE string literal
 * (`q`, not {@link templateLiteral}): a code node runs real program text, so
 * `${...}` inside it must stay literal JS/TS syntax for the sandbox to
 * evaluate, never compile-time string interpolation. Access to prior node
 * outputs goes through the `out` option (the live `OUT` object), which the
 * host splices into the sandboxed program as a data prelude.
 */
function codeBody(node: FlowCodeNode, out: FlowEdge[], ctx: CompileCtx): string {
  const call = `OUT[${q(node.id)}] = await code(${q(node.source)}, { phase: ${q(node.id)}, out: OUT })`
  return syncContinue(node.id, call, out, ctx)
}

/**
 * One aggregate node's compiled body — a synchronous script-realm combine,
 * so like {@link templateBody} it gates with `phase(id)` rather than a hook.
 */
function aggregateBody(node: FlowAggregateNode, out: FlowEdge[], ctx: CompileCtx): string {
  const items = node.items
    .map(item => `{ name: ${q(item.name)}, value: (${item.expression}) }`)
    .join(', ')
  const call = `phase(${q(node.id)})\n  OUT[${q(node.id)}] = (() => { const items = [${items}]; const mode = ${q(node.mode)}; if (mode === "object") { const o = {}; for (const it of items) o[it.name] = it.value; return o } if (mode === "first") { for (const it of items) { if (it.value !== undefined && it.value !== null) return it.value } return null } const acc = []; for (const it of items) { if (Array.isArray(it.value)) acc.push(...it.value); else if (it.value !== undefined && it.value !== null) acc.push(it.value) } return acc })()`
  return syncContinue(node.id, call, out, ctx)
}

/**
 * One list node's compiled body — a synchronous script-realm operator,
 * gated with `phase(id)` like {@link templateBody}.
 */
function listBody(node: FlowListNode, out: FlowEdge[], ctx: CompileCtx): string {
  const call = `phase(${q(node.id)})\n  OUT[${q(node.id)}] = (() => { const src = (${node.source}); const arr = Array.isArray(src) ? src : (src === undefined || src === null ? [] : [src]); const op = ${q(node.op)}; if (op === "first") return arr[0]; if (op === "last") return arr[arr.length - 1]; if (op === "length") return arr.length; if (op === "reverse") return arr.slice().reverse(); return arr.flat() })()`
  return syncContinue(node.id, call, out, ctx)
}

/**
 * One classify node's compiled body: an `agent()` call with a `{ class }`
 * schema, then exclusive visits of the matching class (or `default`) edge.
 */
function classifyBody(node: FlowClassifyNode, out: FlowEdge[]): string {
  const classIds = node.classes.map(item => item.id)
  const schema = {
    type: 'object',
    properties: { class: { type: 'string', enum: classIds } },
    required: ['class'],
  }
  const instruction = `Classify the input into exactly one class id from this closed set: ${classIds.join(', ')}. Use the structured output.\n\nInput:\n${node.query}`
  const call = `OUT[${q(node.id)}] = await agent(${templateLiteral(instruction)}, { phase: ${q(node.id)}, schema: ${JSON.stringify(schema)} })`
  return `{
  ${call}
  ${classifyContinue(node, out)}
}`
}

/**
 * One extract node's compiled body: an `agent()` call whose schema is the
 * object's named parameters, then the same unlabeled continuation as an agent.
 */
function extractBody(node: FlowExtractNode, out: FlowEdge[], ctx: CompileCtx): string {
  const properties: Record<string, { type: string; description?: string }> = {}
  const required: string[] = []
  for (const param of node.parameters) {
    properties[param.name] = param.description === undefined
      ? { type: param.type }
      : { type: param.type, description: param.description }
    if (param.required === true) required.push(param.name)
  }
  const schema = {
    type: 'object',
    properties,
    ...required.length === 0 ? {} : { required },
  }
  const instruction = `Extract the listed parameters from the input. Use the structured output schema.\n\nInput:\n${node.query}`
  const call = `OUT[${q(node.id)}] = await agent(${templateLiteral(instruction)}, { phase: ${q(node.id)}, schema: ${JSON.stringify(schema)} })`
  return syncContinue(node.id, call, out, ctx)
}

/**
 * Exclusive class-branch continuation shared by a classify body and a seeded
 * classify skip.
 */
function classifyContinue(node: FlowClassifyNode, out: FlowEdge[]): string {
  const classEdges = out.filter(edge => edge.label !== undefined && edge.label !== 'default')
  const defaultEdge = out.find(edge => edge.label === 'default')
  const branches = classEdges.map((edge) => {
    /* v8 ignore next -- validateFlow requires a label on every classify edge */
    const label = edge.label ?? ''
    return `if (_cls === ${q(label)}) return await visit(${q(edge.to)})`
  }).join('\n  ')
  const fallback = defaultEdge === undefined
    ? 'return OUT'
    : `return await visit(${q(defaultEdge.to)})`
  return `const _cls = (OUT[${q(node.id)}] && typeof OUT[${q(node.id)}] === "object") ? OUT[${q(node.id)}].class : undefined
  ${branches}
  ${fallback}`
}

/**
 * Unlabeled visit continuation (terminal / one edge / parallel fan-out).
 * @param id - node id, used only in the missing-edge diagnostic.
 * @param out - outgoing edges.
 */
function unlabeledContinue(id: string, out: FlowEdge[], ctx: CompileCtx): string {
  if (out.length === 0) return 'return OUT'
  if (out.length === 1) {
    const next = out[0]
    /* v8 ignore next -- a length-1 edge list always has an element; the guard answers out[0]'s optional type */
    if (next === undefined) throw new Error(`node "${id}" edge target is missing`)
    if (ctx.nodes.get(next.to)?.type === 'join') return 'return OUT'
    return `return await visit(${q(next.to)})`
  }
  const joinId = joinAfterFanout(out, ctx)
  const branches = out.map(edge => `() => visit(${q(edge.to)})`).join(', ')
  if (joinId !== undefined) {
    return `await parallel([${branches}])\n  return await visit(${q(joinId)})`
  }
  return `return await parallel([${branches}])`
}

/**
 * When every fan-out arm is a join or a node whose only successor is the
 * same join, that join id; otherwise undefined (ordinary parallel, no wait).
 */
function joinAfterFanout(out: FlowEdge[], ctx: CompileCtx): string | undefined {
  const joins = new Set<string>()
  for (const edge of out) {
    const target = ctx.nodes.get(edge.to)
    if (target?.type === 'join') {
      joins.add(target.id)
      continue
    }
    const targetOut = ctx.outBySource.get(edge.to) ?? []
    const only = targetOut[0]
    if (targetOut.length === 1 && only !== undefined && ctx.nodes.get(only.to)?.type === 'join') {
      joins.add(only.to)
      continue
    }
    return undefined
  }
  return joins.size === 1 ? [...joins][0] : undefined
}

/**
 * Seed skip continuation for a node that writes `OUT[id]`. `undefined` means
 * the node is not seedable (start/end/condition/loop/join/embedding).
 */
function seedContinue(node: FlowNode, out: FlowEdge[], ctx: CompileCtx): string | undefined {
  switch (node.type) {
    case 'agent':
      if (node.subgraph !== undefined) return undefined
      return unlabeledContinue(node.id, out, ctx)
    case 'http':
    case 'template':
    case 'code':
    case 'aggregate':
    case 'list':
    case 'extract':
      return unlabeledContinue(node.id, out, ctx)
    case 'classify':
      return classifyContinue(node, out)
    default:
      return undefined
  }
}

/**
 * Visit continuation shared by synchronous processing nodes (template,
 * aggregate, list): terminal, single edge, or parallel fan-out.
 * @param id - node id, used only in the missing-edge diagnostic.
 * @param call - the already-built assignment / phase lines.
 * @param out - outgoing edges.
 * @returns the compiled function body.
 */
function syncContinue(id: string, call: string, out: FlowEdge[], ctx: CompileCtx): string {
  return `{
  ${call}
  ${unlabeledContinue(id, out, ctx)}
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
function embeddingBody(node: FlowAgentNode, out: FlowEdge[], ctx: CompileCtx): string {
  const subStartId = node.subgraph?.nodes.find(node => node.type === 'start')?.id
  /* v8 ignore next -- validation requires exactly one start per level, so the find always succeeds */
  if (subStartId === undefined) {
    throw new Error(`agent node "${node.id}" subgraph has no start node`)
  }
  const run = `await visit(${q(`${node.id}-sub-${subStartId}`)})`
  return `{
  ${run}
  ${unlabeledContinue(node.id, out, ctx)}
}`
}

/** A JS double-quoted string literal, quote-safe for user-authored ids and labels. */
function q(value: string): string {
  return JSON.stringify(value)
}

/**
 * A string as a JS template literal — shared by an agent node's instruction
 * and an http node's URL. Backslash and backtick are escaped so the literal
 * parses; `${...}` is left intact for interpolation of the enclosing loop
 * variable and prior outputs.
 */
function templateLiteral(value: string): string {
  return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}

/**
 * The agent instruction template: {@link FlowAgentNode.systemPrompt} then
 * {@link FlowAgentNode.prompt}, joined by a blank line when both are present.
 * Both parts share one {@link templateLiteral} so escaping stays consistent.
 */
function agentInstructionLiteral(node: FlowAgentNode): string {
  const system = node.systemPrompt ?? ''
  const user = node.prompt
  if (system.trim() === '') return templateLiteral(user)
  if (user.trim() === '') return templateLiteral(system)
  return templateLiteral(`${system}\n\n${user}`)
}
