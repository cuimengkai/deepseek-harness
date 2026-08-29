/**
 * Pure FlowGraph mutations for the orchestration canvas: node minting,
 * defaults, palette parsing, edge wiring (including condition/loop branch
 * labels and the loop-into-end synthetic after-node), and node/edge removal.
 */

import { describe, expect, it } from 'vitest'
import type { FlowEdge, FlowGraph, FlowNode } from '@deepseek-ai/dsh-flow/types'
import {
  addAfter, addEdge, addNodeAt, defaultPlaceableNode, descendantIds, formatAggregateItems, formatClassifyClasses,
  formatExtractParams, insertBetween, mintNodeId,
  parseAggregateItems, parseAggregateMode, parseClassifyClasses, parseExtractParams,
  parseExtractParamType, parseListOp, parsePlaceableType, removeEdge,
  removeNode, seedForRerun,
} from '../src/client/mode-graph.ts'

const start = (id = 'start'): FlowNode => ({ id, type: 'start', position: { x: 0, y: 0 } })
const end = (id = 'end'): FlowNode => ({ id, type: 'end', position: { x: 0, y: 0 } })
const agent = (id: string, position = { x: 0, y: 0 }): FlowNode => ({
  id, type: 'agent', position, prompt: 'do it',
})
const edge = (id: string, from: string, to: string, label?: string): FlowEdge => (
  label === undefined ? { id, from, to } : { id, from, to, label }
)

function graph(nodes: readonly FlowNode[], edges: readonly FlowEdge[] = []): FlowGraph {
  return { id: 'demo', name: 'Demo', nodes, edges }
}

describe('mintNodeId', () => {
  it('mints step-N for agent, skipping ids already taken', () => {
    expect(mintNodeId(graph([start(), agent('step-1')]), 'agent')).toBe('step-2')
    expect(mintNodeId(graph([start()]), 'agent')).toBe('step-1')
  })

  it('mints <type>-N for a non-agent placeable type', () => {
    expect(mintNodeId(graph([start()]), 'condition')).toBe('condition-1')
    expect(mintNodeId(graph([start(), { id: 'condition-1', type: 'condition', position: { x: 0, y: 0 }, expression: 'true' }]), 'condition')).toBe('condition-2')
  })
})

describe('defaultPlaceableNode', () => {
  it('builds a validator-acceptable default for every placeable type', () => {
    expect(defaultPlaceableNode('agent', 'a', { x: 1, y: 2 })).toMatchObject({ type: 'agent', prompt: expect.any(String) as string })
    expect(defaultPlaceableNode('condition', 'c', { x: 1, y: 2 })).toMatchObject({ type: 'condition', expression: 'true' })
    expect(defaultPlaceableNode('loop', 'l', { x: 1, y: 2 })).toMatchObject({ type: 'loop', iterable: '[]', variable: 'item' })
    expect(defaultPlaceableNode('http', 'h', { x: 1, y: 2 })).toMatchObject({ type: 'http', url: 'https://' })
    expect(defaultPlaceableNode('template', 't', { x: 1, y: 2 })).toMatchObject({ type: 'template', template: expect.any(String) as string })
    expect(defaultPlaceableNode('code', 'c', { x: 1, y: 2 })).toMatchObject({ type: 'code', source: expect.any(String) as string })
    expect(defaultPlaceableNode('aggregate', 'g', { x: 1, y: 2 })).toMatchObject({ type: 'aggregate', mode: 'object' })
    expect(defaultPlaceableNode('list', 'l', { x: 1, y: 2 })).toMatchObject({ type: 'list', op: 'first' })
    expect(defaultPlaceableNode('classify', 'c', { x: 1, y: 2 })).toMatchObject({ type: 'classify' })
    expect(defaultPlaceableNode('extract', 'e', { x: 1, y: 2 })).toMatchObject({ type: 'extract' })
    expect(defaultPlaceableNode('join', 'j', { x: 1, y: 2 })).toMatchObject({ type: 'join' })
  })
})

