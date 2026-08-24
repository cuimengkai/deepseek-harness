/**
 * The pure dagre layout: a single-node graph lands at the origin, a chain runs
 * left-to-right on one row, a diamond ranks its shared column, the returned
 * bounding box contains every node box, and an empty node set yields empty
 * positions. Positions are natural flow coordinates normalized to the origin —
 * deterministic, with no dependence on any container size.
 */

import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../src/client/graph.ts'
import { layoutDagre, NODE_HEIGHT, NODE_WIDTH } from '../src/client/layout.ts'

const A: GraphNode = { id: 'a', label: 'A' }
const B: GraphNode = { id: 'b', label: 'B' }
const C: GraphNode = { id: 'c', label: 'C' }
const D: GraphNode = { id: 'd', label: 'D' }
const A_TO_B: GraphEdge = { source: 'a', target: 'b' }
const A_TO_C: GraphEdge = { source: 'a', target: 'c' }
const B_TO_D: GraphEdge = { source: 'b', target: 'd' }
const C_TO_D: GraphEdge = { source: 'c', target: 'd' }

describe('layoutDagre', () => {
  it('returns empty positions for an empty node set', () => {
    const result = layoutDagre([], [])
    expect(result.positions.size).toBe(0)
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })

  it('places a single node at the normalized origin with its box as the bbox', () => {
    const result = layoutDagre([A], [])
    expect(result.positions.get('a')).toEqual({ x: 0, y: 0 })
    expect(result.width).toBe(NODE_WIDTH)
    expect(result.height).toBe(NODE_HEIGHT)
  })

  it('lays a chain left-to-right on one row', () => {
    const result = layoutDagre([A, B], [A_TO_B])
    const a = result.positions.get('a')!
    const b = result.positions.get('b')!
    expect(b.x).toBeGreaterThan(a.x)
    expect(b.y).toBe(a.y)
  })

  it('ranks the shared column of a diamond on the same x', () => {
    const result = layoutDagre([A, B, C, D], [A_TO_B, A_TO_C, B_TO_D, C_TO_D])
    const b = result.positions.get('b')!
    const c = result.positions.get('c')!
    const d = result.positions.get('d')!
    expect(b.x).toBe(c.x)
    expect(b.y).not.toBe(c.y)
    expect(d.x).toBeGreaterThan(b.x)
  })

  it('returns a bounding box that contains every node box', () => {
    const wide: GraphNode[] = Array.from({ length: 10 }, (_, index) => ({
      id: `n${index}`,
      label: `n${index}`,
    }))
    const wideEdges: GraphEdge[] = wide.slice(1).map((node, index) => ({
      source: `n${index}`,
      target: node.id,
    }))
    const result = layoutDagre(wide, wideEdges)
    for (const node of wide) {
      const point = result.positions.get(node.id)!
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.x + NODE_WIDTH).toBeLessThanOrEqual(result.width)
      expect(point.y + NODE_HEIGHT).toBeLessThanOrEqual(result.height)
    }
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })

  it('keeps natural node spacing even for a wide chain', () => {
    const wide: GraphNode[] = Array.from({ length: 10 }, (_, index) => ({
      id: `n${index}`,
      label: `n${index}`,
    }))
    const wideEdges: GraphEdge[] = wide.slice(1).map((node, index) => ({
      source: `n${index}`,
      target: node.id,
    }))
    const result = layoutDagre(wide, wideEdges)
    // Consecutive nodes in a rank keep the full rank spacing — the layout never
    // compresses positions, so node boxes never overlap on screen.
    for (let index = 0; index < wide.length - 1; index += 1) {
      const left = result.positions.get(`n${index}`)!
      const right = result.positions.get(`n${index + 1}`)!
      expect(right.x - left.x).toBeGreaterThanOrEqual(NODE_WIDTH)
    }
  })

  it('is deterministic for a given input', () => {
    const nodes = [A, B, C]
    const edges = [A_TO_B, A_TO_C]
    const first = layoutDagre(nodes, edges)
    const second = layoutDagre(nodes, edges)
    expect(second.positions).toEqual(first.positions)
    expect(second.width).toBe(first.width)
    expect(second.height).toBe(first.height)
  })
})
