/**
 * The agent-preset management controller: a copy dialog and a drag-and-drop
 * composer are the two ways a preset is created, the shipped compositions open
 * in a read-only canvas view, and the way into a custom preset's files is the
 * location action — opened on a desktop, revealed as a path where the host has
 * none. Every mutation re-reads the roster because a copy or a composition
 * changes more than the row it targeted.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ComposeRow, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  AgentPresetSectionController, addRow, composeBlocker, composeDirty, displayNameFor, draftBlocker,
  handoffBlocker, insertRowAt, insertionIndexFor, moveRow, removeRow, rowIdFor,
} from '../src/client/section-store.ts'
import type { ComposeDraft, CopyDraft, PaletteModule, PresetRow } from '../src/client/section-store.ts'

interface FakePreset { trust: 'system' | 'user'; content: string; name?: string; rows?: ComposeRow[] }
interface Recorded { method: string; payload: unknown }

interface FakeOptions {
  /** Every call the controller made, in order. */
  calls?: Recorded[]
  /** Reject `list` with this message. */
  failList?: string
  /** Reject `read` with this message. */
  failRead?: string
  /** Reject `copy` with this message. */
  failCopy?: string
  /** Reject `compose` with this message. */
  failCompose?: string
  /** Reject `openDocument` with this message. */
  failOpen?: string
  /** Reject `remove` with this message. */
  failRemove?: string
  /** Reject `settings.update` with this message. */
  failSettings?: string
  /** Throw from `list` rather than answering, as a dead transport does. */
  throwList?: boolean
  /** Throw from `read`, as a dead transport does. */
  throwRead?: boolean
  /** Throw from `copy`, as a dead transport does. */
  throwCopy?: boolean
  /** Throw from `compose`, as a dead transport does. */
  throwCompose?: boolean
  /** Throw from `openDocument`, as a dead transport does. */
  throwOpen?: boolean
  /** Whether the deployment configures a writable root. */
  authorable?: boolean
  /** Whether the host can open a preset directory on a desktop. */
  hasDocument?: boolean
  /** Hold `remove` until this resolves, to observe the in-flight state. */
  holdRemove?: Promise<void>
  /** Hold `compose` until this resolves, to observe the in-flight state. */
  holdCompose?: Promise<void>
  /** The composer palette's installed modules; empty by default. */
  modules?: readonly PaletteModule[]
  /** Make the palette load fail, as a deployment without an inventory does. */
  failPalette?: boolean
}

const ok = (value: unknown) => Promise.resolve({ rpcId: 'r', result: { ok: true as const, value } })
const fail = (message: string) =>
  Promise.resolve({ rpcId: 'r', result: { ok: false as const, error: { code: 'internal', message, details: {} } } })

/**
 * A wire face over an in-memory preset store: copies land, so the roster the
 * controller re-reads after a copy is the one the copy produced.
 * @param presets - the starting compositions by id.
 * @param defaultId - the preset a session with no choice gets.
 * @param options - failure injection and call recording.
 * @returns the fake client.
 */