describe('parsePlaceableType', () => {
  it('accepts every known placeable type and refuses anything else', () => {
    expect(parsePlaceableType('agent')).toBe('agent')
    expect(parsePlaceableType('condition')).toBe('condition')
    expect(parsePlaceableType('loop')).toBe('loop')
    expect(parsePlaceableType('http')).toBe('http')
    expect(parsePlaceableType('template')).toBe('template')
    expect(parsePlaceableType('code')).toBe('code')
    expect(parsePlaceableType('aggregate')).toBe('aggregate')
    expect(parsePlaceableType('list')).toBe('list')
    expect(parsePlaceableType('classify')).toBe('classify')
    expect(parsePlaceableType('extract')).toBe('extract')
    expect(parsePlaceableType('join')).toBe('join')
    expect(parsePlaceableType('ghost')).toBeUndefined()
  })
})

describe('addNodeAt', () => {
  it('places a node with a freshly minted id', () => {
    const { graph: next, nodeId } = addNodeAt(graph([start()]), 'agent', { x: 10, y: 20 })
    expect(nodeId).toBe('step-1')
    expect(next.nodes).toHaveLength(2)
    expect(next.nodes[1]).toMatchObject({ id: 'step-1', position: { x: 10, y: 20 } })
  })
})

describe('addEdge', () => {
  it('refuses a self-loop', () => {
    const g = graph([start(), agent('a')])
    expect(addEdge(g, 'a', 'a')).toBe(g)
  })

  it('refuses unknown source or target', () => {
    const g = graph([start(), agent('a')])
    expect(addEdge(g, 'ghost', 'a')).toBe(g)
    expect(addEdge(g, 'a', 'ghost')).toBe(g)
  })

  it('refuses an edge out of end or into start', () => {
    const g = graph([start(), agent('a'), end()])
    expect(addEdge(g, 'end', 'a')).toBe(g)
    expect(addEdge(g, 'a', 'start')).toBe(g)
  })

  it('refuses a duplicate edge', () => {
    const g = graph([start(), agent('a')], [edge('e1', 'start', 'a')])
    expect(addEdge(g, 'start', 'a')).toBe(g)
  })

  it('adds an unlabeled edge from an agent, http, template, or code source', () => {
    const g = graph([agent('a'), agent('b')])
    const next = addEdge(g, 'a', 'b')
    expect(next.edges).toEqual([{ id: 'e-a-b', from: 'a', to: 'b' }])
  })

  it('auto-labels a condition source true then false, then refuses a third edge', () => {
    const g = graph([{ id: 'c', type: 'condition', position: { x: 0, y: 0 }, expression: 'true' }, agent('t'), agent('f'), agent('x')])
    let next = addEdge(g, 'c', 't')
    expect(next.edges).toEqual([{ id: 'e-c-t-true', from: 'c', to: 't', label: 'true' }])
    next = addEdge(next, 'c', 'f')
    expect(next.edges[1]).toEqual({ id: 'e-c-f-false', from: 'c', to: 'f', label: 'false' })
    expect(addEdge(next, 'c', 'x')).toBe(next)
  })

  it('auto-labels a loop source body then after, then refuses a third edge', () => {
    const g = graph([{ id: 'l', type: 'loop', position: { x: 0, y: 0 }, iterable: '[]', variable: 'item' }, agent('body'), agent('after'), agent('x')])
    let next = addEdge(g, 'l', 'body')
    expect(next.edges).toEqual([{ id: 'e-l-body-body', from: 'l', to: 'body', label: 'body' }])
    next = addEdge(next, 'l', 'after')
    expect(next.edges[1]).toEqual({ id: 'e-l-after-after', from: 'l', to: 'after', label: 'after' })
    expect(addEdge(next, 'l', 'x')).toBe(next)
  })

  it('refuses a second outgoing edge from start', () => {
    const g = graph([start(), agent('a'), agent('b')], [edge('e1', 'start', 'a')])
    expect(addEdge(g, 'start', 'b')).toBe(g)
  })

  it('adds start\'s first outgoing edge unlabeled', () => {
    const g = graph([start(), agent('a')])
    const next = addEdge(g, 'start', 'a')
    expect(next.edges).toEqual([{ id: 'e-start-a', from: 'start', to: 'a' }])
  })
})

describe('removeNode', () => {
  it('refuses an unknown id, and start/end', () => {
    const g = graph([start(), agent('a'), end()])
    expect(removeNode(g, 'ghost')).toBe(g)
    expect(removeNode(g, 'start')).toBe(g)
    expect(removeNode(g, 'end')).toBe(g)
  })

  it('removes a node and every edge touching it', () => {
    const g = graph(
      [start(), agent('a'), agent('b'), end()],
      [edge('e1', 'start', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'end')],
    )
    const next = removeNode(g, 'a')
    expect(next.nodes.map(n => n.id)).toEqual(['start', 'b', 'end'])
    expect(next.edges).toEqual([{ id: 'e3', from: 'b', to: 'end' }])
  })
})

