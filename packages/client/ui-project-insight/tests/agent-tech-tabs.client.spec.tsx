// @vitest-environment jsdom
/**
 * The agent-tech second-level tabs: the inventory opens by default as the
 * role-grouped tree whose right pane renders the selected file's embedded
 * content (markdown documents as markdown, other files as grammar-hinted
 * source, pool-excluded files as metadata JSON); each sub-tab carries its
 * collection count; selecting Skills/MCP/Prompts renders the document tree
 * with the selected document's markdown in the right pane; the section opts
 * into the composer overlay so the tab bars stay pinned while content
 * scrolls; and a section with no files or embedded collections shows the
 * empty copy instead of the tab bar.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AgentTechSection, ProjectInsightDoc } from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import { InsightTab, type InsightTabProps } from '../src/client/InsightTab.tsx'
import type { ProjectInsightState } from '../src/client/insight-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** An agent-tech section covering all four sub-tabs: skill and prompt markdown
 * (the inventory's instructions file is prompt-embedded), an mcp config (env
 * redacted), and a settings file whose content the caps excluded (metadata
 * fallback). The workflow yaml's content lives in the shared documents pool. */
const AGENT_TECH: AgentTechSection = {
  files: [
    { path: 'AGENTS.md', kind: 'instructions' },
    { path: '.agents/skills/deploy/SKILL.md', kind: 'agent-config' },
    { path: '.github/workflows/ci.yml', kind: 'tool-config' },
    { path: '.mcp.json', kind: 'tool-config' },
    { path: '.vscode/settings.json', kind: 'tool-config' },
  ],
  tools: [{ name: 'deploy', path: '.agents/skills/deploy/SKILL.md' }],
  count: 5,
  skills: [
    { name: 'deploy', path: '.agents/skills/deploy/SKILL.md', content: '# Deploy\n\nShip the build.' },
  ],
  mcp: [
    {
      name: '.mcp.json', path: '.mcp.json',
      content: '```json\n{\n  "mcpServers": {\n    "github": {\n      "env": { "TOKEN": "<redacted>" }\n    }\n  }\n}\n```',
    },
  ],
  prompts: [
    { name: 'AGENTS.md', path: 'AGENTS.md', content: '# Agents\n\nRepo instructions.' },
    { name: 'fix.prompt.md', path: '.claude/prompts/fix.prompt.md', content: '# Fix\n\nResolve the issue.' },
  ],
}

/** The shared documents pool: the inventory's workflow yaml; the settings
 * file is deliberately absent so its leaf falls back to metadata JSON. */
const DOCUMENTS: ProjectInsightDoc['sections']['documents'] = {
  files: [
    { name: 'ci.yml', path: '.github/workflows/ci.yml', content: 'jobs:\n  build:\n    runs-on: ubuntu-latest\n' },
  ],
  count: 1,
}

/** A committed document whose agent-tech section is the render subject. */
function doc(agentTech: AgentTechSection): ProjectInsightDoc {
  return {
    formatVersion: 5,
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
      documents: DOCUMENTS,
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
  it('opens the inventory tree grouped by file role and swaps the detail on selection', () => {
    renderAgentTech(AGENT_TECH)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Inventory (5)', 'Skills (1)', 'MCP (1)', 'Prompts (2)'])
    expect(screen.getByRole('tab', { name: 'Inventory (5)' }).getAttribute('aria-selected')).toBe('true')
    // The tree groups files by role (tools root last); the first leaf is the
    // default selection and its embedded markdown renders in the right pane.
    expect(screen.getByText('Agent config')).toBeTruthy()
    expect(screen.getByText('Tool config')).toBeTruthy()
    expect(screen.getByText('Tools')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Deploy' })).toBeTruthy()
    expect(screen.getByText('Ship the build.')).toBeTruthy()
    // Selecting a role row expands it so its files become reachable leaves,
    // and selecting a file row swaps the right pane to that file's content.
    fireEvent.click(screen.getByText('Instructions'))
    fireEvent.click(screen.getByText('AGENTS.md'))
    expect(screen.getByRole('heading', { level: 1, name: 'Agents' })).toBeTruthy()
    expect(screen.getByText('Repo instructions.')).toBeTruthy()
  })

  it('renders embedded source with a grammar hint, tools content, and a metadata fallback', () => {
    const { container } = renderAgentTech(AGENT_TECH)

    // The workflow yaml renders through the grammar-hinted code block.
    fireEvent.click(screen.getByText('Tool config'))
    fireEvent.click(screen.getByText('.github/workflows/ci.yml'))
    expect(container.querySelector('.md-code-block')?.textContent).toContain('runs-on')
    expect(container.querySelector('.md-code-block')?.textContent).toContain('yaml')
    // A tool leaf resolves its referenced file's embedded content.
    fireEvent.click(screen.getByText('Tools'))
    fireEvent.click(screen.getByText('deploy'))
    expect(screen.getByText('Ship the build.')).toBeTruthy()
    // A file whose content the document caps excluded shows its metadata JSON.
    fireEvent.click(screen.getByText('Tool config'))
    fireEvent.click(screen.getByText('.vscode/settings.json'))
    expect(container.querySelector('.md-code-block')?.textContent).toContain('"kind": "tool-config"')
  })

  it('opts into the composer overlay so the tab bars stay pinned while content scrolls', () => {
    const { container } = renderAgentTech(AGENT_TECH)

    // The overlay flag makes ConversationRoot bound the view; the section's
    // own scrollers carry the content, so the subtab row never scrolls away.
    expect(container.querySelector('[data-conversation-composer-overlay]')).toBeTruthy()
  })

  it('switches to the skills panel and renders the SKILL.md as markdown', () => {
    renderAgentTech(AGENT_TECH)

    fireEvent.click(screen.getByRole('tab', { name: /Skills/ }))

    expect(screen.getByRole('tab', { name: 'Skills (1)' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 1, name: 'Deploy' })).toBeTruthy()
    expect(screen.getByText('Ship the build.')).toBeTruthy()
    expect(screen.getByText('.agents/skills/deploy/SKILL.md')).toBeTruthy()
    // The inventory tree is gone once the skills panel is active.
    expect(screen.queryByText('Agent config')).toBeNull()
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

    // The default selection is the first document (AGENTS.md); selecting the
    // prompt file swaps the right pane to its markdown.
    expect(screen.getByRole('heading', { level: 1, name: 'Agents' })).toBeTruthy()
    fireEvent.click(screen.getByText('.claude/prompts'))
    fireEvent.click(screen.getByText('fix.prompt.md'))
    expect(screen.getByRole('heading', { level: 1, name: 'Fix' })).toBeTruthy()
    expect(screen.getByText('Resolve the issue.')).toBeTruthy()
  })

  it('shows the empty copy when the section has no files or embedded collections', () => {
    renderAgentTech({ files: [], tools: [], count: 0, skills: [], mcp: [], prompts: [] })

    expect(screen.getByText('No data yet')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})