function fakeApi(
  presets: Map<string, FakePreset>,
  defaultId: { id: string },
  options: FakeOptions = {},
): Pick<IApiClient, 'agentPresets' | 'settings'> {
  const record = (method: string, payload: unknown): void => { options.calls?.push({ method, payload }) }
  return {
    agentPresets: {
      list: () => {
        record('list', {})
        if (options.throwList === true) return Promise.reject(new Error('socket closed'))
        if (options.failList !== undefined) return fail(options.failList)
        return ok({
          presets: [...presets].map(([id, preset]) => ({
            id, trust: preset.trust, isDefault: id === defaultId.id,
            ...preset.name === undefined ? {} : { name: preset.name },
          })),
          authorable: options.authorable ?? true,
          hasDocument: options.hasDocument ?? true,
        })
      },
      read: (payload: { agentPreset: string }) => {
        record('read', payload)
        if (options.throwRead === true) return Promise.reject(new Error('socket closed'))
        if (options.failRead !== undefined) return fail(options.failRead)
        const preset = presets.get(payload.agentPreset)
        /* v8 ignore next -- every test reads an id the fake store holds */
        if (preset === undefined) return fail(`unknown preset ${payload.agentPreset}`)
        return ok({
          agentPreset: payload.agentPreset,
          trust: preset.trust,
          content: preset.content,
          rows: preset.rows ?? [],
          ...preset.name === undefined ? {} : { name: preset.name },
        })
      },
      copy: (payload: { from: string; agentPreset: string; name?: string }) => {
        record('copy', payload)
        if (options.throwCopy === true) return Promise.reject(new Error('socket closed'))
        if (options.failCopy !== undefined) return fail(options.failCopy)
        const source = presets.get(payload.from)
        /* v8 ignore next -- every test copies a source the fake store holds */
        if (source === undefined) return fail(`unknown preset ${payload.from}`)
        presets.set(payload.agentPreset, {
          trust: 'user',
          content: source.content,
          ...source.rows === undefined ? {} : { rows: [...source.rows] },
          ...payload.name === undefined ? {} : { name: payload.name },
        })
        return ok({ agentPreset: payload.agentPreset })
      },
      compose: async (payload: {
        agentPreset: string
        name?: string
        rows: ComposeRow[]
        overwrite?: boolean
      }) => {
        record('compose', payload)
        await options.holdCompose
        if (options.throwCompose === true) throw new Error('socket closed')
        if (options.failCompose !== undefined) return await fail(options.failCompose)
        const existing = presets.get(payload.agentPreset)
        if (payload.overwrite !== true && existing !== undefined) {
          return await fail(`preset ${payload.agentPreset} already exists`)
        }
        if (payload.overwrite === true && existing?.trust === 'system') {
          return await fail(`preset ${payload.agentPreset} is read-only`)
        }
        presets.set(payload.agentPreset, {
          trust: 'user',
          content: payload.rows.map(row => `- id: ${row.id}\n`).join(''),
          rows: [...payload.rows],
          ...payload.name === undefined ? {} : { name: payload.name },
        })
        return await ok({ agentPreset: payload.agentPreset })
      },
      openDocument: (payload: { agentPreset: string }) => {
        record('openDocument', payload)
        if (options.throwOpen === true) return Promise.reject(new Error('socket closed'))
        if (options.failOpen !== undefined) return fail(options.failOpen)
        return (options.hasDocument ?? true)
          ? ok({ opened: true })
          : ok({ opened: false, path: `/presets/${payload.agentPreset}` })
      },
      remove: async (payload: { agentPreset: string }) => {
        record('remove', payload)
        await options.holdRemove
        if (options.failRemove !== undefined) return await fail(options.failRemove)
        presets.delete(payload.agentPreset)
        return await ok({})
      },
    },
    settings: {
      update: (payload: { ns: string; patch: { default?: string } }) => {
        record('settings.update', payload)
        if (options.failSettings !== undefined) return fail(options.failSettings)
        /* v8 ignore next -- the controller only ever patches `default` */
        defaultId.id = payload.patch.default ?? defaultId.id
        return ok({})
      },
    },
  } as unknown as Pick<IApiClient, 'agentPresets' | 'settings'>
}

function seed(): Map<string, FakePreset> {
  return new Map<string, FakePreset>([
    ['standard', {
      trust: 'system', content: '- id: tool-bash\n', name: '标准模式',
      rows: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }],
    }],
    ['mine', {
      trust: 'user', content: '- id: tool-read\n',
      rows: [{ id: 'tool-read', name: '@deepseek-ai/dsh-tool-read' }],
    }],
  ])
}

/** One palette entry, as the composer's module source would deliver it. */
function paletteOf(...moduleNames: string[]): readonly PaletteModule[] {
  return moduleNames.map(moduleName => ({ moduleName, displayName: displayNameFor(moduleName) }))
}

function harness(options: FakeOptions = {}) {
  const presets = seed()
  const defaultId = { id: 'standard' }
  const calls: Recorded[] = []
  let rosterChanges = 0
  const controller = new AgentPresetSectionController(
    fakeApi(presets, defaultId, { ...options, calls: options.calls ?? calls }),
    () => { rosterChanges += 1 },
    {
      list: async () => {
        if (options.failPalette === true) throw new Error('no inventory')
        return options.modules ?? []
      },
    },
  )
  return { controller, presets, defaultId, calls, rosterChanges: () => rosterChanges }
}

function copyOf(controller: AgentPresetSectionController): CopyDraft {
  const { copy } = controller.store.getSnapshot()
  if (copy === null) throw new Error('expected an open copy dialog')
  return copy
}

