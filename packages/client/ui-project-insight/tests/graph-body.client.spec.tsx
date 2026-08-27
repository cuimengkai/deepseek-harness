// @vitest-environment jsdom
/**
 * The shared dependency-graph body over a mocked TopologyGraph: the canvas,
 * the floating complete list, and the selected file's content drawer all
 * render; list hover and click drive the canvas selection/hover props; a
 * canvas tap and background tap drive the row highlight and scroll-back;
 * selecting a row or node opens the content drawer (embedded content when
 * the documents pool carries the file, otherwise the row JSON) and closing
 * the drawer clears the selection; rows outside the bounded node set stay
 * listed but dimmed and inert; closing the floating list hides it and the
 * toolbar toggle reopens it; and a section with no rendered edges falls back
 * to the tree explorer instead of a canvas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModuleTopologySection, ProjectInsightDoc } from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import { InsightTab, type InsightSectionKey, type InsightTabProps } from '../src/client/InsightTab.tsx'
import type { TopologyGraphProps } from '../src/client/TopologyGraph.tsx'
import type { ProjectInsightState } from '../src/client/insight-store.ts'
import { en } from '../src/client/locales.ts'
import css from '../src/client/insight.module.css'

/** The canvas double: records its props so tests can drive canvas→list sync. */
let graphProps: TopologyGraphProps | undefined

vi.mock('../src/client/TopologyGraph.tsx', () => ({
  TopologyGraph: (props: unknown) => {
    graphProps = props as TopologyGraphProps
    return <div data-testid="topology" />
  },
}))

// jsdom does not implement scrollIntoView; the selected row scrolls through it.
const scrollIntoView = vi.fn()

beforeEach(() => {
  scrollIntoView.mockClear()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  })
})

