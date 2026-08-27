// @vitest-environment jsdom
/**
 * The inventory tabs' file views: the tech-stack tab renders a selected
 * source or manifest leaf's embedded content (grammar-hinted source, or the
 * raw JSON text for a manifest) while a runtime leaf — not a file — keeps its
 * metadata JSON; the components tab renders a selected component's embedded
 * source, and a component the documents pool excluded falls back to its
 * metadata JSON.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ComponentsSection, ProjectInsightDoc, TechStackSection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import { InsightTab, type InsightTabProps } from '../src/client/InsightTab.tsx'
import type { ProjectInsightState } from '../src/client/insight-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const TECH_STACK: TechStackSection = {
  runtimes: [{ name: 'node', version: '>=22' }],
  manifests: [{ kind: 'package.json', path: 'package.json' }],
  dependencies: [],
  files: [{ path: 'src/main.ts', language: 'typescript', lines: 3 }],
}

const COMPONENTS: ComponentsSection = {
  components: [
    { path: 'src/Button.tsx', name: 'Button', kind: 'react', defaultExport: true, hasProps: true },
    { path: 'src/Other.vue', name: 'Other', kind: 'vue', defaultExport: false, hasProps: false },
  ],
  count: 2,
}

/** The shared documents pool: the manifest, the tech-stack source, and the
 * first component embed; the second component is deliberately absent so its
 * leaf falls back to metadata JSON. */
const DOCUMENTS: ProjectInsightDoc['sections']['documents'] = {
  files: [
    { name: 'package.json', path: 'package.json', content: '{\n  "name": "demo"\n}\n' },
    { name: 'main.ts', path: 'src/main.ts', content: "import { Button } from './Button'\n" },
    { name: 'Button.tsx', path: 'src/Button.tsx', content: 'export default function Button() {}\n' },
  ],
  count: 3,
}

/** A committed document whose tech-stack and components sections render. */
function doc(): ProjectInsightDoc {
  return {
    formatVersion: 5,
    rootName: 'fake-root',
    contentFingerprint: 'deadbeef',
    statSignature: 'deadbeef-stat',
    scannedAt: 0,
    sections: {
      techStack: TECH_STACK,
      moduleTopology: { files: [], internalRoots: [], aliases: [], externalCount: 0 },
      componentDependencies: { components: [], cycles: [] },
      components: COMPONENTS,
      prompts: { files: [], count: 0 },
      agentTech: {
        files: [], tools: [], count: 0, skills: [], mcp: [], prompts: [],
      },
      documents: DOCUMENTS,
    },
  }
}

function renderVariant(variant: 'techStack' | 'components') {
  const store = createSnapshotStore<ProjectInsightState>({ status: 'ready', error: null, doc: doc() })
  return render(<InsightTab {...({
    useProjectInsight: bindSnapshotSelector(store),
    load: vi.fn(),
    dispose: vi.fn(),
    variant,
    t: (key: keyof typeof en) => en[key],
  } as unknown as InsightTabProps)} />)
}

describe('inventory tabs', () => {
  it('renders a runtime row as metadata JSON and swaps in embedded file content on selection', () => {
    const { container } = renderVariant('techStack')

    // The first leaf is the runtime row, which is not a file: its metadata
    // JSON stays the right pane's render.
    expect(screen.getByText('Runtimes')).toBeTruthy()
    expect(container.querySelector('.md-code-block')?.textContent).toContain('"name": "node"')

    // A manifest leaf renders its embedded file text.
    fireEvent.click(screen.getByText('Manifests'))
    fireEvent.click(screen.getByText('package.json'))
    expect(container.querySelector('.md-code-block')?.textContent).toContain('"name": "demo"')

    // A source leaf renders its embedded source with the grammar hint.
    fireEvent.click(screen.getByText('Source files'))
    fireEvent.click(screen.getByText('typescript'))
    fireEvent.click(screen.getByText('src/main.ts'))
    expect(container.querySelector('.md-code-block')?.textContent).toContain("import { Button } from './Button'")
    expect(container.querySelector('.md-code-block')?.textContent).toContain('ts')
  })

  it('renders a component leaf\'s embedded source, with a metadata fallback for pool-excluded files', () => {
    const { container } = renderVariant('components')

    // The first leaf is the default selection and its embedded source renders.
    expect(container.querySelector('.md-code-block')?.textContent).toContain('export default function Button() {}')

    // A component the documents pool excluded falls back to its metadata JSON.
    fireEvent.click(screen.getByText('Other'))
    expect(container.querySelector('.md-code-block')?.textContent).toContain('"kind": "vue"')
  })
})