describe('loading the roster', () => {
  it('maps the roster onto rows with the capability flags', async () => {
    const { controller } = harness({ authorable: true, hasDocument: false })

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.authorable).toBe(true)
    expect(state.hasDocument).toBe(false)
    expect(state.rows.map((row: PresetRow) => row.id)).toEqual(['standard', 'mine'])
    expect(state.rows[0]).toMatchObject({ trust: 'system', isDefault: true, name: '标准模式' })
  })

  it('reports an empty roster as unavailable, not as an error', async () => {
    const { controller, presets } = harness()
    presets.clear()

    await controller.load()

    expect(controller.store.getSnapshot().status).toBe('unavailable')
  })

  it('keeps one load in flight rather than stacking reads', async () => {
    const { controller, calls } = harness()

    await Promise.all([controller.load(), controller.load()])

    expect(calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('surfaces a refusal as the page error', async () => {
    const { controller } = harness({ failList: 'not for you' })

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('not for you')
  })

  it('folds a dead transport into the same error surface', async () => {
    const { controller } = harness({ throwList: true })

    await controller.load()

    expect(controller.store.getSnapshot().status).toBe('error')
    expect(controller.store.getSnapshot().error).toContain('socket closed')
  })
})

describe('the read-only canvas view', () => {
  it('opens a shipped composition under its display name', async () => {
    const { controller } = harness()
    await controller.load()

    await controller.view('standard')

    expect(controller.store.getSnapshot().view).toEqual({
      id: 'standard', title: '标准模式',
      rows: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }],
    })
  })

  it('loads the palette with the view, and closes both together', async () => {
    const { controller } = harness({ modules: paletteOf('@deepseek-ai/dsh-tool-bash') })
    await controller.load()

    await controller.view('standard')
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().palette?.status).toBe('ready')
    })

    controller.closeView()

    expect(controller.store.getSnapshot().view).toBeNull()
    expect(controller.store.getSnapshot().palette).toBeNull()
  })

  it('falls back to the id when the preset published no name', async () => {
    const { controller } = harness()
    await controller.load()

    await controller.view('mine')

    expect(controller.store.getSnapshot().view?.title).toBe('mine')
  })

  it('closes without touching the list', async () => {
    const { controller } = harness()
    await controller.load()
    await controller.view('standard')

    controller.closeView()

    expect(controller.store.getSnapshot().view).toBeNull()
    expect(controller.store.getSnapshot().rows).toHaveLength(2)
  })

  it('puts a read refusal on the page rather than opening empty', async () => {
    const { controller } = harness({ failRead: 'no peeking' })
    await controller.load()

    await controller.view('standard')

    expect(controller.store.getSnapshot().view).toBeNull()
    expect(controller.store.getSnapshot().error).toBe('no peeking')
  })

  it('folds a dead transport into the same error surface', async () => {
    const { controller } = harness({ throwRead: true })
    await controller.load()

    await controller.view('standard')

    expect(controller.store.getSnapshot().error).toContain('socket closed')
  })
})

describe('the copy dialog', () => {
  it('opens over the source with its display name in the title', async () => {
    const { controller } = harness()
    await controller.load()

    controller.beginCopy('standard')

    expect(copyOf(controller)).toMatchObject({
      from: 'standard', fromTitle: '标准模式', id: '', name: '', saving: false,
    })
  })

  it('falls back to the source id when it published no name', async () => {
    const { controller } = harness()
    await controller.load()

    controller.beginCopy('mine')

    expect(copyOf(controller).fromTitle).toBe('mine')
  })

  it('cancel discards whatever was typed', async () => {
    const { controller } = harness()
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('half-typed')

    controller.cancelCopy()

    expect(controller.store.getSnapshot().copy).toBeNull()
  })

  it('ignores field edits and submits with no dialog open', async () => {
    const { controller, calls } = harness()
    await controller.load()

    controller.setCopyId('typed-into-nothing')
    controller.setCopyName('nameless')
    await controller.confirmCopy()

    expect(controller.store.getSnapshot().copy).toBeNull()
    expect(calls.some(call => call.method === 'copy')).toBe(false)
  })

  it('typing clears the previous failure', async () => {
    const { controller } = harness({ failCopy: 'disk full' })
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')
    await controller.confirmCopy()
    expect(copyOf(controller).error).toBe('disk full')

    controller.setCopyName('renamed')

    expect(copyOf(controller).error).toBeNull()
  })
})

