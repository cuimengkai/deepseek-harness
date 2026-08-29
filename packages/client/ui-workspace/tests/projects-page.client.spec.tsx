// @vitest-environment jsdom
/** Projects page: workspace list with start/open session actions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en } from '@deepseek-ai/dsh-client-ui-sidebar/src/client/locales.ts'
import { ProjectsPage } from '../src/client/ProjectsPage.tsx'
import type { ProjectsPageProps } from '../src/client/ProjectsPage.tsx'

afterEach(() => { cleanup() })

const t = makeTranslate(en) as ProjectsPageProps['t']

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, ...overrides,
})

const workspace = (id: string, sessionIds: string[], title = id): WorkspaceView => ({
  workspaceId: wid(id),
  path: `/projects/${id}`,
  title,
  sessionIds: sessionIds.map(sid),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot => ({
  items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
})

const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
})

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function mount(overrides: Partial<ProjectsPageProps> = {}) {
  const actions = {
    goAssistant: vi.fn(),
    goAgentSettings: vi.fn(),
    startSession: vi.fn(),
    openSession: vi.fn(),
    listBundles: vi.fn(async () => []),
    createBundle: vi.fn(async () => ({ id: 'p1', name: 'n', instructions: '', sharedRoot: '/tmp', connectorIds: [] })),
    startBundle: vi.fn(async () => {}),
    removeBundle: vi.fn(async () => {}),
    useWorkspaces: hook(workspaceState([
      workspace('alpha', ['alpha-s', 'alpha-old'], 'Alpha project'),
      workspace('beta', [], 'Beta empty'),
    ])),
    useSessions: hook(sessionState([
      summary('alpha-s', 100, { displayTitle: 'Alpha task', blank: false }),
      summary('alpha-old', 10, { displayTitle: 'Older alpha', blank: false }),
    ])),
    useSessionPendingInteraction: hook(new Map()),
    t,
    ...overrides,
  }
  render(<ProjectsPage {...actions} />)
  return actions
}

describe('ProjectsPage', () => {
  it('lists workspaces and starts or opens sessions', () => {
    const actions = mount()
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy()
    expect(screen.getByText('Alpha project')).toBeTruthy()
    expect(screen.getByText('Beta empty')).toBeTruthy()
    expect(screen.getByText('Latest: Alpha task')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Start task' })[0]!)
    expect(actions.startSession).toHaveBeenCalledWith(wid('alpha'))

    fireEvent.click(screen.getByRole('button', { name: 'Open latest task' }))
    expect(actions.openSession).toHaveBeenCalledWith(sid('alpha-s'))

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent settings' }))
    expect(actions.goAgentSettings).toHaveBeenCalledOnce()
  })

  it('shows empty copy when no workspaces exist', () => {
    mount({
      useWorkspaces: hook(workspaceState([])),
      useSessions: hook(sessionState([])),
    })
    expect(screen.getByText(/No workspaces yet/)).toBeTruthy()
  })

  it('creates, starts, and removes a project bundle', async () => {
    const bundle = {
      id: 'p1', name: 'Alpha bundle', instructions: 'be careful', sharedRoot: '/projects/alpha', connectorIds: [],
    }
    const actions = mount({
      listBundles: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([bundle])
        .mockResolvedValueOnce([]),
      createBundle: vi.fn(async () => bundle),
    })
    await waitFor(() => {
      expect(screen.getByText(/No project bundles yet/)).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Back to Assistant' }))
    expect(actions.goAssistant).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alpha bundle' } })
    fireEvent.change(screen.getByLabelText('Workspace directory (sharedRoot)'), { target: { value: '/tmp/root' } })
    fireEvent.change(screen.getByLabelText('Global instructions'), { target: { value: 'be careful' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => {
      expect(actions.createBundle).toHaveBeenCalledWith({
        name: 'Alpha bundle', sharedRoot: '/tmp/root', instructions: 'be careful',
      })
      expect(screen.getByText('Alpha bundle')).toBeTruthy()
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Start task' })[0]!)
    expect(actions.startBundle).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(actions.removeBundle).toHaveBeenCalledWith('p1')
      expect(screen.getByText(/No project bundles yet/)).toBeTruthy()
    })
  })

  it('shows bundle-load and create failures, and a loading workspace phase', async () => {
    mount({
      useWorkspaces: hook({
        ...workspaceState([]),
        phase: 'loading',
      } as unknown as WorkspaceSnapshot),
      useSessions: hook(sessionState([])),
      listBundles: vi.fn()
        .mockRejectedValueOnce(new Error('bundles failed'))
        .mockResolvedValueOnce([]),
      createBundle: vi.fn()
        .mockRejectedValueOnce(new Error('create boom'))
        .mockRejectedValueOnce('create boom'),
    })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('bundles failed')
    })
    expect(screen.getByText('Loading workspaces…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('create boom')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('create boom')
    })
  })

  it('stringifies a non-Error bundle list failure', async () => {
    mount({
      listBundles: vi.fn(async () => {
        throw 'bundles boom'
      }),
    })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('bundles boom')
    })
  })
})
