/**
 * The pure graph ↔ React Flow mapping: a {@link FlowGraph} becomes React
 * Flow's `Node[]`/`Edge[]`, and React Flow's gesture reports reduce to
 * {@link FlowCanvasSurface} calls. No DOM and no React Flow store is touched;
 * the jsdom spec that drives the real canvas (editor-dom.client.spec.tsx)
 * asserts the same calls through the DOM.
 */

import type { Edge, Node } from '@xyflow/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FlowGraph, FlowNode } from '@deepseek-ai/dsh-flow/types'
import type { FlowCanvasSurface } from '../src/client/index.ts'
import {
  CANVAS_NODE_TYPE,
  INSERTABLE_EDGE_TYPE,
  applyConnect,
  clampPosition,
  graphToRfEdges,
  graphToRfNodes,
  selectionFrom,
} from '../src/client/rf-map.ts'

const graph: FlowGraph = {
  id: 'demo',
  name: 'Demo flow',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
    { id: 'agent-a', type: 'agent', prompt: '', position: { x: 220, y: 40 } },
  ],
  edges: [
    { id: 'e-start-agent', from: 'start', to: 'agent-a', label: 'true' },
    { id: 'e-agent-end', from: 'agent-a', to: 'end' },
  ],
}

const renderNode = (node: FlowNode): ReactNode => node.id

describe('graphToRfNodes', () => {
  it('maps an empty graph to no nodes', () => {
    expect(graphToRfNodes(null, renderNode, { readOnly: false, selectedNodeId: null })).toEqual([])
  })

  it('maps each flow node to a canvas node carrying the render and gesture hooks', () => {
    const nodeClass = vi.fn(() => 'run-accent')
    const onAddNode = vi.fn()
    const mapped = graphToRfNodes(graph, renderNode, {
      readOnly: true,
      selectedNodeId: 'agent-a',
      nodeClass,
      connectAriaLabel: 'connect',
      onAddNode,
      addNodeAriaLabel: 'Add after {id}',
    })

    expect(mapped).toHaveLength(2)
    expect(mapped[0]).toEqual({
      id: 'start',
      type: CANVAS_NODE_TYPE,
      position: { x: 0, y: 0 },
      selected: false,
      data: {
        node: graph.nodes[0],
        renderNode,
        readOnly: true,
        nodeClass,
        connectAriaLabel: 'connect',
        onAddNode,
        addNodeAriaLabel: 'Add after {id}',
      },
    })
    expect(mapped[1]?.selected).toBe(true)
    expect(mapped[1]?.data.node).toBe(graph.nodes[1])
  })

  it('leaves the optional hooks undefined when the caller omits them', () => {
    const [mapped] = graphToRfNodes(graph, renderNode, { readOnly: false, selectedNodeId: null })
    expect(mapped?.data.nodeClass).toBeUndefined()
    expect(mapped?.data.connectAriaLabel).toBeUndefined()
    expect(mapped?.data.onAddNode).toBeUndefined()
    expect(mapped?.data.addNodeAriaLabel).toBeUndefined()
  })
})

describe('graphToRfEdges', () => {
  it('maps an empty graph to no edges', () => {
    expect(graphToRfEdges(null, { readOnly: false, selectedEdgeId: null })).toEqual([])
  })

  it('maps each flow edge to an insertable edge carrying label and hook', () => {
    const onInsertBetween = vi.fn()
    const mapped = graphToRfEdges(graph, {
      readOnly: true,
      selectedEdgeId: 'e-agent-end',
      onInsertBetween,
      insertBetweenAriaLabel: 'Insert between',
    })

    expect(mapped).toHaveLength(2)
    expect(mapped[0]).toEqual({
      id: 'e-start-agent',
      type: INSERTABLE_EDGE_TYPE,
      source: 'start',
      target: 'agent-a',
      selected: false,
      markerEnd: { type: 'arrowclosed', width: 18, height: 18, color: '#475569' },
      style: { stroke: '#475569', strokeWidth: 2.5 },
      data: {
        readOnly: true,
        label: 'true',
        onInsertBetween,
        insertBetweenAriaLabel: 'Insert between',
      },
    })
    expect(mapped[1]?.selected).toBe(true)
    expect(mapped[1]?.data?.label).toBeUndefined()
    expect(mapped[1]?.data?.onInsertBetween).toBe(onInsertBetween)
    expect(mapped[1]?.markerEnd).toEqual({
      type: 'arrowclosed', width: 18, height: 18, color: '#475569',
    })
  })
})

describe('selectionFrom', () => {
  const node = (id: string) => ({ id }) as unknown as Node
  const edge = (id: string) => ({ id }) as unknown as Edge

  it('reports nothing when nothing is selected', () => {
    expect(selectionFrom([], [])).toEqual({ nodeId: null, edgeId: null })
  })

  it('reports the first node when only nodes are selected', () => {
    expect(selectionFrom([node('a'), node('b')], [])).toEqual({ nodeId: 'a', edgeId: null })
  })

  it('reports the first edge when only edges are selected', () => {
    expect(selectionFrom([], [edge('e1'), edge('e2')])).toEqual({ nodeId: null, edgeId: 'e1' })
  })

  it('reports both selections when both are selected', () => {
    expect(selectionFrom([node('a')], [edge('e1')])).toEqual({ nodeId: 'a', edgeId: 'e1' })
  })

  it('reduces a node without an id to null', () => {
    expect(selectionFrom([{} as unknown as Node], [])).toEqual({ nodeId: null, edgeId: null })
  })
})

describe('applyConnect', () => {
  it('routes a completed connection to the surface edge adder', () => {
    const addEdge = vi.fn()
    const surface = { addEdge } as unknown as FlowCanvasSurface
    applyConnect({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null }, surface)
    expect(addEdge).toHaveBeenCalledWith('a', 'b')
  })
})

describe('clampPosition', () => {
  it('clamps both coordinates to the origin', () => {
    expect(clampPosition({ x: -40, y: -12 })).toEqual({ x: 0, y: 0 })
  })

  it('leaves positive coordinates untouched', () => {
    expect(clampPosition({ x: 40, y: 12 })).toEqual({ x: 40, y: 12 })
  })
})
