/**
 * The agent-preset management controller: a copy dialog and a flow-graph
 * composer are the two ways a preset is created, the shipped compositions open
 * in a read-only canvas view, and the way into a custom preset's files is the
 * location action — opened on a desktop, revealed as a path where the host has
 * none. Every mutation re-reads the roster because a copy or a composition
 * changes more than the row it targeted.
 */

import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { FlowAgentComposition, FlowAgentNode, FlowGraph } from '@deepseek-ai/dsh-flow/types'
import {
  AgentPresetSectionController, composeBlocker, composeDirty, displayNameFor, draftBlocker,
  handoffBlocker, rowIdFor,
} from '../src/client/section-store.ts'
import {
  cascadePosition, chainAddModule, chainAgents, chainMoveIndex, chainMoveNode,
  chainRemoveNode, chainReorder, compositionToRow, emptyChainGraph, graphLayoutEqual, graphRows, insertSlot, setAgentModelKind,
} from '../src/client/preset-graph.ts'
import type { ComposeDraft, CopyDraft, PaletteModule, PresetRow } from '../src/client/section-store.ts'

interface FakePreset { trust: 'system' | 'user'; content: string; name?: string; graph?: FlowGraph }
interface Recorded { method: string; payload: unknown }

/** The agent node with this id, narrowed out of the node union. */
function agentNode(graph: FlowGraph, id: string): FlowAgentNode | undefined {
  return graph.nodes.find((node): node is FlowAgentNode => node.type === 'agent' && node.id === id)
}

interface FakeOptions {
  /** Every call the controller made, in order. */
  calls?: Recorded[]
  /** Reject `list` with this message. */
  failList?: string
  /** Reject `readGraph` with this message. */
  failRead?: string
  /** Reject `copy` with this message. */
  failCopy?: string
  /** Reject `saveGraph` with this message. */
  failCompose?: string
  /** Reject `openDocument` with this message. */
  failOpen?: string
  /** Reject `remove` with this message. */
  failRemove?: string
  /** Reject `settings.update` with this message. */
  failSettings?: string
  /** Reject `llm.models` with this message. */
  failModels?: string
  /** Throw from `list` rather than answering, as a dead transport does. */
  throwList?: boolean
  /** Throw from `readGraph`, as a dead transport does. */
  throwRead?: boolean
  /** Throw from `copy`, as a dead transport does. */
  throwCopy?: boolean
  /** Throw from `saveGraph`, as a dead transport does. */
  throwCompose?: boolean
  /** Throw from `openDocument`, as a dead transport does. */
  throwOpen?: boolean
  /** Throw from `llm.models`, as a dead transport does. */
  throwModels?: boolean
  /** Whether the deployment configures a writable root. */
  authorable?: boolean
  /** Whether the host can open a preset directory on a desktop. */
  hasDocument?: boolean
  /** Hold `remove` until this resolves, to observe the in-flight state. */
  holdRemove?: Promise<void>
  /** Hold `saveGraph` until this resolves, to observe the in-flight state. */
  holdCompose?: Promise<void>
  /** The composer palette's installed modules; empty by default. */
  modules?: readonly PaletteModule[]
  /** Make the palette load fail, as a deployment without an inventory does. */
  failPalette?: boolean
  /** The model catalog `llm.models` serves; empty by default. */
  modelGroups?: readonly ModelProviderGroup[]
}

const ok = (value: unknown) => Promise.resolve({ rpcId: 'r', result: { ok: true as const, value } })
const fail = (message: string) =>
  Promise.resolve({ rpcId: 'r', result: { ok: false as const, error: { code: 'internal', message, details: {} } } })

/** A chain graph over the given modules, in cascade layout, as the composer edits. */
function chainGraph(id: string, name: string, ...modules: string[]): FlowGraph {
  let graph = emptyChainGraph(id, name)
  for (let index = 0; index < modules.length; index++) {
    const module = modules[index]
    if (module === undefined) continue
    const added = chainAddModule(graph, module, cascadePosition(index))
    if (added !== undefined) graph = added.graph
  }
  return graph
}

/**
 * A wire face over an in-memory preset store: copies and compositions land, so
 * the roster the controller re-reads after a mutation is the one the mutation
 * produced.
 * @param presets - the starting presets by id.
 * @param defaultId - the preset a session with no choice gets.
 * @param options - failure injection and call recording.
 * @returns the fake client.
 */
