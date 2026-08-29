// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabProps } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginInventoryClientStore, type PluginInventoryWire } from '../src/client/store.ts'
import type {
  PluginInventorySnapshot,
  PluginManagerCatalogSnapshot,
  PluginManagerInstallResult,
  PluginManagerInstallValue,
  PluginManagerUninstallResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = PluginInventorySnapshot
type Available = PluginManagerCatalogSnapshot
type InstallResult = PluginManagerInstallResult
/** The component's translate, including `{name}` interpolation like the real locale runtime. */
const t = ((key: PluginInventoryLocaleKey, params?: Record<string, unknown>): string => {
  let text: string = en[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}) as PluginInventorySettingsTabProps['t']

/** Props the Settings surface injects but the tab ignores, present only to
 * satisfy `GlobalStandardProps` when the tab is rendered directly. */
const kit = {
  useSessions: (() => { throw new Error('unused') }) as never,
  useWorkspaces: (() => { throw new Error('unused') }) as never,
  useSessionPendingInteraction: (() => { throw new Error('unused') }) as never,
}

/** A committed install value for the given catalog name. */
function okInstall(name: string): PluginManagerInstallResult {
  return {
    ok: true,
    value: {
      entryId: `dsh-managed-${name}` as unknown as PluginManagerInstallValue['entryId'],
      moduleName: name,
      phase: 'loading',
    },
  }
}

interface WireMocks {
  list: ReturnType<typeof vi.fn>
  listAvailable: ReturnType<typeof vi.fn>
  refreshCatalog: ReturnType<typeof vi.fn>
  installPlugin: ReturnType<typeof vi.fn>
  uninstallPlugin: ReturnType<typeof vi.fn>
}

/** A controller over a mock wire; every read resolves immediately unless overridden. */
function makeWire(overrides: Partial<PluginInventoryWire> = {}): {
  controller: PluginInventoryClientStore
  mocks: WireMocks
} {
  const list = vi.fn<() => Promise<Snapshot>>(async () => ({ entries: [] }))
  const listAvailable = vi.fn<() => Promise<Available>>(async () => CATALOG)
  const refreshCatalog = vi.fn<() => Promise<Available>>(async () => CATALOG)
  const installPlugin = vi.fn(async (request: { readonly name: string }) => okInstall(request.name))
  const uninstallPlugin = vi.fn(async () => ({ ok: true, value: { absent: true } }))
  const wire = { list, listAvailable, refreshCatalog, installPlugin, uninstallPlugin, ...overrides } as PluginInventoryWire
  return {
    controller: new PluginInventoryClientStore(wire),
    // Reflect the overrides the wire actually uses, so mocks assertions follow the real calls.
    mocks: {
      list: wire.list,
      listAvailable: wire.listAvailable,
      refreshCatalog: wire.refreshCatalog,
      installPlugin: wire.installPlugin,
      uninstallPlugin: wire.uninstallPlugin,
    } as unknown as WireMocks,
  }
}

/** Flush the controller's async read chain (wire promise → face update) and the
 * React re-renders it schedules: several microtask turns plus one macrotask. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  })
}

/** Render the tab over a mock wire and flush its initial reads. */
async function renderReady(wire: Partial<PluginInventoryWire> = {}): Promise<{
  view: ReturnType<typeof render>
  controller: PluginInventoryClientStore
  mocks: WireMocks
}> {
  const { controller, mocks } = makeWire(wire)
  const view = render(<PluginInventorySettingsTab {...kit} controller={controller} t={t} />)
  await settle()
  return { view, controller, mocks }
}

/** A catalog read that never settles: inventory-only tests keep it loading. */
const neverDeferred = Promise.withResolvers<Available>()
const neverCatalog: PluginInventoryWire['listAvailable'] = () => neverDeferred.promise

const SNAPSHOT = {
  entries: [
    { entryId: '8a1b2c3d', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, fiberPhase: 'active' },
    { entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending' },
    { entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading' },
    { entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed' },
    { entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null },
    { entryId: 'disabled-entry', moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, fiberPhase: null },
  ],
} as unknown as Snapshot

const CAPABILITIES = {
  networkConfirmation: true,
  allowInstallScripts: true,
  installSandbox: 'confined',
} as const

const CATALOG = {
  entries: [
    { name: '@fixture/ping', description: 'Ping the fixture', source: 'catalog', installKind: 'static', installable: true, installed: false },
    { name: '@deepseek-ai/dsh-compaction', source: 'catalog', installKind: 'static', installable: true, installed: true },
  ],
  sources: [{ id: 'catalog', kind: 'static', state: 'ok', entryCount: 2 }],
  capabilities: CAPABILITIES,
} as unknown as Available

/** The "nothing available" view: empty rows over the default capability set. */
const EMPTY_CATALOG = { entries: [], sources: [], capabilities: CAPABILITIES } as unknown as Available

/** One installable network entry from a topic source, with the trust surface. */
function netCatalog(overrides: Partial<Available> = {}): Available {
  return {
    entries: [
      {
        name: 'user/repo',
        description: 'A network plugin',
        source: 'topic',
        installKind: 'network',
        installRef: 'user/repo#main',
        url: 'https://github.com/user/repo',
        installable: true,
        installed: false,
      },
    ],
    sources: [{ id: 'topic', kind: 'topic', state: 'ok', entryCount: 1 }],
    capabilities: CAPABILITIES,
    ...overrides,
  } as unknown as Available
}

describe('PluginInventorySettingsTab', () => {
  it('renders runtime status only for enabled plugins', async () => {
    await renderReady({ list: async () => SNAPSHOT, listAvailable: neverCatalog })
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getAllByText(en.installedTag)).toHaveLength(6)
    expect(screen.getByText(en.notInstalled)).toBeTruthy()
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getByRole('img', { name: value })).toBeTruthy()
    }
    const active = screen.getByRole('button', { name: 'hmr, Mounted, Installed' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(en.status)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'directory-picker-native, Not installed' }))
    expect(screen.getAllByText(en.notInstalled)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.queryByText(en.unobserved)).toBeNull()
  })

  it('filters by module name or Loader entry id', async () => {
    await renderReady({
      list: async () => SNAPSHOT,
      listAvailable: async () => EMPTY_CATALOG,
    })
    const search = screen.getByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<() => Promise<Snapshot>>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    const availableDeferred = Promise.withResolvers<Available>()
    await renderReady({
      list,
      listAvailable: () => availableDeferred.promise,
    })

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    await act(async () => { availableDeferred.resolve(EMPTY_CATALOG) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    await renderReady({
      list: vi.fn(() => { throw new Error('namespace unavailable') }),
      listAvailable: neverCatalog,
    })
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)

    const pending = Promise.withResolvers<Snapshot>()
    const { controller } = makeWire({ list: () => pending.promise, listAvailable: neverCatalog })
    const view = render(<PluginInventorySettingsTab {...kit} controller={controller} t={t} />)
    view.unmount()
    await act(async () => { pending.resolve(SNAPSHOT) })

    const failing = Promise.withResolvers<Snapshot>()
    const { controller: failingController } = makeWire({ list: () => failing.promise, listAvailable: neverCatalog })
    const failingView = render(
      <PluginInventorySettingsTab {...kit} controller={failingController} t={t} />,
    )
    failingView.unmount()
    await act(async () => { failing.reject(new Error('late failure')) })
  })
})

describe('merged plugin list', () => {
  it('lists installed rows first and folds managed entries into their catalog card', async () => {
    const inventory = {
      entries: [
        { entryId: '8a1b2c3d', moduleName: '@deepseek-ai/dsh-host-session', enabled: true, fiberPhase: 'active' },
        // Real installs surface under the root Include with an `include:`
        // getter prefix; the fold matches the bare `dsh-managed-` ownership id.
        { entryId: 'include:dsh-managed-@fixture/ping', moduleName: '@fixture/ping', enabled: true, fiberPhase: 'loading' },
      ],
    } as unknown as Snapshot
    const catalog = {
      entries: [
        { name: '@fixture/ping', source: 'catalog', installKind: 'static', installable: true, installed: true },
        { name: '@fixture/plain', source: 'catalog', installKind: 'static', installable: true, installed: false },
      ],
      sources: [],
      capabilities: CAPABILITIES,
    } as unknown as Available
    const { view } = await renderReady({ list: async () => inventory, listAvailable: async () => catalog })
    // no source strip (sources empty), so the only list is the merged rows
    const items = within(view.container.querySelector('ul')!).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]!.getAttribute('data-plugin-entry')).toBe('8a1b2c3d')
    expect(items[1]!.getAttribute('data-catalog-entry')).toBe('@fixture/ping')
    expect(within(items[1]!).getByText(en.installedTag)).toBeTruthy()
    expect(within(items[1]!).getByRole('button', { name: en.uninstall })).toBeTruthy()
    expect(items[2]!.getAttribute('data-catalog-entry')).toBe('@fixture/plain')
    expect(view.container.querySelector('[data-plugin-entry^="dsh-managed-"]')).toBeNull()
  })

  it('filters both row kinds with one query', async () => {
    const { view } = await renderReady({ list: async () => SNAPSHOT, listAvailable: async () => CATALOG })
    const search = screen.getByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'ping' } })
    expect(view.container.querySelectorAll('[data-catalog-entry]')).toHaveLength(1)
    expect(view.container.querySelectorAll('[data-plugin-entry]')).toHaveLength(0)

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(view.container.querySelectorAll('[data-catalog-entry]')).toHaveLength(0)
    expect(view.container.querySelectorAll('[data-plugin-entry]')).toHaveLength(1)

    fireEvent.change(search, { target: { value: 'fixture' } })
    expect(view.container.querySelectorAll('[data-catalog-entry]')).toHaveLength(1)
    expect(view.container.querySelectorAll('[data-plugin-entry]')).toHaveLength(4)
  })

  it('keeps the Loader rows when the catalog read fails', async () => {
    const failingCatalog = vi.fn(() => Promise.reject(new Error('network down'))) as PluginInventoryWire['listAvailable']
    await renderReady({ list: async () => SNAPSHOT, listAvailable: failingCatalog })
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorInstallable)
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.queryByText(en.error)).toBeNull()
  })

  it('groups rows by category under heads with counts', async () => {
    const inventory = {
      entries: [
        { entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: null, category: 'core', description: 'Host tool registry' },
        { entryId: 'bash', moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true, fiberPhase: null, category: 'tool' },
        { entryId: 'plain', moduleName: '@fixture/plain', enabled: true, fiberPhase: null },
      ],
    } as unknown as Snapshot
    await renderReady({ list: async () => inventory, listAvailable: async () => EMPTY_CATALOG })
    expect(screen.getByRole('heading', { name: /core/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /tool/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Uncategorized/ })).toBeTruthy()
    expect(within(screen.getByRole('heading', { name: /core/ })).getByText('1')).toBeTruthy()
  })

  it('filters rows by category through the toolbar menu', async () => {
    const inventory = {
      entries: [
        { entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: null, category: 'core' },
        { entryId: 'bash', moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true, fiberPhase: null, category: 'tool' },
      ],
    } as unknown as Snapshot
    await renderReady({ list: async () => inventory, listAvailable: async () => EMPTY_CATALOG })
    fireEvent.click(screen.getByRole('button', { name: en.allCategories }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'core (1)' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('tools')).toBeTruthy()
    expect(screen.queryByText('bash')).toBeNull()
    expect(screen.getByRole('button', { name: 'core' })).toBeTruthy()
  })
})

