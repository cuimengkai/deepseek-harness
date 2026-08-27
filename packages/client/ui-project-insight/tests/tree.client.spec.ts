/**
 * Pure tree derivation for the inventory tabs: the tech-stack tree keeps the
 * four fixed level-1 groups in the caller's label order, groups dependencies
 * by manifest category and source files by language with each group carrying
 * its rows as the payload; the components tree groups by parent directory with
 * `.` for the project root; the agent-tech inventory tree keeps the file roles
 * in the fixed kind order with the tools root last; the markdown-collection
 * tree groups documents by directory with the row name as the leaf label;
 * flattening keys every node and links each to its parent; and the first-leaf
 * walk resolves the default selection.
 */

import { describe, expect, it } from 'vitest'
import type {
  AgentTechSection, ComponentsSection, TechStackSection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import {
  deriveAgentTechInventoryTree, deriveComponentsTree, deriveMarkdownRowsTree, deriveTechStackTree,
  firstInventoryLeaf, flattenInventoryTree,
} from '../src/client/tree.ts'

const LABELS = {
  runtimes: 'Runtimes',
  manifests: 'Manifests',
  dependencies: 'Dependencies',
  sourceFiles: 'Source files',
}

const TECH_STACK: TechStackSection = {
  runtimes: [
    { name: 'node', version: '22.19.0' },
    { name: 'python' },
  ],
  manifests: [{ kind: 'package.json', path: 'package.json' }],
  dependencies: [
    { name: 'react', version: '^18.0.0', category: 'dependencies' },
    { name: 'typescript', version: '~5.6', category: 'devDependencies' },
    { name: 'vue', category: 'dependencies' },
  ],
  files: [
    { path: 'src/app.vue', language: 'vue', lines: 20 },
    { path: 'src/lib.ts', language: 'typescript', lines: 5 },
    { path: 'src/main.ts', language: 'typescript', lines: 10 },
  ],
}

const COMPONENTS: ComponentsSection = {
  components: [
    { path: 'App.tsx', name: 'App', kind: 'react', defaultExport: true, hasProps: false },
    { path: 'src/components/Button.tsx', name: 'Button', kind: 'react', defaultExport: true, hasProps: true },
    { path: 'src/components/Card.tsx', name: 'Card', kind: 'react', defaultExport: true, hasProps: false },
    { path: 'src/views/Home.vue', name: 'Home', kind: 'vue', defaultExport: false, hasProps: false },
  ],
  count: 4,
}

describe('deriveTechStackTree', () => {
  it('derives the four fixed groups with rows and payloads', () => {
    const roots = deriveTechStackTree(TECH_STACK, LABELS)

    expect(roots.map(root => root.label)).toEqual([
      'Runtimes', 'Manifests', 'Dependencies', 'Source files',
    ])
    // Each group carries its whole row set as the right-pane payload.
    expect(roots[0]?.detail).toBe(TECH_STACK.runtimes)
    expect(roots[1]?.detail).toBe(TECH_STACK.manifests)
    expect(roots[2]?.detail).toBe(TECH_STACK.dependencies)
    expect(roots[3]?.detail).toBe(TECH_STACK.files)
  })

  it('groups dependencies by category and source files by language', () => {
    const roots = deriveTechStackTree(TECH_STACK, LABELS)

    const dependencies = roots[2]?.children ?? []
    expect(dependencies.map(group => group.label)).toEqual(['dependencies', 'devDependencies'])
    expect(dependencies[0]?.children?.map(leaf => leaf.label)).toEqual(['react', 'vue'])
    expect(dependencies[0]?.detail).toEqual([TECH_STACK.dependencies[0], TECH_STACK.dependencies[2]])

    const files = roots[3]?.children ?? []
    expect(files.map(group => group.label)).toEqual(['vue', 'typescript'])
    expect(files[1]?.children?.map(leaf => leaf.label)).toEqual(['src/lib.ts', 'src/main.ts'])
  })

  it('labels runtime leaves with name@version and omits empty groups', () => {
    const roots = deriveTechStackTree({
      manifests: [],
      dependencies: [],
      runtimes: [{ name: 'node', version: '22.19.0' }, { name: 'python' }],
      files: [],
    }, LABELS)

    expect(roots).toHaveLength(1)
    expect(roots[0]?.label).toBe('Runtimes')
    expect(roots[0]?.children?.map(leaf => leaf.label)).toEqual(['node@22.19.0', 'python'])
  })

  it('derives an empty forest for an empty section', () => {
    expect(deriveTechStackTree(
      { manifests: [], dependencies: [], runtimes: [], files: [] },
      LABELS,
    )).toEqual([])
  })
})

describe('deriveComponentsTree', () => {
  it('groups components by parent directory with the project root as "."', () => {
    const roots = deriveComponentsTree(COMPONENTS)

    expect(roots.map(root => root.label)).toEqual(['.', 'src/components', 'src/views'])
    expect(roots[0]?.children).toEqual([
      expect.objectContaining({ key: 'component:App.tsx', label: 'App' }),
    ])
    expect(roots[1]?.children?.map(leaf => leaf.label)).toEqual(['Button', 'Card'])
    expect(roots[1]?.detail).toEqual(COMPONENTS.components.filter(component =>
      component.path.startsWith('src/components/')))
  })

  it('derives an empty forest for an empty section', () => {
    expect(deriveComponentsTree({ components: [], count: 0 })).toEqual([])
  })
})

describe('deriveAgentTechInventoryTree', () => {
  const SECTION: AgentTechSection = {
    files: [
      { path: 'AGENTS.md', kind: 'instructions' },
      { path: '.mcp.json', kind: 'tool-config' },
      { path: '.agents/skills/deploy/SKILL.md', kind: 'agent-config' },
    ],
    tools: [{ name: 'deploy', path: '.agents/skills/deploy/SKILL.md' }],
    count: 3,
    skills: [],
    mcp: [],
    prompts: [],
  }
  const KIND_LABELS = {
    kinds: {
      'agent-config': 'Agent config',
      'tool-config': 'Tool config',
      instructions: 'Instructions',
      notes: 'Notes',
      other: 'Other',
    },
    tools: 'Tools',
  }

  it('keeps the file roles in the fixed kind order with the tools root last', () => {
    const roots = deriveAgentTechInventoryTree(SECTION, KIND_LABELS)

    // The kind order is the schema union's order, not the row order; empty
    // roles (notes, other) are omitted.
    expect(roots.map(root => root.label)).toEqual(['Agent config', 'Tool config', 'Instructions', 'Tools'])
    expect(roots[0]?.children?.map(leaf => leaf.label)).toEqual(['.agents/skills/deploy/SKILL.md'])
    expect(roots[0]?.detail).toEqual([SECTION.files[2]])
    expect(roots[3]?.children?.map(leaf => leaf.label)).toEqual(['deploy'])
  })

  it('derives an empty forest when no files and no tools exist', () => {
    expect(deriveAgentTechInventoryTree({
      files: [], tools: [], count: 0, skills: [], mcp: [], prompts: [],
    }, KIND_LABELS)).toEqual([])
  })
})

describe('deriveMarkdownRowsTree', () => {
  it('groups documents by directory with the row name as the leaf label', () => {
    const rows = [
      { name: 'deploy', path: '.agents/skills/deploy/SKILL.md', content: '# Deploy' },
      { name: 'review', path: '.agents/skills/review/SKILL.md', content: '# Review' },
      { name: 'fix', path: 'fix.prompt.md', content: '# Fix' },
    ]

    const roots = deriveMarkdownRowsTree(rows, 'skills')

    expect(roots.map(root => root.label)).toEqual(['.agents/skills/deploy', '.agents/skills/review', '.'])
    // The scope prefix keeps leaf keys distinct across the subtab forests.
    expect(roots[0]?.children?.map(leaf => leaf.key)).toEqual(['skills:.agents/skills/deploy/SKILL.md'])
    expect(roots[0]?.children?.map(leaf => leaf.label)).toEqual(['deploy'])
    expect(roots[0]?.detail).toEqual([rows[0]])
  })

  it('derives an empty forest for an empty collection', () => {
    expect(deriveMarkdownRowsTree([], 'skills')).toEqual([])
  })
})

describe('flattenInventoryTree', () => {
  it('keys every node and links each to its parent', () => {
    const roots = deriveTechStackTree(TECH_STACK, LABELS)
    const { nodes, parents } = flattenInventoryTree(roots)

    // 4 roots + 2 runtime leaves + 1 manifest leaf + 2 dependency groups with
    // 3 leaves + 2 file groups with 3 leaves.
    expect(nodes.size).toBe(17)
    expect(parents.get('runtimes')).toBeUndefined()
    expect(parents.get('runtimes:node')).toBe('runtimes')
    expect(parents.get('group:dependencies')).toBe('dependencies')
    expect(parents.get('dependencies:dependencies:react')).toBe('group:dependencies')
    expect(parents.get('files:typescript:src/main.ts')).toBe('group:typescript')
  })

  it('flattens an empty forest to empty maps', () => {
    const { nodes, parents } = flattenInventoryTree([])
    expect(nodes.size).toBe(0)
    expect(parents.size).toBe(0)
  })
})

describe('firstInventoryLeaf', () => {
  it('resolves the first leaf in document order', () => {
    const roots = deriveTechStackTree(TECH_STACK, LABELS)
    expect(firstInventoryLeaf(roots)?.label).toBe('node@22.19.0')
  })

  it('resolves the first node itself when the forest has only groups of groups', () => {
    const roots = [{
      key: 'outer',
      label: 'outer',
      detail: null,
      children: [{ key: 'inner', label: 'inner', detail: null }],
    }]
    expect(firstInventoryLeaf(roots)?.key).toBe('inner')
  })

  it('is undefined for an empty forest', () => {
    expect(firstInventoryLeaf([])).toBeUndefined()
  })
})