describe('the copy blocker', () => {
  const rows: PresetRow[] = [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'mine', trust: 'user', isDefault: false },
  ]
  const draft = (id: string): CopyDraft =>
    ({ from: 'standard', fromTitle: '标准模式', id, name: '', saving: false, error: null })

  it('requires an id, a containable shape, and a free name', () => {
    expect(draftBlocker(draft(''), rows)).toBe('idRequired')
    expect(draftBlocker(draft('../escape'), rows)).toBe('idInvalid')
    expect(draftBlocker(draft('Upper'), rows)).toBe('idInvalid')
    expect(draftBlocker(draft('mine'), rows)).toBe('idTaken')
    expect(draftBlocker(draft('my-copy'), rows)).toBeUndefined()
  })
})

describe('submitting a copy', () => {
  it('copies, re-reads the roster, announces the change, and opens the files', async () => {
    const { controller, calls, rosterChanges } = harness()
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')
    controller.setCopyName('我的模式')

    await controller.confirmCopy()

    const state = controller.store.getSnapshot()
    expect(state.copy).toBeNull()
    expect(state.rows.map(row => row.id)).toContain('my-copy')
    expect(rosterChanges()).toBe(1)
    expect(calls.find(call => call.method === 'copy')?.payload)
      .toEqual({ from: 'standard', agentPreset: 'my-copy', name: '我的模式' })
    // A preset is its files from here on, so landing in them completes the
    // copy rather than following it.
    expect(calls.find(call => call.method === 'openDocument')?.payload)
      .toEqual({ agentPreset: 'my-copy' })
  })

  it('omits an empty name so the copy falls back to its id', async () => {
    const { controller, calls } = harness()
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')
    controller.setCopyName('   ')

    await controller.confirmCopy()

    expect(calls.find(call => call.method === 'copy')?.payload)
      .toEqual({ from: 'standard', agentPreset: 'my-copy' })
  })

  it('reveals the new directory as text where the host has no desktop', async () => {
    const { controller } = harness({ hasDocument: false })
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')

    await controller.confirmCopy()

    expect(controller.store.getSnapshot().revealedPaths['my-copy']).toBe('/presets/my-copy')
  })

  it('keeps the dialog open with the refusal on it', async () => {
    const { controller, rosterChanges } = harness({ failCopy: 'id already exists' })
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')

    await controller.confirmCopy()

    expect(copyOf(controller)).toMatchObject({ saving: false, error: 'id already exists' })
    expect(rosterChanges()).toBe(0)
  })

  it('folds a dead transport into the dialog error', async () => {
    const { controller } = harness({ throwCopy: true })
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')

    await controller.confirmCopy()

    expect(copyOf(controller).error).toContain('socket closed')
  })

  it('refuses to submit while blocked or already saving', async () => {
    const { controller, calls } = harness()
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('mine')

    await controller.confirmCopy()

    expect(calls.some(call => call.method === 'copy')).toBe(false)
  })
})

describe('the location action', () => {
  it('opens the directory and leaves the page alone on a desktop host', async () => {
    const { controller, calls } = harness()
    await controller.load()

    await controller.openLocation('mine')

    expect(calls.find(call => call.method === 'openDocument')?.payload).toEqual({ agentPreset: 'mine' })
    expect(controller.store.getSnapshot().revealedPaths).toEqual({})
  })

  it('reveals the path on the row where the host has none', async () => {
    const { controller } = harness({ hasDocument: false })
    await controller.load()

    await controller.openLocation('mine')

    expect(controller.store.getSnapshot().revealedPaths).toEqual({ mine: '/presets/mine' })
  })

  it('drops a revealed path once its preset leaves the roster', async () => {
    const { controller, presets } = harness({ hasDocument: false })
    await controller.load()
    await controller.openLocation('mine')
    presets.delete('mine')

    await controller.load()

    expect(controller.store.getSnapshot().revealedPaths).toEqual({})
  })

  it('surfaces a refusal as the page error', async () => {
    const { controller } = harness({ failOpen: 'not yours' })
    await controller.load()

    await controller.openLocation('mine')

    expect(controller.store.getSnapshot().error).toBe('not yours')
  })

  it('folds a dead transport into the same error surface', async () => {
    const { controller } = harness({ throwOpen: true })
    await controller.load()

    await controller.openLocation('mine')

    expect(controller.store.getSnapshot().error).toContain('socket closed')
  })
})