function fakeApi(
  presets: Map<string, FakePreset>,
  defaultId: { id: string },
  options: FakeOptions = {},
): Pick<IApiClient, 'agentPresets' | 'settings' | 'llm'> {
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
      readGraph: (payload: { agentPreset: string }) => {
        record('readGraph', payload)
        if (options.throwRead === true) return Promise.reject(new Error('socket closed'))
        if (options.failRead !== undefined) return fail(options.failRead)
        const preset = presets.get(payload.agentPreset)
        /* v8 ignore next -- every test reads an id the fake store holds */
        if (preset === undefined) return fail(`unknown preset ${payload.agentPreset}`)
        return ok({
          agentPreset: payload.agentPreset,
          trust: preset.trust,
          graph: preset.graph ?? emptyChainGraph(payload.agentPreset, ''),
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
          ...source.graph === undefined ? {} : { graph: source.graph },
          ...payload.name === undefined ? {} : { name: payload.name },
        })
        return ok({ agentPreset: payload.agentPreset })
      },
      saveGraph: async (payload: {
        agentPreset: string
        graph: FlowGraph
        name?: string
        description?: string
        overwrite?: boolean
      }) => {
        record('saveGraph', payload)
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
          content: graphRows(payload.graph).map(row => `- id: ${row.id}\n`).join(''),
          graph: payload.graph,
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
    llm: {
      models: () => {
        record('llm.models', {})
        if (options.throwModels === true) return Promise.reject(new Error('socket closed'))
        if (options.failModels !== undefined) return fail(options.failModels)
        return ok({ groups: options.modelGroups ?? [], failures: [] })
      },
    },
  } as unknown as Pick<IApiClient, 'agentPresets' | 'settings' | 'llm'>
}

