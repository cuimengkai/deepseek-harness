/**
 * Flow graph compilation: node/edge graphs become workflow script bodies.
 * @module tests/compile
 */

import { describe, expect, it } from 'vitest'
import { compileFlow } from '../src/compile.ts'
import type { FlowAgentNode, FlowAgentOptions, FlowConditionNode, FlowEdge, FlowGraph, FlowLoopNode, FlowNode } from '../src/types.ts'

/** Fields the per-type node helpers add; `Omit<FlowNode>` alone keeps only common keys. */
type NodeExtra =
  | Partial<Omit<FlowAgentNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowConditionNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowLoopNode, 'id' | 'type' | 'position'>>

/** A node factory with a stable id and origin position. */
function node(type: FlowNode['type'], id: string, extra: NodeExtra): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, ...extra } as FlowNode
}

const start = (id = 'start') => node('start', id, {})
const end = (id = 'end') => node('end', id, {})
const agent = (
  id: string,
  prompt = 'work on it',
  options?: {
    label?: string
    provider?: string
    model?: string
    modelKinds?: FlowAgentOptions['modelKinds']
  },
) =>
  node('agent', id, {
    prompt,
    ...(options?.label === undefined ? {} : { label: options.label }),
    ...(options?.provider === undefined && options?.model === undefined && options?.modelKinds === undefined
      ? {}
      : {
        agentOptions: {
          ...(options?.provider === undefined ? {} : { provider: options.provider }),
          ...(options?.model === undefined ? {} : { model: options.model }),
          ...(options?.modelKinds === undefined ? {} : { modelKinds: options.modelKinds }),
        },
      }),
  })
const condition = (id: string, expression = 'OUT.a.kind === "go"') => node('condition', id, { expression })
const loop = (id: string, iterable = 'args.items', variable = 'item') => node('loop', id, { iterable, variable })

let edgeSeq = 0
/** An edge with a stable unique id; `label` is a branch label when given. */
function edge(from: string, to: string, label?: string): FlowEdge {
  edgeSeq += 1
  return { id: `e${edgeSeq}`, from, to, ...(label === undefined ? {} : { label }) }
}

/** Assemble a graph from nodes and edges. */
function graph(nodes: readonly FlowNode[], edges: readonly FlowEdge[], extra?: Partial<FlowGraph>): FlowGraph {
  return { id: 'demo-flow', name: 'Demo', nodes, edges, ...extra }
}

describe('compileFlow', () => {
  it('compiles a linear flow to a visit chain with one NODES entry per node', () => {
    const { script, meta } = compileFlow(graph(
      [start(), agent('a'), end()],
      [edge('start', 'a'), edge('a', 'end')],
    ))
    expect(script).toContain('return await visit("start")')
    expect(script).toContain('["start", async () => { return await visit("a") }]')
    expect(script).toContain('OUT["a"] = await agent(`work on it`, { phase: "a" })')
    expect(script).toContain('["end", async () => { return OUT }]')
    expect(meta).toEqual({
      name: 'demo-flow',
      description: 'Demo flow',
      phases: [
        { title: 'start', detail: 'start' },
        { title: 'a', detail: 'agent' },
        { title: 'end', detail: 'end' },
      ],
    })
  })

  it('compiles a condition to a phase call and a true/false ternary', () => {
    const { script } = compileFlow(graph(
      [start(), condition('c'), agent('t'), agent('f')],
      [edge('start', 'c'), edge('c', 't', 'true'), edge('c', 'f', 'false')],
    ))
    expect(script).toContain('phase("c")')
    expect(script).toContain('return (OUT.a.kind === "go") ? await visit("t") : await visit("f")')
  })

  it('compiles a loop to a phase call, a for-of body, and the after branch', () => {
    const { script } = compileFlow(graph(
      [start(), loop('l'), agent('body'), end()],
      [edge('start', 'l'), edge('l', 'body', 'body'), edge('l', 'end', 'after')],
    ))
    expect(script).toContain('phase("l")')
    expect(script).toContain('for (const item of (args.items)) {')
    expect(script).toContain('await visit("body")')
    expect(script).toContain('return await visit("end")')
  })

  it('compiles a multi-edge agent to a parallel fan-out', () => {
    const { script } = compileFlow(graph(
      [start(), agent('split'), agent('x'), agent('y')],
      [edge('start', 'split'), edge('split', 'x'), edge('split', 'y')],
    ))
    expect(script).toContain('return await parallel([() => visit("x"), () => visit("y")])')
  })

  it('keeps ${...} for runtime interpolation and escapes backticks and backslashes', () => {
    const { script } = compileFlow(graph(
      [start(), agent('b', 'summarize ${OUT.a} and `ticks` with \\paths')],
      [edge('start', 'b')],
    ))
    // The prompt literal preserves ${OUT.a}, turns ` into \`, and \ into \\.
    expect(script).toContain('await agent(`summarize ${OUT.a} and \\`ticks\\` with \\\\paths`, { phase: "b" })')
  })

  it('maps per-node agent options to the agent call', () => {
    const { script } = compileFlow(graph(
      [start(), agent('a', 'do it', { label: 'Research', provider: 'deepseek', model: 'deepseek-v3' })],
      [edge('start', 'a')],
    ))
    expect(script).toContain('{ phase: "a", label: "Research", provider: "deepseek", model: "deepseek-v3" }')
  })

  it('maps per-kind model routes into the agent call', () => {
    const { script } = compileFlow(graph(
      [start(), agent('a', 'do it', { modelKinds: { image: { provider: 'dify', model: 'gpt-v' } } })],
      [edge('start', 'a')],
    ))
    expect(script).toContain('modelKinds: {"image":{"provider":"dify","model":"gpt-v"}}')
  })

  it('compiles deterministically for an unchanged graph', () => {
    const g = graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end')])
    expect(compileFlow(g).script).toBe(compileFlow(g).script)
  })

  it('throws for an invalid graph', () => {
    expect(() => compileFlow(graph([start(), agent('a')], [edge('start', 'a'), edge('start', 'a')]))).toThrow(/cannot compile/)
  })
})

