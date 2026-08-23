/**
 * Preset composition graph conversion: rows project to a chain graph and back.
 *
 * Round-trips are lossless on the JSON-safe row subset; a non-chain DAG
 * extracts in deterministic topological order; condition/loop nodes, agents
 * without a composition module, and cycles are refused. `graphRowsMatch` is
 * the staleness rule behind the graph read.
 */

import { describe, expect, it } from 'vitest'
import type { FlowAgentNode, FlowGraph } from '@deepseek-ai/dsh-flow/types'
import { graphRowsMatch, graphToRows, rowsToGraph } from '@deepseek-ai/dsh-agent-presets'

function agentNode(
  id: string,
  composition: { module: string; id?: string; config?: unknown; disabled?: unknown; group?: boolean | null; inject?: unknown },
): FlowAgentNode {
  return { id, type: 'agent', position: { x: 0, y: 0 }, prompt: '', composition }
}

const START: FlowGraph['nodes'][number] = { id: 'start', type: 'start', position: { x: 0, y: 0 } }
const END: FlowGraph['nodes'][number] = { id: 'end', type: 'end', position: { x: 0, y: 0 } }

describe('rowsToGraph / graphToRows', () => {
  it('projects rows to a chain graph and back losslessly', () => {
    const rows = [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'base' } },
      {
        id: 'bash', name: '@deepseek-ai/dsh-tool-bash',
        disabled: { __jsExpr: "process.platform === 'win32'" } as unknown as boolean,
      },
      { id: 'tools', name: 'tools-group', group: true, config: [{ id: 'a', name: 'x' }] },
      { id: 'injected', name: '@deepseek-ai/dsh-persona', inject: { '@deepseek-ai/dsh-tool-bash': false } },
    ]

    const graph = rowsToGraph('p', 'Name', rows)
    expect(graph.nodes.map(node => node.type)).toEqual(['start', 'agent', 'agent', 'agent', 'agent', 'end'])
    expect(graph.edges.map(edge => [edge.from, edge.to])).toEqual([
      ['start', 'agent-1'], ['agent-1', 'agent-2'], ['agent-2', 'agent-3'], ['agent-3', 'agent-4'], ['agent-4', 'end'],
    ])
    expect(graphToRows(graph)).toEqual(rows)
  })

  it('keeps composition.id undefined for an id-less row while minting canvas node ids', () => {
    const graph = rowsToGraph('p', 'Name', [{ name: '@deepseek-ai/dsh-persona' }])
    const node = graph.nodes.find(candidate => candidate.type === 'agent')
    expect(node).toMatchObject({ id: 'agent-1' })
    expect((node as FlowAgentNode).composition).toEqual({ module: '@deepseek-ai/dsh-persona' })
    expect(graphToRows(graph)).toEqual([{ name: '@deepseek-ai/dsh-persona' }])
  })

  it('projects an empty row list to a start-to-end graph', () => {
    const graph = rowsToGraph('p', 'Name', [])
    expect(graph.nodes.map(node => node.type)).toEqual(['start', 'end'])
    expect(graph.edges).toEqual([{ id: 'e-start', from: 'start', to: 'end' }])
    expect(graphToRows(graph)).toEqual([])
  })

  it('extracts a non-chain DAG in deterministic topological order', () => {
    const graph: FlowGraph = {
      id: 'dag', name: 'DAG',
      nodes: [
        START,
        agentNode('a', { id: 'persona', module: '@deepseek-ai/dsh-persona' }),
        agentNode('b', { id: 'bash', module: '@deepseek-ai/dsh-tool-bash' }),
        agentNode('c', { id: 'fs', module: '@deepseek-ai/dsh-tool-fs' }),
        END,
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'a', to: 'c' },
        { id: 'e4', from: 'b', to: 'c' },
        { id: 'e5', from: 'c', to: 'end' },
      ],
    }
    // `a` and `b` are both ready after `start`; the stable node-id tie-break
    // emits them in id order.
    expect(graphToRows(graph).map(row => row.id)).toEqual(['persona', 'bash', 'fs'])
  })

  it('refuses a condition or loop node', () => {
    const graph: FlowGraph = {
      id: 'g', name: 'G',
      nodes: [
        START,
        agentNode('a', { id: 'persona', module: '@deepseek-ai/dsh-persona' }),
        { id: 'cond', type: 'condition', position: { x: 0, y: 0 }, expression: 'true' },
        END,
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'a', to: 'cond' },
        { id: 'e3', from: 'cond', to: 'end' },
      ],
    }
    expect(() => graphToRows(graph)).toThrow(/branching is a later phase/)
  })

  it('refuses an agent node without a composition module', () => {
    const graph: FlowGraph = {
      id: 'g', name: 'G',
      nodes: [
        START,
        { id: 'a', type: 'agent', position: { x: 0, y: 0 }, prompt: 'plain' },
        END,
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'a', to: 'end' },
      ],
    }
    expect(() => graphToRows(graph)).toThrow(/without a composition module/)
  })

  it('refuses a cyclic graph rather than reorder silently', () => {
    const graph: FlowGraph = {
      id: 'g', name: 'G',
      nodes: [
        START,
        agentNode('a', { id: 'persona', module: '@deepseek-ai/dsh-persona' }),
        agentNode('b', { id: 'bash', module: '@deepseek-ai/dsh-tool-bash' }),
        END,
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'a' },
      ],
    }
    expect(() => graphToRows(graph)).toThrow(/acyclic/)
  })
})

describe('graphRowsMatch', () => {
  it('serves while the graph projects the rows and answers false on divergence', () => {
    const rows = [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'base' } }]
    const graph = rowsToGraph('p', 'Name', rows)
    expect(graphRowsMatch(graph, rows)).toBe(true)
    expect(graphRowsMatch(graph, [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'changed' } },
    ])).toBe(false)
    expect(graphRowsMatch(graph, [])).toBe(false)
  })

  it('answers false, not throw, for a graph that refuses to project', () => {
    const cyclic: FlowGraph = {
      id: 'c', name: 'C',
      nodes: [
        START,
        agentNode('a', { id: 'persona', module: '@deepseek-ai/dsh-persona' }),
        agentNode('b', { id: 'bash', module: '@deepseek-ai/dsh-tool-bash' }),
        END,
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'a' },
      ],
    }
    expect(graphRowsMatch(cyclic, [])).toBe(false)
  })
})
