// @vitest-environment jsdom
/**
 * The prompts tab: the embedded agent-tech prompt collection renders as a
 * document tab bar over a single markdown viewer with a total/shown count line;
 * switching a document tab swaps the rendered markdown; a section with no
 * embedded content falls back to the metadata table with a zero shown count;
 * and a section with no files at all shows the empty copy.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AgentTechMarkdownRow, ProjectInsightDoc, PromptsSection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import { InsightTab, type InsightTabProps } from '../src/client/InsightTab.tsx'
import type { ProjectInsightState } from '../src/client/insight-store.ts'
import { en } from '../src/client/locales.ts'

/** The interpolating locale face used across these tests. */
function t(key: keyof typeof en, params?: Record<string, string>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

/** A prompts section whose two files both have embedded markdown. */
const PROMPTS: PromptsSection = {
  files: [
    { path: 'prompts/review.prompt.md', title: 'Review checklist', bytes: 19 },
    { path: 'AGENTS.md', bytes: 120 },
  ],
  count: 2,
}

const EMBEDDED: AgentTechMarkdownRow[] = [
  { name: 'review.prompt.md', path: 'prompts/review.prompt.md', markdown: '# Review checklist\n\nLint before pushing.' },
  { name: 'AGENTS.md', path: 'AGENTS.md', markdown: '# Agent instructions\n\nFollow the repo rules.' },
]

/** A committed document whose prompts and embedded prompt collection are set. */
function doc(prompts: PromptsSection, embedded: AgentTechMarkdownRow[]): ProjectInsightDoc {
  return {
    formatVersion: 3,
    rootName: 'fake-root',
    contentFingerprint: 'deadbeef',
    statSignature: 'deadbeef-stat',
    scannedAt: 0,
    sections: {
      techStack: { manifests: [], dependencies: [], runtimes: [], files: [] },
      moduleTopology: { files: [], internalRoots: [], aliases: [], externalCount: 0 },
      componentDependencies: { components: [], cycles: [] },
      components: { components: [], count: 0 },
      prompts,
      agentTech: { files: [], tools: [], count: 0, skills: [], mcp: [], prompts: embedded },
    },
  }
}

function renderPrompts(prompts: PromptsSection, embedded: AgentTechMarkdownRow[]) {
  const store = createSnapshotStore<ProjectInsightState>({ status: 'ready', error: null, doc: doc(prompts, embedded) })
  return render(<InsightTab {...({
    useProjectInsight: bindSnapshotSelector(store),
    load: vi.fn(),
    dispose: vi.fn(),
    variant: 'prompts',
    t,
  } as unknown as InsightTabProps)} />)
}

afterEach(cleanup)

describe('prompts tab', () => {
  it('renders the document tab bar, the first markdown, and the count line', () => {
    renderPrompts(PROMPTS, EMBEDDED)

    expect(screen.getAllByRole('tab').map(tab => tab.textContent))
      .toEqual(['review.prompt.md', 'AGENTS.md'])
    expect(screen.getByRole('tab', { name: 'review.prompt.md' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 1, name: 'Review checklist' })).toBeTruthy()
    expect(screen.getByText('Lint before pushing.')).toBeTruthy()
    // The active document's path heads the markdown pane.
    expect(screen.getByText('prompts/review.prompt.md')).toBeTruthy()
    expect(screen.getByText('2 prompt files · 2 shown')).toBeTruthy()
  })

  it('switches the rendered markdown when another document tab is selected', () => {
    renderPrompts(PROMPTS, EMBEDDED)

    fireEvent.click(screen.getByRole('tab', { name: 'AGENTS.md' }))

    expect(screen.getByRole('tab', { name: 'AGENTS.md' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 1, name: 'Agent instructions' })).toBeTruthy()
    expect(screen.getByText('Follow the repo rules.')).toBeTruthy()
    // The tab button and the path line both carry the file name.
    expect(screen.getAllByText('AGENTS.md').length).toBe(2)
  })

  it('falls back to the metadata table when nothing is embedded', () => {
    renderPrompts(PROMPTS, [])

    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByText('Review checklist')).toBeTruthy()
    expect(screen.getByText(/prompts\/review\.prompt\.md · 19 B/)).toBeTruthy()
    expect(screen.getByText('2 prompt files · 0 shown')).toBeTruthy()
  })

  it('shows the empty copy when there are no prompt files at all', () => {
    renderPrompts({ files: [], count: 0 }, [])

    expect(screen.getByText('No data yet')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})
