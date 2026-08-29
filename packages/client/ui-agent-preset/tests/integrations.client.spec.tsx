// @vitest-environment jsdom
/** Integrations hub tab: inventory cards with search and deep-links. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntegrationsSection } from '../src/client/IntegrationsSection.tsx'
import type { IntegrationsSectionProps } from '../src/client/IntegrationsSection.tsx'
import { hubEn } from '../src/client/hub-locales.ts'
import type { PaletteModule } from '../src/client/section-store.ts'

afterEach(() => { cleanup() })

function translate(key: keyof typeof hubEn, params?: Record<string, unknown>): string {
  const template = hubEn[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const MODULES: readonly PaletteModule[] = [
  {
    moduleName: '@deepseek-ai/dsh-tool-bash',
    displayName: 'Bash',
    category: 'shell',
    description: 'Run shell commands',
  },
  {
    moduleName: '@deepseek-ai/dsh-tool-web',
    displayName: 'Web',
    category: 'network',
    description: 'Search and fetch',
  },
]

function mount(listModules: () => Promise<readonly PaletteModule[]> = async () => MODULES) {
  const actions = {
    listModules: vi.fn(listModules),
    listConnectors: vi.fn(async () => [
      { id: 'docs', name: 'Docs MCP', status: 'mounted', url: 'https://mcp.example.com' },
    ]),
    goPresets: vi.fn(),
    goPlugins: vi.fn(),
    goModels: vi.fn(),
    goConnectors: vi.fn(),
  }
  render(
    <IntegrationsSection
      {...({
        ...actions,
        t: translate,
        close: vi.fn(),
      } as unknown as IntegrationsSectionProps)}
    />,
  )
  return actions
}

describe('IntegrationsSection', () => {
  it('renders inventory cards and navigates on click', async () => {
    const actions = mount()
    await waitFor(() => {
      expect(screen.getByText('Bash')).toBeTruthy()
    })
    expect(screen.getByText('Web')).toBeTruthy()
    expect(document.querySelectorAll('[data-integration-card]')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /Bash/ }))
    expect(actions.goPresets).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Open Models settings' }))
    expect(actions.goModels).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Open Plugins settings' }))
    expect(actions.goPlugins).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Open Connectors' }))
    expect(actions.goConnectors).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(screen.getByText('Docs MCP')).toBeTruthy()
    })
  })

  it('filters cards by search query', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText('Bash')).toBeTruthy()
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Search plugins'), { target: { value: 'web' } })
    })
    expect(screen.queryByText('Bash')).toBeNull()
    expect(screen.getByText('Web')).toBeTruthy()
  })

  it('shows connector cards, empty inventory, and error paths', async () => {
    const goConnectors = vi.fn()
    render(
      <IntegrationsSection
        {...({
          listModules: vi.fn()
            .mockRejectedValueOnce(new Error('inventory failed'))
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              { moduleName: '@deepseek-ai/dsh-tool-fs', displayName: '', description: '' },
            ]),
          listConnectors: vi.fn()
            .mockRejectedValueOnce('connectors failed')
            .mockResolvedValueOnce([
              { id: 'stdio', name: 'Stdio MCP', status: 'disabled', command: 'npx mcp' },
              { id: 'bare', name: 'Bare', status: 'error' },
            ]),
          goPresets: vi.fn(),
          goPlugins: vi.fn(),
          goModels: vi.fn(),
          goConnectors,
          t: translate,
          close: vi.fn(),
        } as unknown as IntegrationsSectionProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/inventory failed/)
    })
    expect(screen.getByText(hubEn['integrations.connectorsEmpty'])).toBeTruthy()
  })

  it('opens a connector card and shows unnamed plugin fallbacks', async () => {
    const goConnectors = vi.fn()
    const goPresets = vi.fn()
    render(
      <IntegrationsSection
        {...({
          listModules: vi.fn(async () => [
            { moduleName: '@deepseek-ai/dsh-tool-fs', displayName: '' },
          ]),
          listConnectors: vi.fn(async () => [
            { id: 'stdio', name: 'Stdio MCP', status: 'disabled', command: 'npx mcp' },
            { id: 'bare', name: 'Bare', status: 'error' },
          ]),
          goPresets,
          goPlugins: vi.fn(),
          goModels: vi.fn(),
          goConnectors,
          t: translate,
          close: vi.fn(),
        } as unknown as IntegrationsSectionProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('Stdio MCP')).toBeTruthy()
      expect(screen.getByText('Bare')).toBeTruthy()
      expect(screen.getAllByText('@deepseek-ai/dsh-tool-fs').length).toBeGreaterThan(0)
    })
    fireEvent.click(screen.getByRole('button', { name: /Stdio MCP/ }))
    expect(goConnectors).toHaveBeenCalledOnce()
    fireEvent.click(document.querySelector('[data-integration-card]')!)
    expect(goPresets).toHaveBeenCalledOnce()
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Search plugins'), { target: { value: 'zzzz' } })
    })
    expect(screen.getByText(hubEn['integrations.noMatch'])).toBeTruthy()
  })

  it('shows empty inventory copy and a non-Error loader failure', async () => {
    render(
      <IntegrationsSection
        {...({
          listModules: vi.fn(async () => {
            throw 'inventory boom'
          }),
          listConnectors: vi.fn(async () => []),
          goPresets: vi.fn(),
          goPlugins: vi.fn(),
          goModels: vi.fn(),
          goConnectors: vi.fn(),
          t: translate,
          close: vi.fn(),
        } as unknown as IntegrationsSectionProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/inventory boom/)
    })
  })

  it('shows empty plugin copy when inventory is ready and vacant', async () => {
    render(
      <IntegrationsSection
        {...({
          listModules: vi.fn(async () => []),
          listConnectors: vi.fn(async () => []),
          goPresets: vi.fn(),
          goPlugins: vi.fn(),
          goModels: vi.fn(),
          goConnectors: vi.fn(),
          t: translate,
          close: vi.fn(),
        } as unknown as IntegrationsSectionProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(hubEn['integrations.empty'])).toBeTruthy()
    })
  })

  it('ignores late inventory results after unmount', async () => {
    let resolveModules!: (value: readonly PaletteModule[]) => void
    let rejectConnectors!: (reason?: unknown) => void
    const modules = new Promise<readonly PaletteModule[]>((resolve) => {
      resolveModules = resolve
    })
    const connectors = new Promise<never>((_resolve, reject) => {
      rejectConnectors = reject
    })
    const { unmount } = render(
      <IntegrationsSection
        {...({
          listModules: vi.fn(() => modules),
          listConnectors: vi.fn(() => connectors),
          goPresets: vi.fn(),
          goPlugins: vi.fn(),
          goModels: vi.fn(),
          goConnectors: vi.fn(),
          t: translate,
          close: vi.fn(),
        } as unknown as IntegrationsSectionProps)}
      />,
    )
    unmount()
    await act(async () => {
      resolveModules(MODULES)
      rejectConnectors('late')
    })
  })

  it('ignores a late inventory failure after unmount', async () => {
    let rejectModules!: (reason?: unknown) => void
    let resolveConnectors!: (value: readonly { id: string; name: string; status: string }[]) => void
    const modules = new Promise<readonly PaletteModule[]>((_resolve, reject) => {
      rejectModules = reject
    })
    const connectors = new Promise<readonly { id: string; name: string; status: string }[]>((resolve) => {
      resolveConnectors = resolve
    })
    const { unmount } = render(
      <IntegrationsSection
        {...({
          listModules: vi.fn(() => modules),
          listConnectors: vi.fn(() => connectors),
          goPresets: vi.fn(),
          goPlugins: vi.fn(),
          goModels: vi.fn(),
          goConnectors: vi.fn(),
          t: translate,
          close: vi.fn(),
        } as unknown as IntegrationsSectionProps)}
      />,
    )
    unmount()
    await act(async () => {
      rejectModules('late inventory')
      resolveConnectors([])
    })
  })
})
