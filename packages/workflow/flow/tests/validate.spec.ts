/**
 * Structural validation + branch-context exclusivity for flow graphs.
 * @module tests/validate
 */

import { describe, expect, it } from 'vitest'
import { validateFlow } from '../src/validate.ts'
import type {
  FlowAgentNode,
  FlowAggregateNode,
  FlowClassifyNode,
  FlowCodeNode,
  FlowConditionNode,
  FlowEdge,
  FlowExtractNode,
  FlowGraph,
  FlowHttpNode,
  FlowJoinNode,
  FlowListNode,
  FlowLoopNode,
  FlowNode,
  FlowTemplateNode,
} from '../src/types.ts'

/** Fields the per-type node helpers add; `Omit<FlowNode>` alone keeps only common keys. */
type NodeExtra =
  | Partial<Omit<FlowAgentNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowConditionNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowLoopNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowHttpNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowTemplateNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowCodeNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowAggregateNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowListNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowClassifyNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowExtractNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<FlowJoinNode, 'id' | 'type' | 'position'>>

/** A node factory with a stable id and origin position. */
function node(type: FlowNode['type'], id: string, extra: NodeExtra): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, ...extra } as FlowNode
}

const start = (id = 'start') => node('start', id, {})
const end = (id = 'end') => node('end', id, {})
const agent = (id: string, prompt = 'work on it') => node('agent', id, { prompt })
const condition = (id: string, expression = 'OUT.a.kind === "go"') => node('condition', id, { expression })
const loop = (id: string, iterable = 'args.items', variable = 'item') => node('loop', id, { iterable, variable })
const http = (id: string, url = 'https://example.com') => node('http', id, { url })
const template = (id: string, source = 'hello') => node('template', id, { template: source })
const code = (id: string, source = 'return 1') => node('code', id, { source })
const aggregate = (id: string, items = [{ name: 'a', expression: 'OUT.x' }], mode: 'object' | 'first' | 'concat' = 'object') =>
  node('aggregate', id, { items, mode })
const list = (id: string, source = 'OUT.x', op: 'first' | 'last' | 'length' | 'reverse' | 'flatten' = 'first') =>
  node('list', id, { source, op })
const classify = (
  id: string,
  query = 'which',
  classes: { id: string; name?: string }[] = [{ id: 'a' }, { id: 'b' }],
) => node('classify', id, { query, classes })
const join = (id: string) => node('join', id, {})
const extract = (
  id: string,
  query = 'extract it',
  parameters: { name: string; type: 'string' | 'number' | 'integer' | 'boolean'; description?: string; required?: boolean }[] = [
    { name: 'value', type: 'string' },
  ],
) => node('extract', id, { query, parameters })

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
  if (!result.ok) {
    throw new Error(`expected the flow to validate, got:\n${result.errors.join('\n')}`)
  }
}