describe('removeEdge', () => {
  it('is a no-op for an unknown edge id', () => {
    const g = graph([start(), agent('a')], [edge('e1', 'start', 'a')])
    expect(removeEdge(g, 'ghost')).toBe(g)
  })

  it('removes the matching edge', () => {
    const g = graph([start(), agent('a')], [edge('e1', 'start', 'a')])
    expect(removeEdge(g, 'e1').edges).toEqual([])
  })
})

describe('insertBetween', () => {
  it('returns undefined when the edge is missing', () => {
    const g = graph([start(), agent('a')])
    expect(insertBetween(g, 'start', 'a', 'agent')).toBeUndefined()
  })

  it('returns undefined when an edge endpoint node is missing', () => {
    const g = graph([start(), agent('a')], [edge('e1', 'start', 'ghost')])
    expect(insertBetween(g, 'start', 'ghost', 'agent')).toBeUndefined()
  })

  it('splits an edge, inserting the node at the midpoint and rewiring both sides', () => {
    const g = graph([
      { ...agent('a'), position: { x: 0, y: 0 } },
      { ...agent('b'), position: { x: 200, y: 100 } },
    ], [edge('e1', 'a', 'b')])
    const inserted = insertBetween(g, 'a', 'b', 'template')
    expect(inserted).toBeDefined()
    const { graph: next, nodeId } = inserted!
    expect(nodeId).toBe('template-1')
    expect(next.nodes.find(n => n.id === nodeId)).toMatchObject({ position: { x: 100, y: 50 } })
    expect(next.edges).toEqual([
      { id: 'e-a-template-1', from: 'a', to: nodeId },
      { id: 'e-template-1-b', from: nodeId, to: 'b' },
    ])
  })

  it('wires a condition insert to both true and false toward the same target', () => {
    const g = graph([agent('a'), agent('b')], [edge('e1', 'a', 'b')])
    const inserted = insertBetween(g, 'a', 'b', 'condition')!
    const labels = inserted.graph.edges.filter(e => e.from === inserted.nodeId).map(e => e.label)
    expect(labels.sort()).toEqual(['false', 'true'])
  })

  it('wires a loop insert whose target is not the end: body to target, after to end', () => {
    const g = graph([agent('a'), agent('b'), end()], [edge('e1', 'a', 'b'), edge('e2', 'b', 'end')])
    const inserted = insertBetween(g, 'a', 'b', 'loop')!
    const fromNew = inserted.graph.edges.filter(e => e.from === inserted.nodeId)
    expect(fromNew).toEqual(expect.arrayContaining([
      { id: `e-${inserted.nodeId}-b-body`, from: inserted.nodeId, to: 'b', label: 'body' },
      { id: `e-${inserted.nodeId}-end-after`, from: inserted.nodeId, to: 'end', label: 'after' },
    ]))
  })

  it('wires a loop insert whose target IS the end: after routes through a synthetic after-node', () => {
    const g = graph([agent('a'), end()], [edge('e1', 'a', 'end')])
    const inserted = insertBetween(g, 'a', 'end', 'loop')!
    const afterEdge = inserted.graph.edges.find(e => e.from === inserted.nodeId && e.label === 'after')
    expect(afterEdge).toBeDefined()
    const afterNodeId = afterEdge!.to
    const afterNode = inserted.graph.nodes.find(n => n.id === afterNodeId)
    expect(afterNode).toMatchObject({ type: 'agent', label: 'After loop', prompt: 'Runs after the loop finishes.' })
    expect(inserted.graph.edges).toEqual(expect.arrayContaining([
      { id: `e-${afterNodeId}-end`, from: afterNodeId, to: 'end' },
    ]))
  })

  it('wires a loop insert into a graph with no end node: the synthetic after-node is left unconnected', () => {
    const g = graph([agent('a'), agent('b')], [edge('e1', 'a', 'b')])
    const inserted = insertBetween(g, 'a', 'b', 'loop')!
    const afterEdge = inserted.graph.edges.find(e => e.from === inserted.nodeId && e.label === 'after')
    const afterNodeId = afterEdge!.to
    expect(inserted.graph.edges.some(e => e.from === afterNodeId)).toBe(false)
  })
})

