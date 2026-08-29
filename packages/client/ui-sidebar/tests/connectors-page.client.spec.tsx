// @vitest-environment jsdom
/** Connectors page: add-by-URL, enable/disable, remove, and error copy. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConnectorsPage } from '../src/client/ConnectorsPage.tsx'
import type { ConnectorCard, ConnectorsPageProps } from '../src/client/ConnectorsPage.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

function translate(key: keyof typeof en, params?: Record<string, unknown>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const httpCard: ConnectorCard = {
  id: 'docs',
  name: 'Docs MCP',
  enabled: true,
  transport: 'http',
  url: 'https://mcp.example.com',
  status: 'mounted',
}

function mount(overrides: Partial<ConnectorsPageProps> = {}) {
  const actions = {
    list: vi.fn(async () => [] as readonly ConnectorCard[]),
    addHttp: vi.fn(async () => httpCard),
    setEnabled: vi.fn(async () => ({ ...httpCard, enabled: false })),
    remove: vi.fn(async () => {}),
    goAssistant: vi.fn(),
    t: translate,
    ...overrides,
  }
  render(<ConnectorsPage {...(actions as unknown as ConnectorsPageProps)} />)
  return actions
}

describe('ConnectorsPage', () => {
  it('lists empty copy and returns to Assistant', async () => {
    const actions = mount()
    await waitFor(() => {
      expect(screen.getByText('No connectors yet.')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Back to Assistant' }))
    expect(actions.goAssistant).toHaveBeenCalledOnce()
  })

  it('adds a URL connector and reloads the card', async () => {
    const actions = mount({
      list: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([httpCard]),
    })
    await waitFor(() => {
      expect(screen.getByText('No connectors yet.')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Docs MCP' } })
    fireEvent.change(screen.getByLabelText('MCP URL'), { target: { value: 'https://mcp.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }))
    await waitFor(() => {
      expect(actions.addHttp).toHaveBeenCalledWith({
        name: 'Docs MCP',
        url: 'https://mcp.example.com',
      })
      expect(screen.getByText('Docs MCP')).toBeTruthy()
    })
  })

  it('enables, disables, and removes a listed card', async () => {
    const disabled = { ...httpCard, enabled: false, status: 'disabled' }
    const actions = mount({
      list: vi.fn()
        .mockResolvedValueOnce([httpCard])
        .mockResolvedValueOnce([disabled])
        .mockResolvedValueOnce([]),
    })
    await waitFor(() => {
      expect(screen.getByText('Docs MCP')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => {
      expect(actions.setEnabled).toHaveBeenCalledWith('docs', false)
      expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(actions.remove).toHaveBeenCalledWith('docs')
      expect(screen.getByText('No connectors yet.')).toBeTruthy()
    })
  })

  it('shows a list-load failure', async () => {
    mount({ list: vi.fn(async () => { throw new Error('list failed') }) })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('list failed')
    })
  })

  it('stringifies a non-Error list failure', async () => {
    mount({ list: vi.fn(async () => { throw 'list boom' }) })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('list boom')
    })
  })

  it('shows add, enable, and remove failures on a listed card', async () => {
    const stdio: ConnectorCard = {
      id: 'stdio',
      name: 'Local',
      enabled: false,
      transport: 'stdio',
      command: 'npx mcp',
      status: 'disabled',
      error: 'spawn failed',
    }
    mount({
      list: vi.fn(async () => [stdio]),
      addHttp: vi.fn(async () => {
        throw new Error('add boom')
      }),
      setEnabled: vi.fn(async () => {
        throw 'toggle failed'
      }),
      remove: vi.fn(async () => {
        throw new Error('remove boom')
      }),
    })
    await waitFor(() => {
      expect(screen.getByText('Local')).toBeTruthy()
      expect(screen.getByText('spawn failed')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('add boom')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('toggle failed')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('remove boom')
    })
  })

  it('stringifies add/remove failures and surfaces an Error toggle', async () => {
    mount({
      list: vi.fn(async () => [httpCard]),
      addHttp: vi.fn(async () => {
        throw 'add boom'
      }),
      setEnabled: vi.fn(async () => {
        throw new Error('toggle failed')
      }),
      remove: vi.fn(async () => {
        throw 'remove boom'
      }),
    })
    await waitFor(() => {
      expect(screen.getByText('Docs MCP')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('add boom')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('toggle failed')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('remove boom')
    })
  })

  it('falls back to transport when a card has no url or command', async () => {
    mount({
      list: vi.fn(async () => [{
        id: 'plain',
        name: 'Plain',
        enabled: true,
        transport: 'http',
        status: 'error',
      }]),
    })
    await waitFor(() => {
      expect(screen.getByText('error · http')).toBeTruthy()
    })
  })
})
