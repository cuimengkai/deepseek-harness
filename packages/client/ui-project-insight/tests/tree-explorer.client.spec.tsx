// @vitest-environment jsdom
/**
 * The left-tree/right-detail explorer: the default selection is the first
 * leaf with its ancestors expanded; a row click selects (a group row also
 * expands its subtree) and swaps the right pane's highlighted JSON; a caret
 * click toggles expansion without changing the selection; the note renders
 * above the tree; the root opts into the composer overlay; a caller-supplied
 * leaf body replaces the JSON for leaves; and a selection a reshaped forest
 * no longer carries falls back to the first leaf.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TechStackSection } from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import { TreeExplorer } from '../src/client/TreeExplorer.tsx'
import { deriveComponentsTree, deriveTechStackTree } from '../src/client/tree.ts'
import { en } from '../src/client/locales.ts'
import css from '../src/client/insight.module.css'

/** The locale face used across these tests: resolves package keys, echoes the rest. */
function t(key: string, params?: Record<string, unknown>): string {
  const template = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    if (value === undefined) return match
    return typeof value === 'string' ? value : JSON.stringify(value)
  })
}

const TECH_STACK: TechStackSection = {
  runtimes: [{ name: 'node', version: '22.19.0' }],
  manifests: [{ kind: 'package.json', path: 'package.json' }],
  dependencies: [
    { name: 'react', version: '^18.0.0', category: 'dependencies' },
    { name: 'typescript', version: '~5.6', category: 'devDependencies' },
  ],
  files: [{ path: 'src/main.ts', language: 'typescript', lines: 10 }],
}

const ROOTS = deriveTechStackTree(TECH_STACK, {
  runtimes: en['label.runtimes'],
  manifests: en['label.manifests'],
  dependencies: en['label.dependencies'],
  sourceFiles: en['label.sourceFiles'],
})

/** The tree row's label span (rows render labels inside the row's main span). */
function rowLabel(label: string): HTMLElement {
  return screen.getByText(label, { selector: `.${css.treeRowMain}` })
}

/** The treeitem wrapper owning the row labeled `label`. */
function treeitemOf(label: string): HTMLElement {
  return rowLabel(label).closest('[role="treeitem"]')!
}

/** The rendered code block's text content (the selected node's JSON). */
function detailText(container: HTMLElement): string {
  return container.querySelector('.md-code-block')?.textContent ?? ''
}

afterEach(cleanup)