/** The interpolating locale face used across these tests. */
function t(key: keyof typeof en, params?: Record<string, string>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

/** A module section with one internal edge and one isolated file. */
const MODULE_TOPOLOGY: ModuleTopologySection = {
  files: [
    { path: 'src/main.ts', imports: ['src/components/Button.tsx', 'external:react'] },
    { path: 'src/components/Button.tsx', imports: [] },
    { path: 'src/utils/format.ts', imports: [] },
  ],
  internalRoots: ['src'],
  aliases: [{ key: '@', value: 'src' }],
  externalCount: 1,
}

function renderVariant(
  variant: InsightSectionKey,
  sections: ProjectInsightDoc['sections'],
) {
  const store = createSnapshotStore<ProjectInsightState>({
    status: 'ready',
    error: null,
    doc: {
      formatVersion: 5,
      rootName: 'fake-root',
      contentFingerprint: 'deadbeef',
      statSignature: 'deadbeef-stat',
      scannedAt: 0,
      sections,
    },
  })
  return render(<InsightTab {...({
    useProjectInsight: bindSnapshotSelector(store),
    load: vi.fn(),
    dispose: vi.fn(),
    variant,
    t,
  } as unknown as InsightTabProps)} />)
}

/** The empty companion sections so only the module topology carries data. */
function moduleDoc(
  moduleTopology: ModuleTopologySection,
  documents: ProjectInsightDoc['sections']['documents'] = { files: [], count: 0 },
): ProjectInsightDoc['sections'] {
  return {
    techStack: { manifests: [], dependencies: [], runtimes: [], files: [] },
    moduleTopology,
    componentDependencies: { components: [], cycles: [] },
    components: { components: [], count: 0 },
    prompts: { files: [], count: 0 },
    agentTech: { files: [], tools: [], count: 0, skills: [], mcp: [], prompts: [] },
    documents,
  }
}

/** The floating row div for a list label. */
function listRow(label: string): HTMLElement {
  return screen.getByText(label).closest('div')!
}

afterEach(() => {
  cleanup()
  graphProps = undefined
})

describe('dependency-graph body', () => {
  it('renders the toolbar, the full-bleed canvas, and the floating list', () => {
    renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY))

    expect(screen.getByTestId('topology')).toBeTruthy()
    expect(screen.getByText('Internal roots: src · External packages: 1')).toBeTruthy()
    expect(screen.getByText('Full list (3)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'List (3)' })).toBeTruthy()
  })

  it('drives the canvas hover ring from a list row hover', () => {
    renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY))

    fireEvent.mouseEnter(listRow('@/main.ts'))

    expect(graphProps?.hoverNodeId).toBe('src/main.ts')
    expect(listRow('@/main.ts').className).toContain(css.listRowHover)
  })

  it('selects and centers the canvas node from a list row click', () => {
    renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY))

    fireEvent.click(listRow('@/main.ts'))

    expect(graphProps?.selectedNodeId).toBe('src/main.ts')
    expect(listRow('@/main.ts').className).toContain(css.listRowSelected)
  })

  it('selects and scrolls the list row from a canvas node tap', () => {
    renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY))

    act(() => graphProps?.onSelectNode?.('src/components/Button.tsx'))

    expect(listRow('@/components/Button.tsx').className).toContain(css.listRowSelected)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('clears the selection on a canvas background tap', () => {
    renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY))
    fireEvent.click(listRow('@/main.ts'))
    expect(graphProps?.selectedNodeId).toBe('src/main.ts')

    act(() => graphProps?.onTapBackground?.())

    expect(graphProps?.selectedNodeId).toBeNull()
    expect(listRow('@/main.ts').className).not.toContain(css.listRowSelected)
  })

  it('keeps rows outside the node set listed but dimmed and inert', () => {
    renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY))

    const row = listRow('src/utils/format.ts')
    expect(row.textContent).toContain('not in graph')
    expect(row.className).toContain(css.listRowDim)

    fireEvent.click(row)
    fireEvent.mouseEnter(row)
    expect(graphProps?.selectedNodeId).toBeNull()
    expect(graphProps?.hoverNodeId).toBeNull()
  })

  it('closes the floating list and reopens it from the toolbar', () => {
    renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY))
    expect(screen.getByText('Full list (3)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse list' }))
    expect(screen.queryByText('Full list (3)')).toBeNull()
    expect(screen.getByTestId('topology')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'List (3)' }))
    expect(screen.getByText('Full list (3)')).toBeTruthy()
  })

  it('opens the selected file’s content drawer from the documents pool and closes it', () => {
    const documents = {
      files: [{ name: 'main.ts', path: 'src/main.ts', content: 'export const main = 1\n' }],
      count: 3,
    }
    const { container } = renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY, documents))

    fireEvent.click(listRow('@/main.ts'))

    expect(graphProps?.selectedNodeId).toBe('src/main.ts')
    // The drawer shows the embedded content, not the row's metadata JSON.
    expect(container.querySelector('.md-code-block')?.textContent).toContain('export const main = 1')
    expect(container.querySelector('.md-code-block')?.textContent).not.toContain('"imports"')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(container.querySelector('.md-code-block')).toBeNull()
    expect(graphProps?.selectedNodeId).toBeNull()
  })

  it('shows the row’s metadata JSON in the drawer when the pool lacks the file', () => {
    const { container } = renderVariant('moduleTopology', moduleDoc(MODULE_TOPOLOGY))

    fireEvent.click(listRow('@/main.ts'))

    expect(container.querySelector('.md-code-block')?.textContent).toContain('"imports"')
  })

  it('falls back to the tree explorer when no edge set renders', () => {
    const isolated: ModuleTopologySection = {
      files: [{ path: 'src/main.ts', imports: ['external:react'] }],
      internalRoots: ['src'],
      aliases: [],
      externalCount: 1,
    }
    const { container } = renderVariant('moduleTopology', moduleDoc(isolated))

    expect(screen.queryByTestId('topology')).toBeNull()
    expect(screen.queryByRole('button', { name: /List/ })).toBeNull()
    // The explorer renders the directory group; the default-selected leaf's
    // detail carries the row's metadata JSON with its external import.
    expect(screen.getByText('src')).toBeTruthy()
    expect(container.querySelector('.md-code-block')?.textContent).toContain('external:react')
  })
})
