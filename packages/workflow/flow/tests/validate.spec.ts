/**
 * Structural validation + branch-context exclusivity for flow graphs.
 * @module tests/validate
 */

import { describe, expect, it } from 'vitest'
import { validateFlow } from '../src/validate.ts'
import type { FlowAgentNode, FlowConditionNode, FlowEdge, FlowGraph, FlowLoopNode, FlowNode } from '../src/types.ts'

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
const agent = (id: string, prompt = 'work on it') => node('agent', id, { prompt })
const condition = (id: string, expression = 'OUT.a.kind === "go"') => node('condition', id, { expression })
const loop = (id: string, iterable = 'args.items', variable = 'item') => node('loop', id, { iterable, variable })

let edgeSeq = 0
/** An edge with a stable unique id; `label` is a branch label when given. */
function edge(from: string, to: string, label?: string): FlowEdge {
  edgeSeq += 1
  return { id: `e${edgeSeq}`, from, to, ...(label === undefined ? {} : { label }) }
}

/** Assemble a graph from nodes and edges. */
function graph(nodes: readonly FlowNode[], edges: readonly FlowEdge[] = [], extra?: Partial<FlowGraph>): FlowGraph {
  return { id: 'demo-flow', name: 'Demo', nodes, edges, ...extra }
}

/** Expect validation to succeed. */
function expectOk(g: FlowGraph): void {
  const result = validateFlow(g)
  if (result.ok === false) {
    throw new Error(`expected the flow to validate, got:\n${result.errors.join('\n')}`)
  }
}

/** Expect validation to fail with findings matching every `errorSubstring`. */
function expectErrors(g: FlowGraph, ...errorSubstrings: readonly string[]): void {
  const result = validateFlow(g)
  expect(result.ok).toBe(false)
  if (result.ok === false) {
    for (const fragment of errorSubstrings) {
      expect(result.errors.join('\n')).toContain(fragment)
    }
  }
}