function seed(): Map<string, FakePreset> {
  return new Map<string, FakePreset>([
    ['standard', {
      trust: 'system', content: '- id: tool-bash\n', name: '标准模式',
      graph: chainGraph('standard', '标准模式', '@deepseek-ai/dsh-tool-bash'),
    }],
    ['mine', {
      trust: 'user', content: '- id: tool-read\n',
      graph: chainGraph('mine', '', '@deepseek-ai/dsh-tool-read'),
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
      graph: chainGraph('standard', '标准模式', '@deepseek-ai/dsh-tool-bash'),
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
    const broken = new AgentPresetSectionController({
      agentPresets: {
        list: () => Promise.reject(new Error('gone')),
        remove: () => Promise.reject(new Error('socket closed')),
      },
      settings: {},
    } as unknown as Pick<IApiClient, 'agentPresets' | 'settings' | 'llm'>)
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

  it('loads an empty palette from the default module source', async () => {
    // The module source is optional wiring too: a controller mounted with none
    // serves a palette with nothing to offer, so the composer still opens.
    const presets = seed()
    const alone = new AgentPresetSectionController(fakeApi(presets, { id: 'standard' }))
    await alone.load()

    await alone.beginCompose(null)

    await vi.waitFor(() => {
      expect(alone.store.getSnapshot().palette).toEqual({ status: 'ready', modules: [] })
    })
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

describe('the composition graph helpers', () => {
  it('derives a row id from the module name, stripping package prefixes', () => {
    expect(rowIdFor('@deepseek-ai/dsh-tool-bash', [])).toBe('tool-bash')
    expect(rowIdFor('web-search', [])).toBe('web-search')
    // A conflict appends -2, then -3, until the id is free.
    const rows = [{ id: 'tool-bash', name: 'x' }, { id: 'tool-bash-2', name: 'y' }]
    expect(rowIdFor('@deepseek-ai/dsh-tool-bash', rows)).toBe('tool-bash-3')
  })

  it('projects an empty chain with the end terminal clear of the first slot', () => {
    const graph = emptyChainGraph('', '')
    expect(graphRows(graph)).toEqual([])
    expect(chainAgents(graph)).toEqual([])
    expect(graph.nodes.find(node => node.type === 'end')?.position).toEqual(cascadePosition(0))
    expect(graph.edges).toEqual([{ id: 'e-start', from: 'start', to: 'end' }])
  })

  it('appends a module as a node, moving the end terminal past it', () => {
    const one = chainAddModule(emptyChainGraph('', ''), '@deepseek-ai/dsh-tool-bash', cascadePosition(0))
    expect(one?.nodeId).toBe('agent-1')
    expect(graphRows(one!.graph)).toEqual([{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }])
    // The end terminal sits one cascade past the last agent, so the first
    // agent never lands on it.
    expect(one!.graph.nodes.find(node => node.type === 'end')?.position).toEqual(cascadePosition(1))
    // One agent runs one instance of a plugin, so the same module never lands twice.
    expect(chainAddModule(one!.graph, '@deepseek-ai/dsh-tool-bash', cascadePosition(1))).toBeUndefined()
  })

  it('removes a node and relinks the chain around the gap', () => {
    const two = chainGraph('a', '', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read')
    const removed = chainRemoveNode(two, 'agent-1')
    expect(graphRows(removed)).toEqual([{ id: 'tool-read', name: '@deepseek-ai/dsh-tool-read' }])
    // A removal for a node that is not there leaves the chain alone.
    expect(chainRemoveNode(two, 'agent-99')).toBe(two)
  })

  it('reorders the chain by index, clamping out-of-range moves', () => {
    const graph = chainGraph('a', '', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read', '@deepseek-ai/dsh-web-search')
    expect(graphRows(chainMoveIndex(graph, 0, 2)).map(row => row.name))
      .toEqual(['@deepseek-ai/dsh-tool-read', '@deepseek-ai/dsh-web-search', '@deepseek-ai/dsh-tool-bash'])
    expect(graphRows(chainMoveIndex(graph, 2, 0)).map(row => row.name))
      .toEqual(['@deepseek-ai/dsh-web-search', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read'])
    // A move with no valid source leaves the composition alone.
    expect(chainMoveIndex(graph, 9, 0)).toBe(graph)
  })

  it('reorders the chain so the dropped node runs right after the source', () => {
    const graph = chainGraph('a', '', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read', '@deepseek-ai/dsh-web-search')
    // The connect gesture: drag web-search (agent-3) onto tool-bash (agent-1)
    // so it runs immediately after it.
    const reordered = chainReorder(graph, 'agent-1', 'agent-3')
    expect(graphRows(reordered).map(row => row.name))
      .toEqual(['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-web-search', '@deepseek-ai/dsh-tool-read'])
    // An absent source or target is a no-op.
    expect(chainReorder(graph, 'agent-1', 'agent-9')).toBe(graph)
    expect(chainReorder(graph, 'agent-9', 'agent-2')).toBe(graph)
  })

  it('moves one node in place without touching the chain order', () => {
    const graph = chainGraph('a', '', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read')
    const moved = chainMoveNode(graph, 'agent-1', { x: 400, y: 120 })
    expect(moved.nodes.find(node => node.id === 'agent-1')?.position).toEqual({ x: 400, y: 120 })
    expect(graphRows(moved)).toEqual(graphRows(graph))
  })

  it('maps an anchor node to its successor slot', () => {
    const graph = chainGraph('a', '', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read')
    const agents = chainAgents(graph)
    // The start terminal's pick lands first; an agent's pick lands right after
    // it; the end terminal and an absent node keep the module at the tail.
    expect(insertSlot('start', agents)).toBe(0)
    expect(insertSlot('agent-1', agents)).toBe(1)
    expect(insertSlot('agent-2', agents)).toBe(2)
    expect(insertSlot('end', agents)).toBeNull()
    expect(insertSlot('agent-9', agents)).toBeNull()
  })

  it('walks a graph with branching in edge order', () => {
    // The composer only ever composes chains, but the projection walks any
    // graph: a node with several successors visits each in edge order.
    const graph: FlowGraph = {
      id: 'x', name: 'X',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'a', type: 'agent', position: { x: 220, y: 0 }, prompt: '', composition: { module: '@deepseek-ai/dsh-tool-read' } },
        { id: 'b', type: 'agent', position: { x: 220, y: 120 }, prompt: '', composition: { module: '@deepseek-ai/dsh-web-search' } },
        { id: 'end', type: 'end', position: { x: 440, y: 0 } },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'a', to: 'end' },
        { id: 'e4', from: 'b', to: 'end' },
      ],
    }
    expect(chainAgents(graph).map(node => node.composition?.module))
      .toEqual(['@deepseek-ai/dsh-tool-read', '@deepseek-ai/dsh-web-search'])
  })

  it('appends a node the chain never reaches, in node order', () => {
    // A chain is fully reachable from start; a stray agent with no edges is a
    // malformed remainder the projection still shows, deterministically.
    const graph: FlowGraph = {
      id: 'x', name: 'X',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'orphan', type: 'agent', position: { x: 220, y: 0 }, prompt: '', composition: { module: '@deepseek-ai/dsh-tool-read' } },
        { id: 'end', type: 'end', position: { x: 440, y: 0 } },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'end' }],
    }
    expect(chainAgents(graph).map(node => node.id)).toEqual(['orphan'])
  })

  it('distinguishes graphs with equal rows but different node counts', () => {
    const base = chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash')
    const extra: FlowGraph = {
      ...base,
      nodes: [...base.nodes, { id: 'stray', type: 'condition', position: { x: 0, y: 200 }, expression: 'false' }],
    }
    // The rows match (one agent), but a graph with an extra non-row node is a
    // different composition, so the dirty check must catch it.
    expect(graphLayoutEqual(base, extra)).toBe(false)
  })

  it('clearing an unbound kind leaves a node without options alone', () => {
    const base = chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash')
    const cleared = setAgentModelKind(base, 'agent-1', 'text', 'provider', '')

    // A node that never carried agentOptions must not be invented one, or the
    // edit would stay "dirty" against a graph that never changed.
    expect(agentNode(cleared, 'agent-1')?.agentOptions).toBeUndefined()
  })

  it('keeps a node\'s own provider when a kind is cleared', () => {
    const graph: FlowGraph = {
      id: 'x', name: 'X',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'agent-1', type: 'agent', position: { x: 220, y: 0 }, prompt: '', composition: { module: '@deepseek-ai/dsh-tool-bash' }, agentOptions: { provider: 'deepseek' } },
        { id: 'end', type: 'end', position: { x: 440, y: 0 } },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'agent-1' }, { id: 'e2', from: 'agent-1', to: 'end' }],
    }
    const cleared = setAgentModelKind(graph, 'agent-1', 'text', 'provider', '')

    // The node's own provider is authored content, not a kind binding, so
    // clearing a kind leaves it where the graph carried it.
    expect(agentNode(cleared, 'agent-1')?.agentOptions).toEqual({ provider: 'deepseek' })
  })

  it('keeps a node\'s own model when a kind is cleared', () => {
    const graph: FlowGraph = {
      id: 'x', name: 'X',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'agent-1', type: 'agent', position: { x: 220, y: 0 }, prompt: '', composition: { module: '@deepseek-ai/dsh-tool-bash' }, agentOptions: { model: 'deepseek-chat' } },
        { id: 'end', type: 'end', position: { x: 440, y: 0 } },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'agent-1' }, { id: 'e2', from: 'agent-1', to: 'end' }],
    }
    const cleared = setAgentModelKind(graph, 'agent-1', 'text', 'provider', '')

    // Symmetry: a node that authored only a model keeps it the same way.
    expect(agentNode(cleared, 'agent-1')?.agentOptions).toEqual({ model: 'deepseek-chat' })
  })

  it('projects a composition row, keeping only the fields the node carried', () => {
    const bare: FlowAgentComposition = { module: '@deepseek-ai/dsh-tool-bash' }
    expect(compositionToRow(bare)).toEqual({ name: '@deepseek-ai/dsh-tool-bash' })

    const full: FlowAgentComposition = {
      module: '@deepseek-ai/dsh-tool-bash', id: 'mine', config: { key: 'v' },
      group: true, disabled: false, inject: ['extra'],
    }
    expect(compositionToRow(full)).toEqual({
      name: '@deepseek-ai/dsh-tool-bash', id: 'mine', config: { key: 'v' },
      group: true, disabled: false, inject: ['extra'],
    })
  })

  it('walks a chain that ends without the end terminal', () => {
    // A chain may stop at an agent with no successor — the projection walks
    // it to the dead end rather than dropping the tail.
    const graph: FlowGraph = {
      id: 'x', name: 'X',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'dead', type: 'agent', position: { x: 220, y: 0 }, prompt: '', composition: { module: '@deepseek-ai/dsh-tool-read' } },
        { id: 'end', type: 'end', position: { x: 440, y: 0 } },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'dead' }],
    }
    expect(chainAgents(graph).map(node => node.id)).toEqual(['dead'])
  })

  it('reports graphs equal only when rows AND layout match', () => {
    const base = chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash')
    const same = chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash')
    expect(graphLayoutEqual(base, same)).toBe(true)
    expect(graphLayoutEqual(chainMoveNode(base, 'agent-1', { x: 400, y: 120 }), base)).toBe(false)
    expect(graphLayoutEqual(chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-read'), base)).toBe(false)
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
})

/** A fresh draft plus its saved `original`, for the save/handoff blockers. */
const draft = (over: Partial<ComposeDraft> = {}): ComposeDraft => ({
  id: 'my-agent', name: 'My agent',
  graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash'),
  saving: false, error: null,
  original: { id: '', name: '', graph: emptyChainGraph('', '') },
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
    expect(composeBlocker(draft({ graph: emptyChainGraph('my-agent', 'My agent') }), roster)).toBe('noRows')
    const untouched = draft({ original: { id: 'my-agent', name: 'My agent', graph: draft().graph } })
    expect(composeBlocker(untouched, roster)).toBe('unchanged')
    // A create must not land on an id the roster already supplies.
    expect(composeBlocker(draft({ id: 'standard' }), roster)).toBe('idTaken')
  })

  it('editing an existing preset may keep its own roster id', () => {
    const existing = draft({
      id: 'mine',
      original: { id: 'mine', name: '', graph: draft().graph },
    })
    expect(composeBlocker(existing, roster)).toBeUndefined()
  })

  it('reports dirty only for the fields the composer edits', () => {
    const same: ComposeDraft = draft({ original: { id: 'my-agent', name: 'My agent', graph: draft().graph } })
    expect(composeDirty(same)).toBe(false)
    expect(composeDirty(draft({ name: 'renamed' }))).toBe(true)
    // A layout-only drag counts as a change, so the save button wakes for it.
    expect(composeDirty(draft({ graph: chainMoveNode(draft().graph, 'agent-1', { x: 400, y: 120 }) }))).toBe(true)
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
    expect(handoffBlocker(draft({ graph: emptyChainGraph('my-agent', 'My agent') }), roster)).toBe('noRows')
    expect(handoffBlocker(draft({ id: 'standard' }), roster)).toBe('idTaken')
  })

  it('allows an unchanged existing preset, unlike the save blocker', () => {
    const untouched = draft({ original: { id: 'my-agent', name: 'My agent', graph: draft().graph } })
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
    expect(state.composer).toMatchObject({ id: '', name: '', saving: false, error: null })
    expect(graphRows(state.composer!.graph)).toEqual([])
    expect(state.composer?.original).toEqual({ id: '', name: '', graph: emptyChainGraph('', '') })
  })

  it('opens an existing preset with its graph read from the wire', async () => {
    const { controller } = harness()
    await controller.load()

    await controller.beginCompose('mine')

    const composer = controller.store.getSnapshot().composer
    expect(composer).toMatchObject({
      id: 'mine', name: 'mine', saving: false, error: null,
    })
    expect(graphRows(composer!.graph)).toEqual([{ id: 'tool-read', name: '@deepseek-ai/dsh-tool-read' }])
    expect(composer?.original).toEqual({ id: 'mine', name: 'mine', graph: composer?.graph })
  })

  it('degrades the palette without disturbing an open edit', async () => {
    const { controller } = harness({ failPalette: true })
    await controller.load()

    await controller.beginCompose('mine')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().palette?.status).toBe('unavailable')
    })
    // The edit kept working against the graph even though the inventory that
    // feeds the palette never answered.
    expect(graphRows(controller.store.getSnapshot().composer!.graph))
      .toEqual([
        { id: 'tool-read', name: '@deepseek-ai/dsh-tool-read' },
        { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      ])
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

    const moved = graphRows(controller.store.getSnapshot().composer!.graph)
    expect(moved.map(row => row.name)).toEqual(['@deepseek-ai/dsh-tool-read', '@deepseek-ai/dsh-tool-bash'])

    controller.removeRow('tool-read')

    const kept = graphRows(controller.store.getSnapshot().composer!.graph)
    expect(kept.map(row => row.id)).toEqual(['tool-bash'])
  })

  it('removes a row by its module name when the node carried no id', async () => {
    const { controller, presets } = harness({ modules: paletteOf('@deepseek-ai/dsh-tool-read') })
    await controller.load()
    // A composition the host served without stable row ids: the removal falls
    // back to the module name, the way a legacy row reads.
    const mine = presets.get('mine')!
    const graph = mine.graph!
    mine.graph = {
      ...graph,
      nodes: graph.nodes.map(node => node.type === 'agent'
        ? { ...node, composition: { module: node.composition!.module } }
        : node),
    }

    await controller.beginCompose('mine')
    controller.removeRow('@deepseek-ai/dsh-tool-read')

    expect(graphRows(controller.store.getSnapshot().composer!.graph)).toEqual([])
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
    const payload = calls.find(call => call.method === 'saveGraph')?.payload as {
      agentPreset: string
      graph: FlowGraph
      name?: string
      overwrite: boolean
    }
    expect(payload).toBeDefined()
    expect(payload.agentPreset).toBe('my-agent')
    expect(payload.name).toBe('我的模式')
    expect(payload.overwrite).toBe(false)
    // The graph is stored beside the preset it belongs to, so its id follows
    // the target rather than the id the draft opened under.
    expect(payload.graph.id).toBe('my-agent')
    expect(graphRows(payload.graph)).toEqual([{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }])
  })

  it('omits an empty name so the composition falls back to its id', async () => {
    const { controller, calls } = harness()
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.setComposerName('   ')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    await controller.confirmCompose()

    const payload = calls.find(call => call.method === 'saveGraph')?.payload as {
      agentPreset: string
      graph: FlowGraph
      name?: string
      overwrite: boolean
    }
    expect(payload.agentPreset).toBe('my-agent')
    expect('name' in payload).toBe(false)
    expect(payload.overwrite).toBe(false)
    expect(graphRows(payload.graph)).toEqual([{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }])
  })

  it('overwrites an existing user preset in place', async () => {
    const { controller, calls, rosterChanges } = harness()
    await controller.load()
    await controller.beginCompose('mine')
    controller.removeRow('tool-read')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    await controller.confirmCompose()

    const payload = calls.find(call => call.method === 'saveGraph')?.payload as {
      agentPreset: string
      graph: FlowGraph
      name?: string
      overwrite: boolean
    }
    expect(payload.agentPreset).toBe('mine')
    // The preset published no name, so the composer opened on the id and
    // keeps it as the display name.
    expect(payload.name).toBe('mine')
    expect(payload.overwrite).toBe(true)
    expect(graphRows(payload.graph)).toEqual([{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }])
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
    controller.addNodeAt('@deepseek-ai/dsh-tool-bash', { x: 0, y: 0 })
    controller.removeRow('x')
    controller.removeNode('agent-1')
    controller.moveRow(0, 1)
    controller.moveNode('agent-1', { x: 0, y: 0 })
    controller.reorderNode('agent-1', 'agent-2')
    await controller.confirmCompose()

    expect(controller.store.getSnapshot().composer).toBeNull()
    expect(calls.some(call => call.method === 'saveGraph')).toBe(false)
  })

  it('folds a dead composition read into the page error', async () => {
    const { controller } = harness({ throwRead: true })
    await controller.load()

    await controller.beginCompose('mine')

    expect(controller.store.getSnapshot().composer).toBeNull()
    expect(controller.store.getSnapshot().error).toContain('socket closed')
  })

  it('drops, removes, moves, and reorders nodes through the canvas gestures', async () => {
    const { controller } = harness({ modules: paletteOf('@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })
    await controller.load()
    await controller.beginCompose(null)

    // The drop path appends at the graph position and refuses a spent module.
    const bashId = controller.addNodeAt('@deepseek-ai/dsh-tool-bash', { x: 400, y: 120 })
    expect(bashId).toBe('agent-1')
    expect(controller.addNodeAt('@deepseek-ai/dsh-tool-bash', { x: 420, y: 120 })).toBeUndefined()
    expect(controller.addRow('@deepseek-ai/dsh-tool-bash')).toBeUndefined()
    const readId = controller.addNodeAt('@deepseek-ai/dsh-tool-read', { x: 620, y: 120 })!
    expect(controller.store.getSnapshot().composer!.graph.nodes.find(node => node.id === bashId)?.position)
      .toEqual({ x: 400, y: 120 })

    // A remove for a row the composition never carried is a no-op.
    controller.removeRow('nope')

    // The drag gesture repositions without reordering the chain.
    controller.moveNode(bashId!, { x: 500, y: 40 })
    expect(controller.store.getSnapshot().composer!.graph.nodes.find(node => node.id === bashId)?.position)
      .toEqual({ x: 500, y: 40 })

    // The connect gesture relinks so the dropped node runs right after the source.
    controller.reorderNode(readId, bashId!)
    expect(graphRows(controller.store.getSnapshot().composer!.graph).map(row => row.name))
      .toEqual(['@deepseek-ai/dsh-tool-read', '@deepseek-ai/dsh-tool-bash'])

    // The delete key removes by canvas id.
    controller.removeNode(bashId!)
    expect(graphRows(controller.store.getSnapshot().composer!.graph).map(row => row.name))
      .toEqual(['@deepseek-ai/dsh-tool-read'])
  })

  it('refuses to submit while blocked or already saving', async () => {
    const { controller, calls } = harness()
    await controller.load()
    await controller.beginCompose(null)
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    // No id yet: the host would refuse the directory name, so the page does.
    expect(await controller.confirmCompose()).toBe(false)

    expect(calls.some(call => call.method === 'saveGraph')).toBe(false)
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

    expect(calls.filter(call => call.method === 'saveGraph')).toHaveLength(1)
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

describe('the model-kind routes', () => {
  const chain = (): FlowGraph => chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash')

  it('binds a provider and model onto a kind, preserving the node', () => {
    const bound = setAgentModelKind(chain(), 'agent-1', 'text', 'provider', 'deepseek')
    const boundModel = setAgentModelKind(bound, 'agent-1', 'text', 'model', 'deepseek-chat')

    const node = agentNode(boundModel, 'agent-1')
    expect(node?.agentOptions).toEqual({ modelKinds: { text: { provider: 'deepseek', model: 'deepseek-chat' } } })
    // The route rides the node's agentOptions; the composition and canvas
    // position the chain gave it are untouched.
    expect(node).toMatchObject({ id: 'agent-1', composition: { module: '@deepseek-ai/dsh-tool-bash' } })
  })

  it('keeps the other side when one side is edited', () => {
    const bound = setAgentModelKind(chain(), 'agent-1', 'text', 'provider', 'deepseek')

    const rebind = setAgentModelKind(bound, 'agent-1', 'text', 'model', 'deepseek-v3')

    expect(agentNode(rebind, 'agent-1')?.agentOptions)
      .toEqual({ modelKinds: { text: { provider: 'deepseek', model: 'deepseek-v3' } } })
  })

  it('keeps the bound side when the other is cleared', () => {
    const bound = setAgentModelKind(chain(), 'agent-1', 'text', 'provider', 'deepseek')
    const withModel = setAgentModelKind(bound, 'agent-1', 'text', 'model', 'deepseek-chat')

    const clearModel = setAgentModelKind(withModel, 'agent-1', 'text', 'model', '')

    expect(agentNode(clearModel, 'agent-1')?.agentOptions)
      .toEqual({ modelKinds: { text: { provider: 'deepseek' } } })
  })

  it('clearing both sides of a row drops the kind back to inherit', () => {
    const bound = setAgentModelKind(chain(), 'agent-1', 'text', 'provider', 'deepseek')
    const withModel = setAgentModelKind(bound, 'agent-1', 'text', 'model', 'deepseek-chat')
    const clearModel = setAgentModelKind(withModel, 'agent-1', 'text', 'model', '')
    const clearProvider = setAgentModelKind(clearModel, 'agent-1', 'text', 'provider', '')

    // The node is back to exactly what the chain carried before any edit; an
    // empty binding must not survive as a no-op that keeps the node "dirty".
    expect(agentNode(clearProvider, 'agent-1')?.agentOptions).toBeUndefined()
    expect(graphLayoutEqual(clearProvider, chain())).toBe(true)
  })

  it('leaves a graph alone for a missing or non-agent node', () => {
    const base = chain()

    expect(setAgentModelKind(base, 'agent-99', 'text', 'provider', 'deepseek')).toBe(base)
    expect(setAgentModelKind(base, 'end', 'text', 'provider', 'deepseek')).toBe(base)
  })

  it('counts a route edit as an authored change', () => {
    const base = chain()
    const bound = setAgentModelKind(base, 'agent-1', 'text', 'provider', 'deepseek')
    expect(graphLayoutEqual(base, bound)).toBe(false)
    const other = setAgentModelKind(base, 'agent-1', 'text', 'provider', 'openai')
    expect(graphLayoutEqual(bound, other)).toBe(false)
    // The same route on a freshly built graph is equal, whatever object identity.
    const same = setAgentModelKind(chain(), 'agent-1', 'text', 'provider', 'deepseek')
    expect(graphLayoutEqual(bound, same)).toBe(true)
  })
})

describe('the model catalog', () => {
  const MODEL_GROUPS: readonly ModelProviderGroup[] = [
    {
      id: 'deepseek', name: 'DeepSeek',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', kinds: ['text'] }],
    },
    {
      id: 'local', name: 'Local',
      models: [{ id: 'whisper', name: 'Whisper', kinds: ['audio'] }],
    },
  ]
  const roster: PresetRow[] = [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'mine', trust: 'user', isDefault: false },
  ]

  it('loads the configured provider groups and failures', async () => {
    const { controller, calls } = harness({ modelGroups: MODEL_GROUPS })
    await controller.load()
    await controller.beginCompose(null)

    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().modelCatalog?.status).toBe('ready')
    })
    expect(controller.store.getSnapshot().modelCatalog)
      .toEqual({ status: 'ready', groups: MODEL_GROUPS, failures: [] })
    expect(calls.some(call => call.method === 'llm.models')).toBe(true)
  })

  it('degrades to unavailable on a catalog refusal', async () => {
    const { controller } = harness({ failModels: 'catalog off' })
    await controller.load()
    await controller.beginCompose(null)

    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().modelCatalog?.status).toBe('unavailable')
    })
  })

  it('folds a dead transport into unavailable', async () => {
    const { controller } = harness({ throwModels: true })
    await controller.load()
    await controller.beginCompose(null)

    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().modelCatalog?.status).toBe('unavailable')
    })
  })

  it('keeps one catalog load in flight rather than stacking reads', async () => {
    const { controller, calls } = harness({ modelGroups: MODEL_GROUPS })
    await controller.load()

    await Promise.all([controller.loadModelCatalog(), controller.loadModelCatalog()])

    expect(calls.filter(call => call.method === 'llm.models')).toHaveLength(1)
  })

  it('loads the catalog with the read-only view, and closes it with the view', async () => {
    const { controller, calls } = harness({ modelGroups: MODEL_GROUPS })
    await controller.load()
    await controller.view('standard')
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().modelCatalog?.status).toBe('ready')
    })
    expect(calls.some(call => call.method === 'llm.models')).toBe(true)

    controller.closeView()

    expect(controller.store.getSnapshot().modelCatalog).toBeNull()
  })

  it('closes the catalog with the composer that loaded it', async () => {
    const { controller } = harness()
    await controller.load()
    await controller.beginCompose(null)
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().modelCatalog?.status).toBe('ready')
    })

    controller.closeComposer()

    expect(controller.store.getSnapshot().modelCatalog).toBeNull()
  })

  it('drops the catalog when the composition saves', async () => {
    const { controller } = harness()
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    controller.addRow('@deepseek-ai/dsh-tool-bash')

    await controller.confirmCompose()

    expect(controller.store.getSnapshot().modelCatalog).toBeNull()
  })

  it('edits the draft graph through the controller', async () => {
    const { controller } = harness()
    await controller.load()
    await controller.beginCompose(null)
    const nodeId = controller.addRow('@deepseek-ai/dsh-tool-bash')!
    controller.updateAgentModelKind(nodeId, 'text', 'provider', 'deepseek')
    controller.updateAgentModelKind(nodeId, 'text', 'model', 'deepseek-chat')

    const node = agentNode(controller.store.getSnapshot().composer!.graph, nodeId)
    expect(node?.agentOptions).toEqual({ modelKinds: { text: { provider: 'deepseek', model: 'deepseek-chat' } } })
  })

  it('saves the composition with the bound model kinds', async () => {
    const { controller, calls } = harness()
    await controller.load()
    await controller.beginCompose(null)
    controller.setComposerId('my-agent')
    const nodeId = controller.addRow('@deepseek-ai/dsh-tool-bash')!
    controller.updateAgentModelKind(nodeId, 'text', 'provider', 'deepseek')
    controller.updateAgentModelKind(nodeId, 'text', 'model', 'deepseek-chat')

    await controller.confirmCompose()

    const payload = calls.find(call => call.method === 'saveGraph')?.payload as { graph: FlowGraph }
    const node = agentNode(payload.graph, nodeId)
    expect(node?.agentOptions).toEqual({ modelKinds: { text: { provider: 'deepseek', model: 'deepseek-chat' } } })
  })

  it('wakes the save blocker from unchanged when a route is bound', () => {
    const base = chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash')
    const untouched = draft({ original: { id: 'my-agent', name: 'My agent', graph: base } })
    expect(composeBlocker(untouched, roster)).toBe('unchanged')

    const bound = setAgentModelKind(base, 'agent-1', 'text', 'provider', 'deepseek')
    expect(composeBlocker(
      draft({ graph: bound, original: { id: 'my-agent', name: 'My agent', graph: base } }),
      roster,
    )).toBeUndefined()
  })

  it('ignores a kind edit with no composer open', async () => {
    const { controller } = harness()
    await controller.load()

    controller.updateAgentModelKind('agent-1', 'text', 'provider', 'deepseek')

    expect(controller.store.getSnapshot().composer).toBeNull()
  })
})