describe('deleting', () => {
  it('asks first, then deletes, re-reads, and announces the change', async () => {
    const { controller, rosterChanges } = harness()
    await controller.load()

    controller.confirmDelete('mine')
    expect(controller.store.getSnapshot().pendingDelete).toBe('mine')
    await controller.remove()

    const state = controller.store.getSnapshot()
    expect(state.pendingDelete).toBeNull()
    expect(state.rows.map(row => row.id)).not.toContain('mine')
    expect(rosterChanges()).toBe(1)
  })

  it('dismisses the confirmation without deleting', async () => {
    const { controller, calls } = harness()
    await controller.load()
    controller.confirmDelete('mine')

    controller.confirmDelete(null)
    await controller.remove()

    expect(controller.store.getSnapshot().rows.map(row => row.id)).toContain('mine')
    expect(calls.some(call => call.method === 'remove')).toBe(false)
  })

  it('ignores a second confirmation while one delete is in flight', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { controller, calls } = harness({ holdRemove: gate })
    await controller.load()
    controller.confirmDelete('mine')
    const removal = controller.remove()

    controller.confirmDelete('standard')
    await controller.remove()
    release()
    await removal

    expect(calls.filter(call => call.method === 'remove')).toHaveLength(1)
  })

  it('surfaces a refusal and clears the confirmation', async () => {
    const { controller } = harness({ failRemove: 'shipped preset' })
    await controller.load()
    controller.confirmDelete('mine')

    await controller.remove()

    const state = controller.store.getSnapshot()
    expect(state.error).toBe('shipped preset')
    expect(state.pendingDelete).toBeNull()
    expect(state.deleting).toBe(false)
  })

  it('folds a dead transport into the same error surface', async () => {
    const { controller, presets } = harness()
    await controller.load()
    presets.clear()
    const broken = new AgentPresetSectionController({
      agentPresets: {
        list: () => Promise.reject(new Error('gone')),
        remove: () => Promise.reject(new Error('socket closed')),
      },
      settings: {},
    } as unknown as Pick<IApiClient, 'agentPresets' | 'settings'>)
    broken.confirmDelete('mine')

    await broken.remove()

    expect(broken.store.getSnapshot().error).toContain('socket closed')
  })
})

describe('a controller with no roster listener', () => {
  it('completes a delete without anyone to notify', async () => {
    // The rosterChanged callback is optional wiring, not a requirement: a
    // page composed without sibling surfaces still deletes cleanly.
    const presets = seed()
    const alone = new AgentPresetSectionController(fakeApi(presets, { id: 'standard' }))
    await alone.load()
    alone.confirmDelete('mine')

    await alone.remove()

    expect(alone.store.getSnapshot().rows.map(row => row.id)).not.toContain('mine')
  })
})

describe('the default preset', () => {
  it('writes the setting and re-reads the roster', async () => {
    const { controller, defaultId } = harness()
    await controller.load()

    await controller.makeDefault('mine')

    expect(defaultId.id).toBe('mine')
    expect(controller.store.getSnapshot().rows.find(row => row.id === 'mine')?.isDefault).toBe(true)
  })

  it('surfaces a settings refusal as the page error', async () => {
    const { controller } = harness({ failSettings: 'read-only settings' })
    await controller.load()

    await controller.makeDefault('mine')

    expect(controller.store.getSnapshot().error).toContain('read-only settings')
  })
})