describe('validateFlow: structural rules', () => {
  it('accepts a linear flow', () => {
    expectOk(graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end')]))
  })

  it('accepts an agent terminal (no outgoing edge)', () => {
    expectOk(graph([start(), agent('a')], [edge('start', 'a')]))
  })

  it('rejects a non-kebab flow id', () => {
    expectErrors(graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end')], { id: 'Bad-Flow' }), 'not kebab-case')
    expectErrors(graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end')], { id: 'bad flow' }), 'not kebab-case')
  })

  it('rejects an empty flow name', () => {
    expectErrors(graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end')], { name: '  ' }), 'flow name is empty')
  })

  it('requires exactly one start node', () => {
    expectErrors(graph([start(), start('start2'), agent('a'), end()], [edge('start', 'a'), edge('start2', 'a'), edge('a', 'end')]), 'exactly one start')
    expectErrors(graph([agent('a'), end()], [edge('a', 'end')]), 'exactly one start')
  })

  it('rejects duplicate or empty node ids', () => {
    expectErrors(graph([start('x'), start('x'), end()], [edge('x', 'end')]), 'duplicate node id "x"')
    expectErrors(graph([start(''), agent('a')], [edge('', 'a')]), 'a node has an empty id')
  })

  it('rejects an empty agent prompt and an empty condition expression', () => {
    expectErrors(graph([start(), agent('a', '  '), end()], [edge('start', 'a'), edge('a', 'end')]), 'empty prompt')
    expectErrors(graph([start(), condition('c', ' ')], [edge('start', 'c')]), 'empty expression')
  })

  it('rejects an empty loop iterable and a non-identifier variable', () => {
    expectErrors(
      graph([start(), loop('l', '', 'item')], [edge('start', 'l', 'body'), edge('start', 'l', 'after')]),
      'empty iterable',
    )
    expectErrors(
      graph([start(), loop('l', 'args.x', 'bad-name')], [edge('start', 'l', 'body'), edge('start', 'l', 'after')]),
      'not a valid JS identifier',
    )
  })

  it('rejects unknown endpoints, self-loops, and duplicate edges', () => {
    expectErrors(graph([start(), agent('a'), end()], [edge('start', 'ghost')]), 'unknown node "ghost"')
    expectErrors(graph([start(), agent('a'), end()], [edge('ghost', 'a')]), 'unknown node "ghost"')
    expectErrors(graph([start(), agent('a'), end()], [edge('a', 'a')]), 'connects a node to itself')
    expectErrors(
      graph([start(), agent('a'), end()], [edge('start', 'a', undefined), edge('start', 'a', undefined)]),
      'duplicate edge',
    )
  })

  it('rejects a duplicate edge with a branch label, naming the label', () => {
    expectErrors(
      graph([start(), agent('a'), end()], [edge('start', 'a', 'true'), edge('start', 'a', 'true')]),
      'labeled "true"',
    )
  })

  it('enforces start/end out-degree and branch labels', () => {
    expectErrors(graph([start(), agent('a'), agent('b'), end()], [edge('start', 'a'), edge('start', 'b'), edge('a', 'end'), edge('b', 'end')]), 'exactly one outgoing edge')
    expectErrors(graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end'), edge('end', 'a')]), 'cannot have outgoing edges')
    expectErrors(graph([start(), condition('c'), end()], [edge('start', 'c'), edge('c', 'end')]), 'exactly two outgoing edges')
    expectErrors(graph([start(), condition('c'), agent('a'), end()], [edge('start', 'c'), edge('c', 'a', 'maybe'), edge('c', 'end', 'true')]), 'labeled true or false')
    expectErrors(graph([start(), loop('l'), agent('a'), end()], [edge('start', 'l'), edge('l', 'a', 'once'), edge('l', 'end', 'after')]), 'labeled body or after')
  })

  it('rejects a branch label on a non-branch node', () => {
    expectErrors(graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end', 'true')]), 'carries a branch label on a agent node')
  })

  it('rejects a cycle and the nodes on it', () => {
    expectErrors(
      graph([start(), agent('a'), agent('b'), end()], [edge('start', 'a'), edge('a', 'b'), edge('b', 'a'), edge('a', 'end')]),
      'contains a cycle through',
    )
  })

  it('rejects a node unreachable from start', () => {
    expectErrors(graph([start(), agent('a'), agent('orphan'), end()], [edge('start', 'a'), edge('a', 'end')]), 'unreachable from start')
  })
})

describe('validateFlow: branch-context exclusivity', () => {
  it('accepts a merge after a condition (exclusive branches)', () => {
    expectOk(graph(
      [start(), condition('c'), agent('t'), agent('f'), end()],
      [edge('start', 'c'), edge('c', 't', 'true'), edge('c', 'f', 'false'), edge('t', 'end'), edge('f', 'end')],
    ))
  })

  it('accepts nested conditions', () => {
    expectOk(graph(
      [start(), condition('c1'), condition('c2'), agent('t'), agent('f'), agent('a'), end()],
      [
        edge('start', 'c1'),
        edge('c1', 'c2', 'true'),
        edge('c2', 't', 'true'),
        edge('c2', 'f', 'false'),
        edge('t', 'end'),
        edge('f', 'end'),
        edge('c1', 'a', 'false'),
        edge('a', 'end'),
      ],
    ))
  })

  it('rejects a merge after a parallel fan-out', () => {
    expectErrors(
      graph(
        [start(), agent('split'), agent('x'), agent('y'), end()],
        [edge('start', 'split'), edge('split', 'x'), edge('split', 'y'), edge('x', 'end'), edge('y', 'end')],
      ),
      'branches that can both run',
    )
  })

  it('rejects a merge after a loop body/after split', () => {
    expectErrors(
      graph(
        [start(), loop('l'), agent('body'), agent('after'), end()],
        [edge('start', 'l'), edge('l', 'body', 'body'), edge('l', 'after', 'after'), edge('body', 'end'), edge('after', 'end')],
      ),
      'branches that can both run',
    )
  })

  it('rejects a merge of two independent conditions in parallel branches', () => {
    expectErrors(
      graph(
        [start(), agent('split'), condition('c1'), condition('c2'), agent('x'), agent('y'), agent('d1'), agent('d2'), end()],
        [
          edge('start', 'split'),
          edge('split', 'c1'),
          edge('split', 'c2'),
          edge('c1', 'x', 'true'),
          edge('c1', 'd1', 'false'),
          edge('c2', 'y', 'true'),
          edge('c2', 'd2', 'false'),
          edge('x', 'end'),
          edge('y', 'end'),
        ],
      ),
      'branches that can both run',
    )
  })

  it('accepts a condition branch whose false arm is a terminal and true arm merges', () => {
    expectOk(graph(
      [start(), condition('c'), agent('t'), end()],
      [edge('start', 'c'), edge('c', 't', 'true'), edge('t', 'end'), edge('c', 'end', 'false')],
    ))
  })

  it('stops the analysis when a node accumulates over the branch-context cap', () => {
    // A 129-condition chain whose every false arm converges on `m` delivers one
    // distinct context per condition, so m crosses the 128-context cap mid-way.
    const conditions = 129
    const nodes: FlowNode[] = [start(), ...Array.from({ length: conditions }, (_, i) => condition(`c${i + 1}`)), end('m')]
    const edges: FlowEdge[] = [edge('start', 'c1')]
    for (let i = 1; i <= conditions; i++) {
      const id = `c${i}`
      edges.push(edge(id, i < conditions ? `c${i + 1}` : 'm', 'true'))
      edges.push(edge(id, 'm', 'false'))
    }
    expectErrors(graph(nodes, edges), 'too complex')
  })

  it('reports the overflow from an agent feeding a full terminal', () => {
    // 128 conditions each route a distinct false-arm context into m, filling its
    // cap; the last condition's true arm passes a 129th distinct context through
    // the single-edge agent g, so the overflow fires while g delivers to m.
    const conditions = 128
    const nodes: FlowNode[] = [
      start(),
      ...Array.from({ length: conditions }, (_, i) => condition(`c${i + 1}`)),
      agent('g'),
      end('m'),
    ]
    const edges: FlowEdge[] = [edge('start', 'c1')]
    for (let i = 1; i <= conditions; i++) {
      const id = `c${i}`
      edges.push(edge(id, i < conditions ? `c${i + 1}` : 'g', 'true'))
      edges.push(edge(id, 'm', 'false'))
    }
    edges.push(edge('g', 'm'))
    expectErrors(graph(nodes, edges), 'too complex')
  })
})

describe('validateFlow: embedded sub-graphs', () => {
  /** An agent node embedding `sub` at node id `e`, with an empty prompt. */
  function embed(sub: FlowGraph): FlowAgentNode {
    return { id: 'e', type: 'agent', position: { x: 0, y: 0 }, prompt: '', subgraph: sub }
  }

  /** An outer chain start → embed → end around the given sub-graph. */
  function outerWith(sub: FlowGraph): FlowGraph {
    return graph([start(), embed(sub), end()], [edge('start', 'e'), edge('e', 'end')])
  }

  it('accepts a sub-graph, so the embedding node needs no prompt', () => {
    const sub = graph([start(), agent('a'), end()], [edge('start', 'a'), edge('a', 'end')], { id: 'sub', name: 'Sub' })
    expectOk(outerWith(sub))
  })

  it('accepts a valid branching sub-graph', () => {
    const sub = graph(
      [start(), condition('c'), agent('t'), agent('f'), end()],
      [edge('start', 'c'), edge('c', 't', 'true'), edge('c', 'f', 'false'), edge('t', 'end'), edge('f', 'end')],
      { id: 'sub', name: 'Sub' },
    )
    expectOk(outerWith(sub))
  })

  it('rejects a cyclic sub-graph', () => {
    const sub = graph([start(), agent('a'), agent('b')], [edge('start', 'a'), edge('a', 'b'), edge('b', 'a')], { id: 'sub', name: 'Sub' })
    expectErrors(outerWith(sub), 'contains a cycle through')
  })

  it('rejects a sub-graph missing its true/false edges', () => {
    const sub = graph([start(), condition('c'), agent('t')], [edge('start', 'c'), edge('c', 't', 'true')], { id: 'sub', name: 'Sub' })
    expectErrors(outerWith(sub), 'exactly two outgoing edges')
  })

  it('rejects a sub-graph with a node unreachable from its start', () => {
    const sub = graph(
      [start(), agent('a'), agent('orphan'), end()],
      [edge('start', 'a'), edge('a', 'end')],
      { id: 'sub', name: 'Sub' },
    )
    expectErrors(outerWith(sub), 'unreachable from start')
  })
})