/** Expect validation to fail with findings matching every `errorSubstring`. */
function expectErrors(g: FlowGraph, ...errorSubstrings: readonly string[]): void {
  const result = validateFlow(g)
  expect(result.ok).toBe(false)
  if (!result.ok) {
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
    expectOk(graph(
      [start(), {
        id: 'a',
        type: 'agent',
        position: { x: 0, y: 0 },
        prompt: '',
        systemPrompt: 'system only',
      }, end()],
      [edge('start', 'a'), edge('a', 'end')],
    ))
    expectErrors(graph(
      [start(), {
        id: 'a',
        type: 'agent',
        position: { x: 0, y: 0 },
        prompt: '  ',
        systemPrompt: '  ',
      }, end()],
      [edge('start', 'a'), edge('a', 'end')],
    ), 'empty prompt')
    expectErrors(graph([start(), condition('c', ' ')], [edge('start', 'c')]), 'empty expression')
  })

  it('rejects an empty http url', () => {
    expectErrors(graph([start(), http('h', '  '), end()], [edge('start', 'h'), edge('h', 'end')]), 'empty url')
    expectOk(graph([start(), http('h'), end()], [edge('start', 'h'), edge('h', 'end')]))
  })

  it('rejects an empty template', () => {
    expectErrors(graph([start(), template('tpl', '  '), end()], [edge('start', 'tpl'), edge('tpl', 'end')]), 'empty template')
    expectOk(graph([start(), template('tpl'), end()], [edge('start', 'tpl'), edge('tpl', 'end')]))
  })

  it('rejects an empty code source', () => {
    expectErrors(graph([start(), code('c', '  '), end()], [edge('start', 'c'), edge('c', 'end')]), 'empty source')
    expectOk(graph([start(), code('c'), end()], [edge('start', 'c'), edge('c', 'end')]))
  })

  it('rejects an aggregate node with no items, empty names, duplicate names, or empty expressions', () => {
    expectErrors(graph([start(), aggregate('agg', []), end()], [edge('start', 'agg'), edge('agg', 'end')]), 'at least one item')
    expectErrors(
      graph([start(), aggregate('agg', [{ name: '  ', expression: '1' }]), end()], [edge('start', 'agg'), edge('agg', 'end')]),
      'empty name',
    )
    expectErrors(
      graph(
        [start(), aggregate('agg', [{ name: 'a', expression: '1' }, { name: 'a', expression: '2' }]), end()],
        [edge('start', 'agg'), edge('agg', 'end')],
      ),
      'repeats item name',
    )
    expectErrors(
      graph([start(), aggregate('agg', [{ name: 'a', expression: '  ' }]), end()], [edge('start', 'agg'), edge('agg', 'end')]),
      'empty expression',
    )
    expectOk(graph([start(), aggregate('agg'), end()], [edge('start', 'agg'), edge('agg', 'end')]))
  })

  it('rejects an aggregate or list node with an unknown mode or op', () => {
    const badAgg = { ...aggregate('agg'), mode: 'nope' } as unknown as FlowNode
    expectErrors(graph([start(), badAgg, end()], [edge('start', 'agg'), edge('agg', 'end')]), 'unknown mode')
    const badList = { ...list('lst'), op: 'nope' } as unknown as FlowNode
    expectErrors(graph([start(), badList, end()], [edge('start', 'lst'), edge('lst', 'end')]), 'unknown op')
  })

  it('rejects an empty list source', () => {
    expectErrors(graph([start(), list('lst', '  '), end()], [edge('start', 'lst'), edge('lst', 'end')]), 'empty source')
    expectOk(graph([start(), list('lst'), end()], [edge('start', 'lst'), edge('lst', 'end')]))
  })

  it('rejects a classify node with an empty query, too few classes, a reserved default id, or a missing class edge', () => {
    expectErrors(
      graph(
        [start(), classify('cls', '  '), end()],
        [edge('start', 'cls'), edge('cls', 'end', 'a'), edge('cls', 'end', 'b')],
      ),
      'empty query',
    )
    expectErrors(
      graph(
        [start(), classify('cls', 'which', [{ id: 'a' }]), end()],
        [edge('start', 'cls'), edge('cls', 'end', 'a')],
      ),
      'at least two classes',
    )
    expectErrors(
      graph(
        [start(), classify('cls', 'which', [{ id: 'a' }, { id: 'default' }]), end()],
        [edge('start', 'cls'), edge('cls', 'end', 'a'), edge('cls', 'end', 'default')],
      ),
      'reserves "default"',
    )
    expectErrors(
      graph(
        [start(), classify('cls', 'which', [{ id: 'a' }, { id: 'a' }]), end()],
        [edge('start', 'cls'), edge('cls', 'end', 'a')],
      ),
      'repeats class id',
    )
    expectErrors(
      graph(
        [start(), classify('cls', 'which', [{ id: '' }, { id: 'b' }]), end()],
        [edge('start', 'cls'), edge('cls', 'end', 'b')],
      ),
      'empty id',
    )
    expectErrors(
      graph([start(), classify('cls'), end()], [edge('start', 'cls'), edge('cls', 'end', 'a')]),
      'missing an outgoing edge labeled "b"',
    )
    expectErrors(
      graph(
        [start(), classify('cls'), end()],
        [edge('start', 'cls'), edge('cls', 'end', 'a'), edge('cls', 'end', 'b'), edge('cls', 'end', 'maybe')],
      ),
      'must be labeled with a class id or default',
    )
    expectErrors(
      graph(
        [start(), classify('cls'), end()],
        [edge('start', 'cls'), edge('cls', 'end', 'a'), edge('cls', 'end', 'b'), edge('cls', 'end', 'a')],
      ),
      'repeats outgoing label',
    )
    expectOk(graph(
      [start(), classify('cls'), end()],
      [edge('start', 'cls'), edge('cls', 'end', 'a'), edge('cls', 'end', 'b')],
    ))
  })

  it('rejects an extract node with an empty query, no parameters, a duplicate name, or an unknown type', () => {
    expectErrors(graph([start(), extract('ex', '  '), end()], [edge('start', 'ex'), edge('ex', 'end')]), 'empty query')
    expectErrors(graph([start(), extract('ex', 'q', []), end()], [edge('start', 'ex'), edge('ex', 'end')]), 'at least one parameter')
    expectErrors(
      graph(
        [start(), extract('ex', 'q', [{ name: '  ', type: 'string' }]), end()],
        [edge('start', 'ex'), edge('ex', 'end')],
      ),
      'empty name',
    )
    expectErrors(
      graph(
        [start(), extract('ex', 'q', [{ name: 'a', type: 'string' }, { name: 'a', type: 'number' }]), end()],
        [edge('start', 'ex'), edge('ex', 'end')],
      ),
      'repeats parameter name',
    )
    const bad = { ...extract('ex'), parameters: [{ name: 'n', type: 'nope' }] } as unknown as FlowNode
    expectErrors(graph([start(), bad, end()], [edge('start', 'ex'), edge('ex', 'end')]), 'unknown type')
    expectOk(graph([start(), extract('ex'), end()], [edge('start', 'ex'), edge('ex', 'end')]))
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
    expectErrors(graph([start(), http('h'), end()], [edge('start', 'h'), edge('h', 'end', 'true')]), 'carries a branch label on a http node')
    expectErrors(graph([start(), template('tpl'), end()], [edge('start', 'tpl'), edge('tpl', 'end', 'true')]), 'carries a branch label on a template node')
    expectErrors(graph([start(), code('c'), end()], [edge('start', 'c'), edge('c', 'end', 'true')]), 'carries a branch label on a code node')
    expectErrors(graph([start(), aggregate('agg'), end()], [edge('start', 'agg'), edge('agg', 'end', 'true')]), 'carries a branch label on a aggregate node')
    expectErrors(graph([start(), list('lst'), end()], [edge('start', 'lst'), edge('lst', 'end', 'true')]), 'carries a branch label on a list node')
    expectErrors(graph([start(), extract('ex'), end()], [edge('start', 'ex'), edge('ex', 'end', 'true')]), 'carries a branch label on a extract node')
    expectErrors(graph([start(), join('j'), end()], [edge('start', 'j'), edge('j', 'end', 'true')]), 'carries a branch label on a join node')
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

  it('accepts a merge at an explicit join after a parallel fan-out', () => {
    expectOk(graph(
      [start(), agent('split'), agent('x'), agent('y'), join('j'), end()],
      [edge('start', 'split'), edge('split', 'x'), edge('split', 'y'), edge('x', 'j'), edge('y', 'j'), edge('j', 'end')],
    ))
  })

  it('rejects a merge of two independent joins at a non-join node', () => {
    expectErrors(
      graph(
        [start(), agent('split'), join('j1'), join('j2'), end()],
        [edge('start', 'split'), edge('split', 'j1'), edge('split', 'j2'), edge('j1', 'end'), edge('j2', 'end')],
      ),
      'is reached by branches that can both run',
    )
  })

  it('rejects a join with more than one outgoing edge', () => {
    expectErrors(
      graph(
        [start(), join('j'), agent('a'), agent('b'), end()],
        [edge('start', 'j'), edge('j', 'a'), edge('j', 'b'), edge('a', 'end'), edge('b', 'end')],
      ),
      'at most one outgoing edge',
    )
  })

  it('accepts a merge after a classify class split', () => {
    expectOk(graph(
      [start(), classify('cls'), agent('t'), agent('f'), end()],
      [edge('start', 'cls'), edge('cls', 't', 'a'), edge('cls', 'f', 'b'), edge('t', 'end'), edge('f', 'end')],
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

  it('rejects a merge after an http fan-out', () => {
    expectErrors(
      graph(
        [start(), http('split'), agent('x'), agent('y'), end()],
        [edge('start', 'split'), edge('split', 'x'), edge('split', 'y'), edge('x', 'end'), edge('y', 'end')],
      ),
      'branches that can both run',
    )
  })

  it('rejects a merge after a template fan-out', () => {
    expectErrors(
      graph(
        [start(), template('split'), agent('x'), agent('y'), end()],
        [edge('start', 'split'), edge('split', 'x'), edge('split', 'y'), edge('x', 'end'), edge('y', 'end')],
      ),
      'branches that can both run',
    )
  })

  it('rejects a merge after a code fan-out', () => {
    expectErrors(
      graph(
        [start(), code('split'), agent('x'), agent('y'), end()],
        [edge('start', 'split'), edge('split', 'x'), edge('split', 'y'), edge('x', 'end'), edge('y', 'end')],
      ),
      'branches that can both run',
    )
  })

  it('rejects a merge after an aggregate fan-out', () => {
    expectErrors(
      graph(
        [start(), aggregate('split'), agent('x'), agent('y'), end()],
        [edge('start', 'split'), edge('split', 'x'), edge('split', 'y'), edge('x', 'end'), edge('y', 'end')],
      ),
      'branches that can both run',
    )
  })

  it('rejects a merge after an extract fan-out', () => {
    expectErrors(
      graph(
        [start(), extract('split'), agent('x'), agent('y'), end()],
        [edge('start', 'split'), edge('split', 'x'), edge('split', 'y'), edge('x', 'end'), edge('y', 'end')],
      ),
      'branches that can both run',
    )
  })

  it('rejects a merge after a list fan-out', () => {
    expectErrors(
      graph(
        [start(), list('split'), agent('x'), agent('y'), end()],
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