describe('addAfter', () => {
  it('returns undefined for a missing or end anchor', () => {
    const g = graph([start(), agent('a'), end()])
    expect(addAfter(g, 'ghost', 'agent')).toBeUndefined()
    expect(addAfter(g, 'end', 'agent')).toBeUndefined()
  })

  it('delegates to insertBetween when the anchor already has an outgoing edge', () => {
    const g = graph([agent('a'), agent('b')], [edge('e1', 'a', 'b')])
    const added = addAfter(g, 'a', 'template')!
    expect(added.graph.nodes.some(n => n.id === added.nodeId && n.type === 'template')).toBe(true)
    expect(added.graph.edges.some(e => e.to === 'b')).toBe(true)
  })

  it('appends and wires a new node when the anchor has no outgoing edge', () => {
    const g = graph([agent('a')])
    const added = addAfter(g, 'a', 'agent')!
    expect(added.graph.nodes).toHaveLength(2)
    expect(added.graph.edges).toEqual([{ id: `e-a-${added.nodeId}`, from: 'a', to: added.nodeId }])
  })
})

describe('aggregate item text', () => {
  it('round-trips name: expression lines and drops blanks', () => {
    const items = parseAggregateItems('a: OUT.x\n\nb: 2\n')
    expect(items).toEqual([{ name: 'a', expression: 'OUT.x' }, { name: 'b', expression: '2' }])
    expect(formatAggregateItems(items)).toBe('a: OUT.x\nb: 2')
  })

  it('keeps a line without a colon as a name with an empty expression', () => {
    expect(parseAggregateItems('only-name')).toEqual([{ name: 'only-name', expression: '' }])
  })

  it('accepts known modes and operators and refuses anything else', () => {
    expect(parseAggregateMode('object')).toBe('object')
    expect(parseAggregateMode('first')).toBe('first')
    expect(parseAggregateMode('concat')).toBe('concat')
    expect(parseAggregateMode('ghost')).toBeUndefined()
    expect(parseListOp('first')).toBe('first')
    expect(parseListOp('last')).toBe('last')
    expect(parseListOp('length')).toBe('length')
    expect(parseListOp('reverse')).toBe('reverse')
    expect(parseListOp('flatten')).toBe('flatten')
    expect(parseListOp('ghost')).toBeUndefined()
  })
})

describe('classify and extract inspector text', () => {
  it('round-trips classify class lines and extract parameter lines', () => {
    const classes = parseClassifyClasses('a: Yes\n\nb\n')
    expect(classes).toEqual([{ id: 'a', name: 'Yes' }, { id: 'b' }])
    expect(formatClassifyClasses(classes)).toBe('a: Yes\nb')
    expect(parseClassifyClasses('c: ')).toEqual([{ id: 'c' }])
    const params = parseExtractParams('value!: string the text\ncount: integer\n')
    expect(params).toEqual([
      { name: 'value', type: 'string', description: 'the text', required: true },
      { name: 'count', type: 'integer' },
    ])
    expect(formatExtractParams(params)).toBe('value!: string the text\ncount: integer')
    expect(parseExtractParamType('boolean')).toBe('boolean')
    expect(parseExtractParamType('ghost')).toBeUndefined()
  })

  it('builds a Variable Inspector seed that skips descendants and optionally the edited node', () => {
    const g = graph(
      [start(), agent('a'), agent('b'), end()],
      [edge('e0', 'start', 'a'), edge('e1', 'a', 'b'), edge('e2', 'b', 'end')],
    )
    expect([...descendantIds(g, 'a')].sort()).toEqual(['b', 'end'])
    expect(seedForRerun({ a: 1, b: 2 }, g, 'b')).toEqual({ a: 1 })
    expect(seedForRerun({ a: 1, b: 2 }, g, 'a', 'edited')).toEqual({ a: 'edited' })
  })

  it('wires classify class and default edges when inserting between', () => {
    const g = graph([start(), end()], [edge('e0', 'start', 'end')])
    const inserted = insertBetween(g, 'start', 'end', 'classify')!
    const out = inserted.graph.edges.filter(e => e.from === inserted.nodeId)
    expect(out.map(e => e.label).sort()).toEqual(['a', 'b', 'default'])
  })
})
