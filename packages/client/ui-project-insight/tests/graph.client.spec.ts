/**
 * Pure graph derivation: the module graph drops external leaves, self-loops,
 * and imports whose target is not emitted, labels through path aliases, and
 * caps nodes by degree and edges by count; the component graph renders every
 * component, folds the mutual-import pairs into the cycle highlight set, and
 * shares the edge cap.
 */

import { describe, expect, it } from 'vitest'
import type {
  ComponentDependenciesSection,
  ModuleTopologySection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import { deriveComponentGraph, deriveModuleGraph, DEFAULT_GRAPH_CAPS } from '../src/client/graph.ts'

const MODULE_SECTION: ModuleTopologySection = {
  files: [
    { path: 'src/entry.ts', imports: ['src/app.ts', 'src/lib.ts', 'external:react'] },
    { path: 'src/app.ts', imports: ['src/lib.ts'] },
    { path: 'src/lib.ts', imports: [] },
    { path: 'src/core/util.ts', imports: ['src/lib.ts'] },
    // Degree-zero files: external-only imports, a self-loop, and a target the
    // emitted set does not include — none of them becomes a node.
    { path: 'src/orphan.ts', imports: ['external:lodash'] },
    { path: 'src/self.ts', imports: ['src/self.ts'] },
    { path: 'src/uses-missing.ts', imports: ['src/not-emitted.ts'] },
  ],
  internalRoots: ['src'],
  aliases: [
    { key: '@core', value: 'src/core' },
    { key: '@', value: 'src' },
  ],
  externalCount: 2,
}

const COMPONENT_SECTION: ComponentDependenciesSection = {
  components: [
    { path: 'src/components/A.tsx', imports: ['src/components/B.tsx'] },
    { path: 'src/components/B.tsx', imports: ['src/components/A.tsx', 'src/components/C.tsx'] },
    { path: 'src/components/C.tsx', imports: [] },
    { path: 'src/components/D.tsx', imports: ['src/components/C.tsx', 'src/components/NotEmitted.tsx'] },
  ],
  cycles: [['src/components/A.tsx', 'src/components/B.tsx']],
}

describe('deriveModuleGraph', () => {
  it('derives nodes, edges, and alias labels from a module section', () => {
    const graph = deriveModuleGraph(MODULE_SECTION)
    // Highest degree first: lib is imported by app, entry, and util.
    expect(graph.nodes.map(node => node.id)).toEqual([
      'src/lib.ts', 'src/app.ts', 'src/entry.ts', 'src/core/util.ts',
    ])
    expect(graph.nodes.map(node => node.label)).toEqual([
      '@/lib.ts', '@/app.ts', '@/entry.ts', '@core/util.ts',
    ])
    expect(graph.edges).toEqual([
      { source: 'src/app.ts', target: 'src/lib.ts' },
      { source: 'src/core/util.ts', target: 'src/lib.ts' },
      { source: 'src/entry.ts', target: 'src/app.ts' },
      { source: 'src/entry.ts', target: 'src/lib.ts' },
    ])
    expect([...graph.cycleNodeIds]).toEqual([])
    expect(graph.capped).toEqual({ nodes: 0, edges: 0 })
  })

  it('drops external leaves, self-loops, and un-emitted import targets', () => {
    const graph = deriveModuleGraph(MODULE_SECTION)
    const ids = graph.nodes.map(node => node.id)
    expect(ids).not.toContain('src/orphan.ts')
    expect(ids).not.toContain('src/self.ts')
    expect(ids).not.toContain('src/uses-missing.ts')
    expect(graph.edges.some(edge => edge.source === 'src/self.ts')).toBe(false)
    expect(graph.edges.some(edge => edge.target.startsWith('external:'))).toBe(false)
  })

  it('caps nodes by degree, keeping the highest-degree paths', () => {
    const graph = deriveModuleGraph(MODULE_SECTION, { maxNodes: 2, maxEdges: 500 })
    expect(graph.nodes.map(node => node.id)).toEqual(['src/lib.ts', 'src/app.ts'])
    // Edges to a dropped node disappear; the surviving internal edge stays.
    expect(graph.edges).toEqual([{ source: 'src/app.ts', target: 'src/lib.ts' }])
    expect(graph.capped).toEqual({ nodes: 2, edges: 0 })
  })

  it('caps edges by count after a deterministic sort', () => {
    const graph = deriveModuleGraph(MODULE_SECTION, { maxNodes: 120, maxEdges: 2 })
    expect(graph.edges).toEqual([
      { source: 'src/app.ts', target: 'src/lib.ts' },
      { source: 'src/core/util.ts', target: 'src/lib.ts' },
    ])
    expect(graph.capped).toEqual({ nodes: 0, edges: 2 })
  })

  it('yields an empty graph for an empty section', () => {
    const graph = deriveModuleGraph({ files: [], internalRoots: [], aliases: [], externalCount: 0 })
    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
    expect(graph.capped).toEqual({ nodes: 0, edges: 0 })
  })
})

describe('deriveComponentGraph', () => {
  it('derives nodes, edges, and the cycle highlight set', () => {
    const graph = deriveComponentGraph(COMPONENT_SECTION)
    expect(graph.nodes.map(node => node.id)).toEqual([
      'src/components/A.tsx', 'src/components/B.tsx',
      'src/components/C.tsx', 'src/components/D.tsx',
    ])
    expect(graph.edges).toEqual([
      { source: 'src/components/A.tsx', target: 'src/components/B.tsx' },
      { source: 'src/components/B.tsx', target: 'src/components/A.tsx' },
      { source: 'src/components/B.tsx', target: 'src/components/C.tsx' },
      { source: 'src/components/D.tsx', target: 'src/components/C.tsx' },
    ])
    expect([...graph.cycleNodeIds].sort()).toEqual([
      'src/components/A.tsx', 'src/components/B.tsx',
    ])
    expect(graph.capped).toEqual({ nodes: 0, edges: 0 })
  })

  it('drops component imports whose target is not emitted', () => {
    const graph = deriveComponentGraph(COMPONENT_SECTION)
    expect(graph.edges.some(edge => edge.target === 'src/components/NotEmitted.tsx')).toBe(false)
  })

  it('caps edges by count', () => {
    const graph = deriveComponentGraph(COMPONENT_SECTION, { ...DEFAULT_GRAPH_CAPS, maxEdges: 2 })
    expect(graph.edges).toEqual([
      { source: 'src/components/A.tsx', target: 'src/components/B.tsx' },
      { source: 'src/components/B.tsx', target: 'src/components/A.tsx' },
    ])
    expect(graph.capped).toEqual({ nodes: 0, edges: 2 })
  })

  it('yields an empty graph for an empty section', () => {
    const graph = deriveComponentGraph({ components: [], cycles: [] })
    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
    expect([...graph.cycleNodeIds]).toEqual([])
  })
})