describe('compileFlow: embedded sub-graphs', () => {
  /** A sub-graph with a branch: x feeds a condition that ends in t or f. */
  function subGraph(): FlowGraph {
    return graph(
      [
        start(),
        agent('x', 'work on x'),
        condition('c', 'OUT.x.kind === "go"'),
        agent('t', 'passed: ${OUT.x}'),
        agent('f', 'failed'),
        end(),
      ],
      [
        edge('start', 'x'),
        edge('x', 'c'),
        edge('c', 't', 'true'),
        edge('c', 'f', 'false'),
        edge('t', 'end'),
        edge('f', 'end'),
      ],
      { id: 'sub-flow', name: 'Sub' },
    )
  }

  /** An outer graph embedding `sub` at agent node `e` between start and end. */
  function embeddingGraph(sub: FlowGraph): FlowGraph {
    const embed: FlowAgentNode = {
      id: 'e',
      type: 'agent',
      position: { x: 0, y: 0 },
      prompt: '',
      subgraph: sub,
    }
    return graph([start(), embed, end()], [edge('start', 'e'), edge('e', 'end')])
  }

  it('compiles an embedding node to a run of its sub-graph in the flat namespaced NODES', () => {
    const { script, meta } = compileFlow(embeddingGraph(subGraph()))
    // The embedding node runs the sub-graph's namespaced start, then its own
    // continuation; the sub-graph's nodes are one flat NODES map.
    expect(script).toContain('["e", async () => {')
    expect(script).toContain('await visit("e-sub-start")')
    expect(script).toContain('return await visit("end")')
    expect(script).toContain('["e-sub-start", async () => { return await visit("e-sub-x") }]')
    // Sub-node ids are namespaced, so sub-internal OUT references rewrite: the
    // condition's dot access and the prompt's interpolation both point at the
    // namespaced x.
    expect(script).toContain('return (OUT["e-sub-x"].kind === "go") ? await visit("e-sub-t") : await visit("e-sub-f")')
    expect(script).toContain('await agent(`passed: ${OUT["e-sub-x"]}`, { phase: "e-sub-t" })')
    expect(script).toContain('["e-sub-end", async () => { return OUT }]')
    // Phases carry the namespaced titles the run surface keys on. The outer
    // `end` lands after the sub-graph's nodes: expansion inlines a sub-graph
    // when its embedding node is pushed.
    expect(meta.phases?.map(phase => phase.title)).toEqual([
      'start', 'e', 'e-sub-start', 'e-sub-x', 'e-sub-c', 'e-sub-t', 'e-sub-f', 'e-sub-end', 'end',
    ])
  })

  it('rewrites only OUT references to sub-graph node ids and leaves near-misses', () => {
    const prompt = "ref ${OUT.x} and ${OUT['x']}, keep ${OUT.outer} and ${OUT['outer']} and OUTLOOK.x and MYOUT.x and foo.OUT.x"
    const sub = graph(
      [start(), agent('x', prompt), end()],
      [edge('start', 'x'), edge('x', 'end')],
      { id: 'sub-flow', name: 'Sub' },
    )
    // The outer graph carries `outer` so the untouched reference resolves.
    const embed: FlowAgentNode = {
      id: 'e',
      type: 'agent',
      position: { x: 0, y: 0 },
      prompt: '',
      subgraph: sub,
    }
    const outer = graph([start(), embed, agent('outer'), end()], [edge('start', 'e'), edge('e', 'outer'), edge('outer', 'end')])
    const { script } = compileFlow(outer)
    expect(script).toContain(
      'await agent(`ref ${OUT["e-sub-x"]} and ${OUT["e-sub-x"]}, keep ${OUT.outer} and ${OUT[\'outer\']} and OUTLOOK.x and MYOUT.x and foo.OUT.x`, { phase: "e-sub-x" })',
    )
  })

  it('embeds a sub-graph with a loop node, rewriting the iterable to its namespaced id', () => {
    const sub = graph(
      [start(), agent('x', 'seed'), loop('l', 'OUT.x', 'item'), agent('body'), end()],
      [edge('start', 'x'), edge('x', 'l'), edge('l', 'body', 'body'), edge('l', 'end', 'after')],
      { id: 'sub-flow', name: 'Sub' },
    )
    const embed: FlowAgentNode = {
      id: 'e',
      type: 'agent',
      position: { x: 0, y: 0 },
      prompt: '',
      subgraph: sub,
    }
    const { script } = compileFlow(graph(
      [start(), embed, end()],
      [edge('start', 'e'), edge('e', 'end')],
      // A description exercises the expansion's description-carrying branch.
      { description: 'embedded demo' },
    ))
    // The loop body runs the sub-graph's namespaced body terminal and the
    // iterable references the sub-graph's own x, so it is rewritten.
    expect(script).toContain('["e-sub-l", async () => {')
    expect(script).toContain('phase("e-sub-l")')
    expect(script).toContain('for (const item of (OUT["e-sub-x"])) {')
    expect(script).toContain('await visit("e-sub-body")')
    expect(script).toContain('return await visit("e-sub-end")')
  })

  it('embeds nested sub-graphs under their recursive namespaced ids', () => {
    const inner = graph([start(), agent('i', 'inner'), end()], [edge('start', 'i'), edge('i', 'end')], { id: 'inner', name: 'Inner' })
    const middle: FlowAgentNode = {
      id: 'm',
      type: 'agent',
      position: { x: 0, y: 0 },
      prompt: 'middle',
      subgraph: inner,
    }
    const sub = graph([start(), middle, end()], [edge('start', 'm'), edge('m', 'end')], { id: 'sub', name: 'Sub' })
    const embed: FlowAgentNode = {
      id: 'e',
      type: 'agent',
      position: { x: 0, y: 0 },
      prompt: '',
      subgraph: sub,
    }
    const { script, meta } = compileFlow(graph([start(), embed, end()], [edge('start', 'e'), edge('e', 'end')]))
    // The middle embedding is reached through two levels of namespacing; its
    // inner sub-graph's start is namespaced again.
    expect(script).toContain('["e-sub-m", async () => {')
    expect(script).toContain('await visit("e-sub-m-sub-start")')
    expect(script).toContain('["e-sub-m-sub-i", async () => {')
    expect(script).toContain('await agent(`inner`, { phase: "e-sub-m-sub-i" })')
    expect(meta.phases?.map(phase => phase.title)).toEqual([
      'start', 'e', 'e-sub-start', 'e-sub-m', 'e-sub-m-sub-start', 'e-sub-m-sub-i', 'e-sub-m-sub-end', 'e-sub-end', 'end',
    ])
  })

  it('compiles deterministically for an unchanged graph with a sub-graph', () => {
    const g = embeddingGraph(subGraph())
    expect(compileFlow(g).script).toBe(compileFlow(g).script)
  })

  it('compiles an embedding node that is a terminal (no outgoing edge)', () => {
    const embed: FlowAgentNode = { id: 'e', type: 'agent', position: { x: 0, y: 0 }, prompt: '', subgraph: subGraph() }
    const { script } = compileFlow(graph([start(), embed], [edge('start', 'e')]))
    expect(script).toContain('await visit("e-sub-start")')
    expect(script).toContain('return OUT')
  })

  it('compiles an embedding node that fans out to multiple targets', () => {
    const embed: FlowAgentNode = { id: 'e', type: 'agent', position: { x: 0, y: 0 }, prompt: '', subgraph: subGraph() }
    const outer = graph([start(), embed, agent('t1'), agent('t2')], [edge('start', 'e'), edge('e', 't1'), edge('e', 't2')])
    const { script } = compileFlow(outer)
    expect(script).toContain('await visit("e-sub-start")')
    expect(script).toContain('return await parallel([() => visit("t1"), () => visit("t2")])')
  })

  it('refuses to compile a condition whose edges are not one true and one false', () => {
    const g = graph(
      [start(), condition('c'), agent('t'), agent('f')],
      [edge('start', 'c'), edge('c', 't', 'true'), edge('c', 'f', 'true')],
    )
    expect(() => compileFlow(g)).toThrow(/missing a true\/false edge/)
  })

  it('refuses to compile a loop whose edges are not one body and one after', () => {
    const g = graph(
      [start(), loop('l'), agent('body'), agent('after')],
      [edge('start', 'l'), edge('l', 'body', 'body'), edge('l', 'after', 'body')],
    )
    expect(() => compileFlow(g)).toThrow(/missing a body\/after edge/)
  })
})