describe('installable catalog', () => {
  it('lists installable entries with install and uninstall actions', async () => {
    await renderReady()
    // two market cards plus one per-source status line
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: en.install })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.uninstall })).toBeTruthy()
    expect(screen.getByText('compaction')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ping, Not installed' }))
    expect(screen.getByText('Ping the fixture')).toBeTruthy()
  })

  it('installs an entry and refreshes both faces on success', async () => {
    const { mocks } = await renderReady()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    expect(mocks.installPlugin).toHaveBeenCalledWith({ name: '@fixture/ping', confirmed: true, allowScripts: false })
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.listAvailable).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('maps a business rejection to a localized error', async () => {
    await renderReady({
      installPlugin: vi.fn(async (): Promise<InstallResult> => ({ ok: false, error: { code: 'already-installed', name: '@fixture/ping' } })),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorAlreadyInstalled)
  })

  it.each<[string, string]>([
    ['invalid-name', en.errorInvalidName],
    ['not-found', en.errorNotFound],
    ['offline', en.errorOffline],
    ['install-failed', en.errorInstallFailed],
  ])('maps the %s install rejection to a localized error', async (code, expected) => {
    await renderReady({
      installPlugin: vi.fn(async (): Promise<InstallResult> => ({ ok: false, error: { code: code as never, name: '@fixture/ping' } })),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    expect((await screen.findByRole('alert')).textContent).toBe(expected)
  })

  it('maps the remove-failed uninstall rejection to a localized error', async () => {
    await renderReady({
      uninstallPlugin: vi.fn(async (): Promise<PluginManagerUninstallResult> => ({ ok: false, error: { code: 'remove-failed', name: '@deepseek-ai/dsh-compaction' } })),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.uninstall })) })
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorRemoveFailed)
  })

  it('maps the in-use uninstall rejection to a localized error', async () => {
    await renderReady({
      uninstallPlugin: vi.fn(async (): Promise<PluginManagerUninstallResult> => ({ ok: false, error: { code: 'in-use', name: '@deepseek-ai/dsh-compaction' } })),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.uninstall })) })
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorInUse)
  })

  it('folds a transport failure into a generic action error', async () => {
    await renderReady({
      installPlugin: vi.fn(async () => { throw new Error('transport detail') }),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(en.actionFailed)
    expect(screen.queryByText('transport detail')).toBeNull()
  })

  it('disables every action while one is in flight', async () => {
    const deferred = Promise.withResolvers<InstallResult>()
    await renderReady({ installPlugin: () => deferred.promise })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    expect(screen.getByRole('button', { name: en.working }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.uninstall }).hasAttribute('disabled')).toBe(true)
    await act(async () => { deferred.resolve(okInstall('@fixture/ping')) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.working })).toBeNull() })
  })

  it('uninstalls a managed entry and maps not-managed rejection', async () => {
    await renderReady({
      uninstallPlugin: vi.fn(async (): Promise<PluginManagerUninstallResult> => ({ ok: false, error: { code: 'not-managed', name: '@deepseek-ai/dsh-compaction' } })),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.uninstall })) })
    expect(screen.queryAllByRole('button', { name: en.uninstall }).length).toBeGreaterThan(0)
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorNotManaged)
  })

  it('shows the empty state when nothing is available', async () => {
    await renderReady({ listAvailable: async () => EMPTY_CATALOG })
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.install })).toBeNull()
  })

  it('refreshes the catalog on demand and reflects the pending state', async () => {
    const refreshDeferred = Promise.withResolvers<Available>()
    const refreshCatalog = vi.fn(() => refreshDeferred.promise)
    const { mocks } = await renderReady({ refreshCatalog })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.refresh })) })
    expect(mocks.refreshCatalog).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: en.refreshing }).hasAttribute('disabled')).toBe(true)
    await act(async () => { refreshDeferred.resolve(EMPTY_CATALOG) })
    await waitFor(() => { expect(screen.queryByText(en.refreshing)).toBeNull() })
    expect(screen.getByText(en.empty)).toBeTruthy()
  })

  it('renders per-source status lines with kind, state, count, and filtered count', async () => {
    await renderReady({ listAvailable: async () => ({
      entries: [
        {
          name: 'awesome-user/repo-a',
          description: 'A curated repo',
          source: 'awesome',
          installKind: 'network',
          category: 'Chat',
          stars: 42,
          url: 'https://github.com/awesome-user/repo-a',
          installable: true,
          installed: false,
        },
      ],
      sources: [
        { id: 'awesome', kind: 'awesome', state: 'ok', entryCount: 1 },
        { id: 'topic', kind: 'topic', state: 'error', entryCount: 0, error: 'rate limited', filteredCount: 3 },
      ],
      capabilities: CAPABILITIES,
    }) })
    expect(screen.getByText('awesome')).toBeTruthy()
    expect(screen.getAllByText(en.sourceAwesome)).toHaveLength(2) // badge + status line
    expect(screen.getByText(en.sourceOk)).toBeTruthy()
    expect(screen.getByText(en.sourceError)).toBeTruthy()
    expect(screen.getByText('rate limited')).toBeTruthy()
    expect(screen.getByText(en.filteredCount.replace('{count}', '3'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'awesome-user/repo-a, Not installed' }))
    expect(screen.getByText('★ 42')).toBeTruthy()
    expect(screen.getByText('A curated repo')).toBeTruthy()
    expect(screen.getAllByText('Chat')).toHaveLength(3) // group head + badge + detail row
    expect(screen.getByRole('link', { name: en.repo })).toHaveProperty('href', 'https://github.com/awesome-user/repo-a')
  })

  it('shows a pending installing label while a network install is in flight', async () => {
    const deferred = Promise.withResolvers<InstallResult>()
    await renderReady({
      listAvailable: async () => netCatalog(),
      installPlugin: () => deferred.promise,
    })
    // A network install opens the confirmation dialog first; confirm it.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    const dialog = screen.getByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByLabelText(en.confirmAcknowledge)) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: en.install })) })
    expect(screen.getByRole('button', { name: en.installing }).hasAttribute('disabled')).toBe(true)
    await act(async () => { deferred.resolve(okInstall('user/repo')) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.installing })).toBeNull() })
  })

  it('renders browse-only entries without an install action', async () => {
    const { view } = await renderReady({ listAvailable: async () => ({
      entries: [
        { name: 'topic-search/topic-a', source: 'topic', installKind: 'static', stars: 7, url: 'https://github.com/topic-search/topic-a', installable: false, installed: false },
      ],
      sources: [{ id: 'topic', kind: 'topic', state: 'ok', entryCount: 1 }],
      capabilities: CAPABILITIES,
    }) })
    const card = view.container.querySelector<HTMLElement>('[data-catalog-entry="topic-search/topic-a"]')
    expect(card).not.toBeNull()
    expect(within(card!).getByText(en.browseOnly)).toBeTruthy()
    expect(within(card!).queryByRole('button', { name: en.install })).toBeNull()
    expect(within(card!).queryByRole('button', { name: en.uninstall })).toBeNull()
  })
})

