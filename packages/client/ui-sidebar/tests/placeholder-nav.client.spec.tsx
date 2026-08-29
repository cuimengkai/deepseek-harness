// @vitest-environment jsdom
/** Sidebar primary-nav path helpers and operable destination pages. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { activeNav } from '../src/client/SidebarNav.tsx'
import { AutomationPage } from '../src/client/AutomationPage.tsx'
import type { AutomationPageProps } from '../src/client/AutomationPage.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

function translate(key: keyof typeof en, params?: Record<string, unknown>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

describe('activeNav', () => {
  it('highlights WorkBuddy destinations from the pathname', () => {
    expect(activeNav('/')).toBe('assistant')
    expect(activeNav('/projects')).toBe('projects')
    expect(activeNav('/automation')).toBe('automation')
    expect(activeNav('/connectors')).toBe('connectors')
    expect(activeNav('/settings/agent')).toBe('expert')
    expect(activeNav('/settings/agent?tab=modes')).toBe('expert')
  })
})

describe('AutomationPage', () => {
  it('links to orchestration try-run and lists recent jobs', () => {
    const goOrchestration = vi.fn()
    const goAssistant = vi.fn()
    render(<AutomationPage {...({
      goAssistant,
      goAgentSettings: vi.fn(),
      goOrchestration,
      listRules: async () => [],
      createRule: async () => ({ id: 'r1', name: 'n', prompt: 'p', enabled: true, kind: 'interval' }),
      setRuleEnabled: async () => ({ id: 'r1', name: 'n', prompt: 'p', enabled: true, kind: 'interval' }),
      removeRule: async () => {},
      useSessions: hook({
        ids: ['s1'],
        byId: { s1: { id: 's1', displayTitle: 'Main', running: false, blank: false, updatedAt: 1 } },
        current: 's1',
        phase: 'ready',
        subagentsByParent: {},
        jobsBySession: {
          s1: [{
            id: 'j1',
            kind: 'tool',
            label: 'Long bash',
            status: 'completed' as const,
            startedAt: 1,
            finishedAt: 2,
          }],
        },
        currentAddress: undefined,
      }),
      useWorkspaces: hook({
        items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      }),
      useSessionPendingInteraction: hook(new Map()),
      t: translate,
    } as unknown as AutomationPageProps)}
    />)
    expect(screen.getByRole('heading', { name: 'Automation' })).toBeTruthy()
    expect(screen.getByText('Long bash')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open orchestration try-run' }))
    expect(goOrchestration).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Assistant' }))
    expect(goAssistant).toHaveBeenCalledOnce()
  })

  it('creates, toggles, and removes a schedule rule', async () => {
    const goAgentSettings = vi.fn()
    const createRule = vi.fn(async () => ({
      id: 'r1', name: 'Hourly', prompt: 'ping', enabled: true, kind: 'interval', lastError: 'queue failed',
    }))
    const setRuleEnabled = vi.fn(async () => ({
      id: 'r1', name: 'Hourly', prompt: 'ping', enabled: false, kind: 'interval',
    }))
    const removeRule = vi.fn(async () => {})
    const listRules = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'r1', name: 'Hourly', prompt: 'ping', enabled: true, kind: 'interval', lastError: 'queue failed',
      }])
      .mockResolvedValueOnce([{
        id: 'r1', name: 'Hourly', prompt: 'ping', enabled: false, kind: 'interval',
      }])
      .mockResolvedValueOnce([])
    render(<AutomationPage {...({
      goAssistant: vi.fn(),
      goAgentSettings,
      goOrchestration: vi.fn(),
      listRules,
      createRule,
      setRuleEnabled,
      removeRule,
      useSessions: hook({
        ids: [],
        byId: {},
        current: undefined,
        phase: 'ready',
        subagentsByParent: {},
        jobsBySession: {
          orphan: [{
            id: 'j2',
            kind: 'tool',
            label: 'Orphan job',
            status: 'running' as const,
            startedAt: 9,
            detail: 'still going',
          }, {
            id: 'j3',
            kind: 'tool',
            label: 'Earlier orphan',
            status: 'running' as const,
            startedAt: 3,
          }],
          s1: [{
            id: 'j1',
            kind: 'tool',
            label: 'Older job',
            status: 'completed' as const,
            startedAt: 1,
            finishedAt: 2,
          }],
        },
        currentAddress: undefined,
      }),
      useWorkspaces: hook({
        items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      }),
      useSessionPendingInteraction: hook(new Map()),
      t: translate,
    } as unknown as AutomationPageProps)}
    />)
    await waitFor(() => {
      expect(screen.getByText('No schedule rules yet.')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent settings' }))
    expect(goAgentSettings).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hourly' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'ping' } })
    fireEvent.change(screen.getByLabelText('Interval (ms)'), { target: { value: '60000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    await waitFor(() => {
      expect(createRule).toHaveBeenCalledWith({
        name: 'Hourly', prompt: 'ping', kind: 'interval', intervalMs: 60_000,
      })
      expect(screen.getByText('Hourly')).toBeTruthy()
      expect(screen.getByText('queue failed')).toBeTruthy()
    })
    expect(screen.getByText('Orphan job')).toBeTruthy()
    expect(screen.getByText('still going')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => {
      expect(setRuleEnabled).toHaveBeenCalledWith('r1', false)
      expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(removeRule).toHaveBeenCalledWith('r1')
      expect(screen.getByText('No schedule rules yet.')).toBeTruthy()
    })
  })

  it('shows rule-load and create failures, and empty jobs copy', async () => {
    const createRule = vi.fn()
      .mockRejectedValueOnce(new Error('create boom'))
      .mockRejectedValueOnce('create boom')
    render(<AutomationPage {...({
      goAssistant: vi.fn(),
      goAgentSettings: vi.fn(),
      goOrchestration: vi.fn(),
      listRules: vi.fn()
        .mockRejectedValueOnce(new Error('rules failed'))
        .mockResolvedValueOnce([]),
      createRule,
      setRuleEnabled: vi.fn(),
      removeRule: vi.fn(),
      useSessions: hook({
        ids: [],
        byId: {},
        current: undefined,
        phase: 'ready',
        subagentsByParent: {},
        jobsBySession: {},
        currentAddress: undefined,
      }),
      useWorkspaces: hook({
        items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      }),
      useSessionPendingInteraction: hook(new Map()),
      t: translate,
    } as unknown as AutomationPageProps)}
    />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('rules failed')
    })
    expect(screen.getByText(/No background jobs yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('create boom')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    await waitFor(() => {
      expect(createRule).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('alert').textContent).toBe('create boom')
    })
  })

  it('stringifies a non-Error rule list failure', async () => {
    render(<AutomationPage {...({
      goAssistant: vi.fn(),
      goAgentSettings: vi.fn(),
      goOrchestration: vi.fn(),
      listRules: vi.fn(async () => {
        throw 'rules boom'
      }),
      createRule: vi.fn(),
      setRuleEnabled: vi.fn(),
      removeRule: vi.fn(),
      useSessions: hook({
        ids: [],
        byId: {},
        current: undefined,
        phase: 'ready',
        subagentsByParent: {},
        jobsBySession: {},
        currentAddress: undefined,
      }),
      useWorkspaces: hook({
        items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      }),
      useSessionPendingInteraction: hook(new Map()),
      t: translate,
    } as unknown as AutomationPageProps)}
    />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('rules boom')
    })
  })
})