describe('the composer helpers', () => {
  it('derives a row id from the module name, stripping package prefixes', () => {
    expect(rowIdFor('@deepseek-ai/dsh-tool-bash', [])).toBe('tool-bash')
    expect(rowIdFor('web-search', [])).toBe('web-search')
    // A conflict appends -2, then -3, until the id is free.
    const rows = [{ id: 'tool-bash', name: 'x' }, { id: 'tool-bash-2', name: 'y' }]
    expect(rowIdFor('@deepseek-ai/dsh-tool-bash', rows)).toBe('tool-bash-3')
  })

  it('adds a row once, refusing a duplicate module by name', () => {
    const one = addRow([], '@deepseek-ai/dsh-tool-bash')
    expect(one).toEqual([{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }])
    // One agent runs one instance of a plugin, so the same module never lands twice.
    expect(addRow(one, '@deepseek-ai/dsh-tool-bash')).toBe(one)
  })

  it('removes a row by id', () => {
    const rows = [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }]
    expect(removeRow(rows, 'a')).toEqual([{ id: 'b', name: 'y' }])
  })

  it('reorders rows and clamps out-of-range moves', () => {
    const rows = [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }, { id: 'c', name: 'z' }]
    expect(moveRow(rows, 0, 2)).toEqual([{ id: 'b', name: 'y' }, { id: 'c', name: 'z' }, { id: 'a', name: 'x' }])
    expect(moveRow(rows, 2, 0)).toEqual([{ id: 'c', name: 'z' }, { id: 'a', name: 'x' }, { id: 'b', name: 'y' }])
    expect(moveRow(rows, 1, -5)).toEqual([{ id: 'b', name: 'y' }, { id: 'a', name: 'x' }, { id: 'c', name: 'z' }])
    // A drag with no valid source leaves the composition alone.
    expect(moveRow(rows, 9, 0)).toBe(rows)
  })

  it('derives a display name from the module name, stripping scope and prefix', () => {
    expect(displayNameFor('@deepseek-ai/dsh-tool-bash')).toBe('Bash')
    expect(displayNameFor('web-search')).toBe('Web Search')
    expect(displayNameFor('tool-file-read')).toBe('File Read')
    // A subpath keeps its slash; nothing recognizable left means the call
    // site falls back to the module name.
    expect(displayNameFor('@deepseek-ai/dsh-web-app/startup')).toBe('Web App/Startup')
    expect(displayNameFor('dsh-')).toBe('')
  })

  it('inserts a module at a slot, clamping out-of-range slots', () => {
    expect(insertRowAt([], '@deepseek-ai/dsh-tool-bash', 0))
      .toEqual([{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }])
    const rows = [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }]
    expect(insertRowAt(rows, '@deepseek-ai/dsh-tool-read', 0))
      .toEqual([
        { id: 'tool-read', name: '@deepseek-ai/dsh-tool-read' },
        { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      ])
    expect(insertRowAt(rows, '@deepseek-ai/dsh-tool-read', -5).map(row => row.name)[0])
      .toBe('@deepseek-ai/dsh-tool-read')
    expect(insertRowAt(rows, '@deepseek-ai/dsh-tool-read', 99)).toHaveLength(2)
  })

  it('refuses an insertion for a module already in the composition', () => {
    const rows = [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }]
    expect(insertRowAt(rows, '@deepseek-ai/dsh-tool-bash', 0)).toBe(rows)
  })

  it('maps a drop coordinate onto the slot before the first midpoint past the pointer', () => {
    expect(insertionIndexFor(10, [20, 40, 60])).toBe(0)
    expect(insertionIndexFor(30, [20, 40, 60])).toBe(1)
    expect(insertionIndexFor(80, [20, 40, 60])).toBe(3)
    expect(insertionIndexFor(10, [])).toBe(0)
  })
})

/** A fresh draft plus its saved `original`, for the save/handoff blockers. */
const draft = (over: Partial<ComposeDraft> = {}): ComposeDraft => ({
  id: 'my-agent', name: 'My agent',
  rows: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }],
  saving: false, error: null,
  original: { id: '', name: '', rows: [] },
  ...over,
})

describe('the compose blocker', () => {
  const roster: PresetRow[] = [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'mine', trust: 'user', isDefault: false },
  ]

  it('requires an id, a containable shape, a row, and a change', () => {
    expect(composeBlocker(draft({ id: '' }), roster)).toBe('idRequired')
    expect(composeBlocker(draft({ id: 'Upper' }), roster)).toBe('idInvalid')
    expect(composeBlocker(draft({ rows: [] }), roster)).toBe('noRows')
    const untouched = draft({ original: { id: 'my-agent', name: 'My agent', rows: draft().rows } })
    expect(composeBlocker(untouched, roster)).toBe('unchanged')
    // A create must not land on an id the roster already supplies.
    expect(composeBlocker(draft({ id: 'standard' }), roster)).toBe('idTaken')
  })

  it('editing an existing preset may keep its own roster id', () => {
    const existing = draft({
      id: 'mine',
      original: { id: 'mine', name: '', rows: draft().rows },
    })
    expect(composeBlocker(existing, roster)).toBeUndefined()
  })

  it('reports dirty only for the fields the composer edits', () => {
    const same: ComposeDraft = draft({ original: { id: 'my-agent', name: 'My agent', rows: draft().rows } })
    expect(composeDirty(same)).toBe(false)
    expect(composeDirty(draft({ name: 'renamed' }))).toBe(true)
    expect(composeDirty(draft({ rows: [{ id: 'a', name: 'b' }] }))).toBe(true)
  })
})