describe('TreeExplorer', () => {
  it('selects the first leaf by default and renders its JSON highlighted', () => {
    const { container } = render(<TreeExplorer roots={ROOTS} t={t} />)

    // The runtimes group is expanded so the default leaf is visible and selected.
    expect(screen.getByRole('tree')).toBeTruthy()
    expect(treeitemOf('node@22.19.0').getAttribute('aria-selected')).toBe('true')
    expect(detailText(container)).toContain('"name": "node"')
    // The banner names the grammar and carries the localized copy label.
    expect(container.querySelector('.md-code-block')?.textContent).toContain('json')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })

  it('opts into the composer overlay so the panes own their scrollers', () => {
    const { container } = render(<TreeExplorer roots={ROOTS} t={t} />)

    expect(container.querySelector('[data-conversation-composer-overlay]')).toBeTruthy()
  })

  it('selects a group row, expands it, and renders the group payload', () => {
    const { container } = render(<TreeExplorer roots={ROOTS} t={t} />)

    fireEvent.click(rowLabel('Dependencies'))

    expect(treeitemOf('Dependencies').getAttribute('aria-selected')).toBe('true')
    // The group expands to its category groups, and the payload is the row set.
    expect(rowLabel('dependencies')).toBeTruthy()
    expect(rowLabel('devDependencies')).toBeTruthy()
    expect(detailText(container)).toContain('"category": "dependencies"')
    // A group carries its child count beside its label.
    expect(screen.getByText('2', { selector: `.${css.treeRowCount}` })).toBeTruthy()
  })

  it('selects a leaf on row click and swaps the right pane', () => {
    const { container } = render(<TreeExplorer roots={ROOTS} t={t} />)

    fireEvent.click(rowLabel('Source files'))
    fireEvent.click(rowLabel('typescript'))
    fireEvent.click(rowLabel('src/main.ts'))

    expect(treeitemOf('src/main.ts').getAttribute('aria-selected')).toBe('true')
    expect(detailText(container)).toContain('"language": "typescript"')
    expect(detailText(container)).not.toContain('"category"')
  })

  it('toggles expansion from the caret without changing the selection', () => {
    const { container } = render(<TreeExplorer roots={ROOTS} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '▾' }))

    // The subtree collapsed, but the first leaf stays selected and rendered.
    expect(screen.queryByText('node@22.19.0', { selector: `.${css.treeRowMain}` })).toBeNull()
    expect(detailText(container)).toContain('"name": "node"')
    expect(screen.getAllByRole('button', { name: '▸' })).toHaveLength(4)
  })

  it('renders the note above the tree', () => {
    render(<TreeExplorer roots={ROOTS} note={<span>{'4 items'}</span>} t={t} />)

    expect(screen.getByText('4 items')).toBeTruthy()
  })

  it('falls back to the first leaf when a reshaped forest drops the selection', () => {
    const { container, rerender } = render(<TreeExplorer roots={ROOTS} t={t} />)

    fireEvent.click(rowLabel('Manifests'))
    fireEvent.click(rowLabel('package.json'))
    expect(detailText(container)).toContain('"kind": "package.json"')

    const reshaped = deriveTechStackTree(
      { manifests: [], dependencies: TECH_STACK.dependencies, runtimes: TECH_STACK.runtimes, files: [] },
      {
        runtimes: en['label.runtimes'],
        manifests: en['label.manifests'],
        dependencies: en['label.dependencies'],
        sourceFiles: en['label.sourceFiles'],
      },
    )
    rerender(<TreeExplorer roots={reshaped} t={t} />)

    // The vanished selection falls back to the first leaf of the new forest.
    expect(treeitemOf('node@22.19.0').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('package.json', { selector: `.${css.treeRowMain}` })).toBeNull()
  })

  it('renders the components forest grouped by directory', () => {
    const { container } = render(<TreeExplorer
      roots={deriveComponentsTree({
        components: [
          { path: 'src/components/Button.tsx', name: 'Button', kind: 'react', defaultExport: true, hasProps: true },
        ],
        count: 1,
      })}
      note={<span>{'1 item'}</span>}
      t={t}
    />)

    fireEvent.click(rowLabel('src/components'))
    fireEvent.click(rowLabel('Button'))
    expect(detailText(container)).toContain('"name": "Button"')
    expect(detailText(container)).toContain('"defaultExport": true')
    expect(screen.getByText('1 item')).toBeTruthy()
  })

  it('renders a leaf through the caller\'s leaf body instead of the JSON', () => {
    const { container } = render(
      <TreeExplorer
        roots={[{
          key: 'group:docs',
          label: 'docs',
          detail: [{ markdown: '# A' }],
          children: [{ key: 'doc:a', label: 'a.md', detail: { markdown: '# A' } }],
        }]}
        t={t}
        renderLeafDetail={node => <p>{`body:${node.label}`}</p>}
      />,
    )

    // The default selection is the leaf, so the caller's body renders in the
    // right pane and the JSON code block (with its Copy button) is absent.
    expect(screen.getByText('body:a.md')).toBeTruthy()
    expect(container.querySelector('.md-code-block')).toBeNull()
    // Selecting the group row still renders the group's JSON payload.
    fireEvent.click(rowLabel('docs'))
    expect(detailText(container)).toContain('"markdown": "# A"')
  })

  it('renders an empty tree pane for an empty forest', () => {
    const { container } = render(<TreeExplorer roots={[]} t={t} />)

    expect(screen.getByRole('tree')).toBeTruthy()
    expect(container.querySelector('.md-code-block')).toBeNull()
  })
})