describe('network install trust confirmation', () => {
  it('opens a confirmation dialog and installs only after acknowledgement', async () => {
    // The store freezes committed snapshots, so the catalog read builds a fresh
    // entry reflecting the install instead of mutating a shared fixture.
    let installed = false
    const installPlugin = vi.fn(async (request: { readonly name: string }) => {
      installed = true
      return okInstall(request.name)
    })
    const listAvailable = vi.fn(async () => {
      const snapshot = netCatalog()
      if (installed) {
        return { ...snapshot, entries: [{ ...snapshot.entries[0]!, installed: true }] }
      }
      return snapshot
    })
    await renderReady({ listAvailable, installPlugin })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(en.confirmTitle)).toBeTruthy()
    expect(within(dialog).getByText(en.confirmRisk)).toBeTruthy()
    expect(within(dialog).getByText('user/repo')).toBeTruthy() // module name row
    expect(within(dialog).getByText('user/repo#main')).toBeTruthy() // exact install spec
    expect(within(dialog).getByText(en.sourceTopic)).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'https://github.com/user/repo' }))
      .toHaveProperty('href', 'https://github.com/user/repo')

    // The primary action is locked until the acknowledgement is checked.
    const confirm = within(dialog).getByRole('button', { name: en.install })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    await act(async () => { fireEvent.click(within(dialog).getByLabelText(en.confirmAcknowledge)) })
    expect(confirm.hasAttribute('disabled')).toBe(false)

    await act(async () => { fireEvent.click(confirm) })
    expect(installPlugin).toHaveBeenCalledWith({ name: 'user/repo', confirmed: true, allowScripts: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    // The committed install reloads both faces, so the card flips to uninstall.
    expect(await screen.findByRole('button', { name: en.uninstall })).toBeTruthy()
  })

  it('cancelling the dialog never calls the wire', async () => {
    const installPlugin = vi.fn(async () => okInstall('user/repo'))
    await renderReady({ listAvailable: async () => netCatalog(), installPlugin })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.cancel })) })
    expect(installPlugin).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers the scripts opt-in only when the deployment permits scripts', async () => {
    const installPlugin = vi.fn(async (request: { readonly name: string }) => okInstall(request.name))
    const first = await renderReady({ listAvailable: async () => netCatalog(), installPlugin })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText(en.allowScripts)).toBeTruthy()
    await act(async () => { fireEvent.click(within(dialog).getByLabelText(en.allowScripts)) })
    await act(async () => { fireEvent.click(within(dialog).getByLabelText(en.confirmAcknowledge)) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: en.install })) })
    expect(installPlugin).toHaveBeenCalledWith({ name: 'user/repo', confirmed: true, allowScripts: true })
    first.view.unmount()

    // Without the capability the opt-in checkbox is absent and scripts stay off.
    const installPluginLocked = vi.fn(async (request: { readonly name: string }) => okInstall(request.name))
    await renderReady({
      listAvailable: async () => netCatalog({ capabilities: { ...CAPABILITIES, allowInstallScripts: false } }),
      installPlugin: installPluginLocked,
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    const lockedDialog = screen.getByRole('dialog')
    expect(within(lockedDialog).queryByLabelText(en.allowScripts)).toBeNull()
    await act(async () => { fireEvent.click(within(lockedDialog).getByLabelText(en.confirmAcknowledge)) })
    await act(async () => { fireEvent.click(within(lockedDialog).getByRole('button', { name: en.install })) })
    expect(installPluginLocked).toHaveBeenCalledWith({ name: 'user/repo', confirmed: true, allowScripts: false })
  })

  it('reports an unavailable sandbox and refuses the confirm', async () => {
    await renderReady({
      listAvailable: async () => netCatalog({ capabilities: { ...CAPABILITIES, installSandbox: 'unavailable' } }),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(en.sandboxUnavailable)).toBeTruthy()
    const confirm = within(dialog).getByRole('button', { name: en.install })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    await act(async () => { fireEvent.click(within(dialog).getByLabelText(en.confirmAcknowledge)) })
    // The host would reject the install; the primary action stays locked.
    expect(confirm.hasAttribute('disabled')).toBe(true)
  })

  it('installs directly without the dialog when the deployment disabled confirmation', async () => {
    const installPlugin = vi.fn(async (request: { readonly name: string }) => okInstall(request.name))
    await renderReady({
      listAvailable: async () => netCatalog({ capabilities: { ...CAPABILITIES, networkConfirmation: false } }),
      installPlugin,
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(installPlugin).toHaveBeenCalledWith({ name: 'user/repo', confirmed: true, allowScripts: false })
  })

  it('maps the confirmation-required and sandbox-unavailable rejections', async () => {
    const first = await renderReady({
      installPlugin: vi.fn(async (): Promise<InstallResult> => ({ ok: false, error: { code: 'confirmation-required', name: '@fixture/ping' } })),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorConfirmationRequired)
    first.view.unmount()

    await renderReady({
      installPlugin: vi.fn(async (): Promise<InstallResult> => ({ ok: false, error: { code: 'sandbox-unavailable', name: '@fixture/ping' } })),
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.install })) })
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorSandboxUnavailable)
  })

  it('flags an installed network card whose store integrity drifted', async () => {
    await renderReady({ listAvailable: async () => netCatalog({
      entries: [{
        name: 'user/repo',
        source: 'topic',
        installKind: 'network',
        installable: true,
        installed: true,
        version: '1.0.0',
        integrity: 'sha512-abc',
        integrityStatus: 'tampered',
      }],
    }) })
    const card = screen.getByRole('button', { name: 'user/repo, Installed' })
    expect(screen.getByText(en.integrityTampered)).toBeTruthy()
    fireEvent.click(card)
    expect(screen.getByText('1.0.0')).toBeTruthy()
    expect(screen.getAllByText(en.integrityTampered)).toHaveLength(2) // badge + detail row
  })
})
