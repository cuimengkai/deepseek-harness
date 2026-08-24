// @vitest-environment jsdom
/**
 * The agent-tech second-level tabs: the inventory opens by default; each
 * sub-tab carries its collection count; selecting Skills/MCP/Prompts renders
 * the embedded documents through MarkdownText; and a section with no files or
 * embedded collections shows the empty copy instead of the tab bar.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTechSection, ProjectInsightDoc } from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import { InsightTab, type InsightTabProps } from '../src/client/InsightTab.tsx'
import type { ProjectInsightState } from '../src/client/insight-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** An agent-tech section covering all four sub-tabs: a tool-config mcp file
 * (env redacted), one skill, one prompt, and the inventory rows they came from. */
const AGENT_TECH: AgentTechSection = {
  files: [
    { path: 'AGENTS.md', kind: 'instructions' },
    { path: '.mcp.json', kind: 'tool-config' },
    { path: '.agents/skills/deploy/SKILL.md', kind: 'agent-config' },
  ],
  tools: [{ name: 'deploy', path: '.agents/skills/deploy/SKILL.md' }],
  count: 3,
  skills: [
    { name: 'deploy', path: '.agents/skills/deploy/SKILL.md', markdown: '# Deploy\n\nShip the build.' },
  ],
  mcp: [
    {
      name: '.mcp.json', path: '.mcp.json',
      markdown: '```json\n{\n  "mcpServers": {\n    "github": {\n      "env": { "TOKEN": "<redacted>" }\n    }\n  }\n}\n```',
    },
  ],
  prompts: [
    { name: 'fix.prompt.md', path: '.claude/prompts/fix.prompt.md', markdown: '# Fix\n\nResolve the issue.' },
  ],
}

/** A committed document whose agent-tech section is the render subject. */
function doc(agentTech: AgentTechSection): ProjectInsightDoc {
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
      prompts: { files: [], count: 0 },
      agentTech,
    },
  }
}

function renderAgentTech(agentTech: AgentTechSection) {
  const store = createSnapshotStore<ProjectInsightState>({ status: 'ready', error: null, doc: doc(agentTech) })
  return render(<InsightTab {...({
    useProjectInsight: bindSnapshotSelector(store),
    load: vi.fn(),
    dispose: vi.fn(),
    variant: 'agentTech',
    t: (key: keyof typeof en) => en[key],
  } as unknown as InsightTabProps)} />)
}

describe('agent-tech sub-tabs', () => {
  it('opens the inventory and shows every sub-tab with its count', () => {
    renderAgentTech(AGENT_TECH)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Inventory (3)', 'Skills (1)', 'MCP (1)', 'Prompts (1)'])
    expect(screen.getByRole('tab', { name: 'Inventory (3)' }).getAttribute('aria-selected')).toBe('true')
    // The inventory table is the visible panel: every file and its kind.
    expect(screen.getByText('AGENTS.md')).toBeTruthy()
    expect(screen.getByText('AGENTS.md').closest('div')?.textContent).toContain('instructions')
  })

  it('switches to the skills panel and renders the SKILL.md as markdown', () => {
    renderAgentTech(AGENT_TECH)

    fireEvent.click(screen.getByRole('tab', { name: /Skills/ }))

    expect(screen.getByRole('tab', { name: 'Skills (1)' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 1, name: 'Deploy' })).toBeTruthy()
    expect(screen.getByText('Ship the build.')).toBeTruthy()
    expect(screen.getByText('.agents/skills/deploy/SKILL.md')).toBeTruthy()
    // The inventory rows are gone once the skills panel is active.
    expect(screen.queryByText('instructions')).toBeNull()
  })

  it('switches to the mcp panel and renders the redacted JSON config', () => {
    renderAgentTech(AGENT_TECH)

    fireEvent.click(screen.getByRole('tab', { name: /MCP/ }))

    const code = screen.getByText(/mcpServers/).closest('pre')
    expect(code?.textContent).toContain('github')
    expect(code?.textContent).toContain('<redacted>')
    expect(code?.textContent).not.toContain('secret-value')
  })

  it('switches to the prompts panel and renders the prompt markdown', () => {
    renderAgentTech(AGENT_TECH)

    fireEvent.click(screen.getByRole('tab', { name: /Prompts/ }))

    expect(screen.getByRole('heading', { level: 1, name: 'Fix' })).toBeTruthy()
    expect(screen.getByText('Resolve the issue.')).toBeTruthy()
  })

  it('shows the empty copy when the section has no files or embedded collections', () => {
    renderAgentTech({ files: [], tools: [], count: 0, skills: [], mcp: [], prompts: [] })

    expect(screen.getByText('No data yet')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})