describe('the handoff blocker', () => {
  const roster: PresetRow[] = [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'mine', trust: 'user', isDefault: false },
  ]
  it('requires an id, a containable shape, and a row', () => {
    expect(handoffBlocker(draft({ id: '' }), roster)).toBe('idRequired')
    expect(handoffBlocker(draft({ id: 'Upper' }), roster)).toBe('idInvalid')
    expect(handoffBlocker(draft({ rows: [] }), roster)).toBe('noRows')
    expect(handoffBlocker(draft({ id: 'standard' }), roster)).toBe('idTaken')
  })

  it('allows an unchanged existing preset, unlike the save blocker', () => {
    const untouched = draft({ original: { id: 'my-agent', name: 'My agent', rows: draft().rows } })
    // The save blocker calls an already-saved draft unchanged; the handoff
    // treats it as ready and skips the save, so it must not block.
    expect(composeBlocker(untouched, roster)).toBe('unchanged')
    expect(handoffBlocker(untouched, roster)).toBeUndefined()
  })
})

describe('the composer', () => {
  it('opens a new composition empty and loads the palette', async () => {
    const { controller } = harness({ modules: paletteOf('@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })
    await controller.load()

    await controller.beginCompose(null)
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().palette)
        .toEqual({ status: 'ready', modules: paletteOf('@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })
    })

    const state = controller.store.getSnapshot()
    expect(state.composer).toMatchObject({ id: '', name: '', rows: [], saving: false, error: null })
    expect(state.composer?.original).toEqual({ id: '', name: '', rows: [] })
  })

  it('opens an existing preset with its rows read from the wire', async () => {
    const { controller } = harness()
    await controller.load()

    await controller.beginCompose('mine')

    const composer = controller.store.getSnapshot().composer
    expect(composer).toMatchObject({
      id: 'mine', name: 'mine', saving: false, error: null,
      rows: [{ id: 'tool-read', name: '@deepseek-ai/dsh-tool-read' }],
    })
    expect(composer?.original).toEqual({ id: 'mine', name: 'mine', rows: composer?.rows })
  })

  it('degrades the palette without disturbing an open edit', async () => {
    const { controller } = harness({ failPalette: true })
    await controller.load()

    await controller.beginCompose('mine')
    controller.addRow('@deepseek-ai/dsh-tool-read')

    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().palette?.status).toBe('unavailable')
    })
    expect(controller.store.getSnapshot().composer?.rows).toHaveLength(1)
  })

  it('puts a read refusal on the page rather than opening empty', async () => {
    const { controller } = harness({ failRead: 'no peeking' })
    await controller.load()

    await controller.beginCompose('mine')

    expect(controller.store.getSnapshot().composer).toBeNull()
    expect(controller.store.getSnapshot().error).toBe('no peeking')
  })

  it('adds, reorders, and removes rows through the controller', async () => {
    const { controller } = harness({ modules: paletteOf('@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })
    await controller.load()
    await controller.beginCompose(null)

    controller.addRow('@deepseek-ai/dsh-tool-bash')
    controller.addRow('@deepseek-ai/dsh-tool-read')
    controller.moveRow(1, 0)

    const moved = controller.store.getSnapshot().composer!.rows
    expect(moved.map(row => row.name)).toEqual(['@deepseek-ai/dsh-tool-read', '@deepseek-ai/dsh-tool-bash'])

    controller.removeRow('tool-read')

    const kept = controller.store.getSnapshot().composer!.rows
    expect(kept.map(row => row.id)).toEqual(['tool-bash'])
  })

  it('types the target id and display name', async () => {
    const { controller } = harness()
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.setComposerName('我的模式')

    expect(controller.store.getSnapshot().composer).toMatchObject({ id: 'my-agent', name: '我的模式' })
  })

  it('creates a new preset by composing, then re-reads the roster', async () => {
    const { controller, calls, rosterChanges } = harness({ modules: paletteOf('@deepseek-ai/dsh-tool-bash') })
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.setComposerName('我的模式')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    const saved = await controller.confirmCompose()

    const state = controller.store.getSnapshot()
    expect(saved).toBe(true)
    expect(state.composer).toBeNull()
    expect(state.palette).toBeNull()
    expect(state.rows.map(row => row.id)).toContain('my-agent')
    expect(rosterChanges()).toBe(1)
    expect(calls.find(call => call.method === 'compose')?.payload).toEqual({
      agentPreset: 'my-agent',
      rows: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }],
      name: '我的模式',
      overwrite: false,
    })
  })

  it('omits an empty name so the composition falls back to its id', async () => {
    const { controller, calls } = harness()
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.setComposerName('   ')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    await controller.confirmCompose()

    expect(calls.find(call => call.method === 'compose')?.payload)
      .toEqual({ agentPreset: 'my-agent', rows: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }], overwrite: false })
  })

  it('overwrites an existing user preset in place', async () => {
    const { controller, calls, rosterChanges } = harness()
    await controller.load()
    await controller.beginCompose('mine')
    controller.removeRow('tool-read')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    await controller.confirmCompose()

    expect(calls.find(call => call.method === 'compose')?.payload).toEqual({
      agentPreset: 'mine',
      // The preset published no name, so the composer opened on the id and
      // keeps it as the display name.
      name: 'mine',
      rows: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }],
      overwrite: true,
    })
    expect(rosterChanges()).toBe(1)
    expect(controller.store.getSnapshot().rows.map(row => row.id)).toContain('mine')
  })

  it('surfaces a read-only refusal from overwriting a shipped preset', async () => {
    const { controller, rosterChanges } = harness()
    await controller.load()
    await controller.beginCompose('standard')
    controller.addRow('@deepseek-ai/dsh-tool-read')

    await controller.confirmCompose()

    const composer = controller.store.getSnapshot().composer
    expect(composer).toMatchObject({ saving: false, error: 'preset standard is read-only' })
    expect(rosterChanges()).toBe(0)
  })

  it('keeps the composer open with the refusal on it', async () => {
    const { controller, rosterChanges } = harness({ failCompose: 'not writable' })
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    const saved = await controller.confirmCompose()

    expect(saved).toBe(false)
    expect(controller.store.getSnapshot().composer).toMatchObject({ saving: false, error: 'not writable' })
    expect(rosterChanges()).toBe(0)
  })

  it('folds a dead transport into the composer error', async () => {
    const { controller } = harness({ throwCompose: true })
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    await controller.confirmCompose()

    expect(controller.store.getSnapshot().composer?.error).toContain('socket closed')
  })

  it('ignores field edits and submits with no composer open', async () => {
    const { controller, calls } = harness()
    await controller.load()

    controller.setComposerId('typed-into-nothing')
    controller.setComposerName('nameless')
    controller.addRow('@deepseek-ai/dsh-tool-bash')
    controller.removeRow('x')
    controller.moveRow(0, 1)
    await controller.confirmCompose()

    expect(controller.store.getSnapshot().composer).toBeNull()
    expect(calls.some(call => call.method === 'compose')).toBe(false)
  })

  it('refuses to submit while blocked or already saving', async () => {
    const { controller, calls } = harness()
    await controller.load()
    await controller.beginCompose(null)
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    // No id yet: the host would refuse the directory name, so the page does.
    expect(await controller.confirmCompose()).toBe(false)

    expect(calls.some(call => call.method === 'compose')).toBe(false)
  })

  it('ignores a second save while one compose is in flight', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { controller, calls } = harness({ holdCompose: gate })
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.addRow('@deepseek-ai/dsh-tool-bash')
    const saving = controller.confirmCompose()

    await controller.confirmCompose()
    release()
    await saving

    expect(calls.filter(call => call.method === 'compose')).toHaveLength(1)
  })

  it('close discards whatever was assembled', async () => {
    const { controller } = harness()
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    controller.closeComposer()

    const state = controller.store.getSnapshot()
    expect(state.composer).toBeNull()
    expect(state.palette).toBeNull()
  })
})
