// @vitest-environment jsdom
/**
 * The three conversation-adjacent surfaces: the General-settings row naming the
 * default for later sessions, the new-session chip naming the next one's, and
 * the session header's read-only label. The split is the host's rule — a
 * session's history is produced under its preset's tools, so the choice is
 * only ever offered before one starts.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import { cascadePosition, chainAddModule, emptyChainGraph, setAgentModelKind } from '../src/client/preset-graph.ts'
import { AgentPresetLabel } from '../src/client/AgentPresetLabel.tsx'
import type { AgentPresetLabelProps } from '../src/client/AgentPresetLabel.tsx'
import { AgentPresetRow } from '../src/client/AgentPresetRow.tsx'
import type { AgentPresetRowProps } from '../src/client/AgentPresetRow.tsx'
import { AgentPresetSeat } from '../src/client/AgentPresetSeat.tsx'
import type { AgentPresetSeatProps } from '../src/client/AgentPresetSeat.tsx'
import { AgentPresetComposer } from '../src/client/AgentPresetComposer.tsx'
import type { AgentPresetComposerActions } from '../src/client/AgentPresetComposer.tsx'
import type { ComposeDraft, ComposePalette, ModelCatalog, PresetRow } from '../src/client/section-store.ts'
import type { AgentPresetSettingsState } from '../src/client/settings-store.ts'
import type { AgentPresetSeatState } from '../src/client/seat-store.ts'
import { en } from '../src/client/locales.ts'
import type { FlowCanvasProps, FlowCanvasSurface } from '@deepseek-ai/dsh-client-ui-flow-editor/client'

afterEach(cleanup)

// The composer drives the shared flow canvas (Part B rewrote it on React Flow,
// whose gesture fidelity belongs to that package's own jsdom spec). These specs
// assert the composer's wiring, so the canvas is a mock: it records the latest
// surface and picker hooks, then renders the graph nodes as data-node-id
// wrappers. Tests drive the surface and hooks directly and assert the rendered
// chain through the wrappers.
const flow: {
  surface: FlowCanvasSurface | null
  onAddNode: ((id: string) => void) | null
  onInsertBetween: ((from: string, to: string) => void) | null
} = { surface: null, onAddNode: null, onInsertBetween: null }

vi.mock('@deepseek-ai/dsh-client-ui-flow-editor/client', async () => {
  function MockCanvas(props: FlowCanvasProps) {
    flow.surface = props.surface
    flow.onAddNode = props.onAddNode ?? null
    flow.onInsertBetween = props.onInsertBetween ?? null
    const graph = props.surface.graph
    if (graph === null) return null
    return (
      <div className="mock-canvas">
        <div className="mock-canvas-bg" />
        {graph.nodes.map(node => (
          <div key={node.id} data-node-id={node.id}>{props.renderNode(node)}</div>
        ))}
      </div>
    )
  }
  return { FlowCanvas: MockCanvas }
})

beforeEach(() => {
  flow.surface = null
  flow.onAddNode = null
  flow.onInsertBetween = null
})

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

/** The composer palette fixture: three annotated installed modules. */
const PALETTE: ComposePalette = {
  status: 'ready',
  modules: [
    { moduleName: '@deepseek-ai/dsh-tool-bash', displayName: 'Bash' },
    { moduleName: '@deepseek-ai/dsh-tool-read', displayName: 'Read' },
    { moduleName: '@deepseek-ai/dsh-web-search', displayName: 'Web Search' },
  ],
}

/** The roster fixture: one shipped preset and one local one. */
const ROSTER: readonly PresetRow[] = [
  { id: 'standard', trust: 'system', isDefault: true },
  { id: 'mine', trust: 'user', isDefault: false },
]

/** The model catalog fixture: one group serving text and image, another audio and embedding. */
const MODEL_CATALOG: ModelCatalog = {
  status: 'ready',
  groups: [
    {
      id: 'deepseek', name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', kinds: ['text'] },
        { id: 'deepseek-vl', name: 'DeepSeek VL', kinds: ['image'] },
      ],
    },
    {
      id: 'local', name: 'Local',
      models: [
        { id: 'whisper', name: 'Whisper', kinds: ['audio'] },
        { id: 'local-embed', name: 'Local Embed', kinds: ['embedding'] },
      ],
    },
  ],
  failures: [],
}

const ROW_READY: AgentPresetSettingsState = {
  status: 'ready',
  error: null,
  writable: true,
  currentValue: 'standard',
  // `mine` deliberately names itself nothing: the row must fall back to the
  // id for a preset whose author wrote no metadata.
  options: [{ id: 'standard', trust: 'system', name: '标准模式' }, { id: 'mine', trust: 'user' }],
}

const SEAT_READY: AgentPresetSeatState = {
  current: 'standard',
  options: [
    { id: 'standard', trust: 'system', name: '标准模式', description: '完整的编码 agent。' },
    { id: 'mine', trust: 'user' },
  ],
  busy: false,
  error: null,
  introduce: false,
}

function renderRow(state: Partial<AgentPresetSettingsState> = {}) {
  const store = createSnapshotStore<AgentPresetSettingsState>({ ...ROW_READY, ...state })
  const actions = { load: vi.fn(() => Promise.resolve()), select: vi.fn(() => Promise.resolve()) }
  render(<AgentPresetRow {...({
    ...actions,
    useAgentPreset: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as AgentPresetRowProps)} />)
  return actions
}

function renderSeat(state: Partial<AgentPresetSeatState> = {}) {
  const store = createSnapshotStore<AgentPresetSeatState>({ ...SEAT_READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => Promise.resolve()),
    introduced: vi.fn(),
  }
  render(<AgentPresetSeat {...({
    ...actions,
    useAgentPresetSeat: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as AgentPresetSeatProps)} />)
  return actions
}

function renderLabel(
  summary: { blank: boolean; agentPreset?: string } | undefined,
  roster: Partial<AgentPresetSettingsState> = {},
) {
  // The chip and the label read the same roster, metadata included.
  const store = createSnapshotStore<AgentPresetSettingsState>({
    ...ROW_READY, options: SEAT_READY.options, ...roster,
  })
  const sessions = createSnapshotStore({ byId: summary === undefined ? {} : { s1: summary } })
  const load = vi.fn(() => Promise.resolve())
  const view = render(<AgentPresetLabel {...({
    load,
    sessionId: 's1',
    useSessions: bindSnapshotSelector(sessions),
    useAgentPresets: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as AgentPresetLabelProps)} />)
  return { load, view }
}

describe('the General-settings row', () => {
  it('reads the roster once and shows the current default', async () => {
    const actions = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('button').textContent).toContain(en.presetStandardName)
  })

  it('marks a locally authored option as local', () => {
    renderRow()

    fireEvent.click(screen.getByRole('button'))

    // A local preset is exactly as privileged as the plugins it names, so the
    // list says which rows are local rather than presenting all as vetted.
    expect(screen.getByText(`mine · ${en.userTrust}`)).toBeTruthy()
    // The shipped one carries no marker; only local rows are called out.
    expect(screen.getAllByText(en.presetStandardName)).toHaveLength(2)
  })

  it('falls back to the id for a preset that published no name', () => {
    renderRow({
      currentValue: 'mine',
      options: [
        { id: 'standard', trust: 'system', name: '标准模式' },
        { id: 'bare', trust: 'system' },
        { id: 'mine', trust: 'user' },
        { id: 'ours', trust: 'user', name: '团队模式' },
      ],
    })

    // The trigger names the preset; with no metadata the id is all there is.
    expect(screen.getByRole('button').textContent).toContain('mine')

    fireEvent.click(screen.getByRole('button'))

    // A locally authored preset is marked whether or not it named itself.
    expect(screen.getByText(`团队模式 · ${en.userTrust}`)).toBeTruthy()
    expect(screen.getByText(`mine · ${en.userTrust}`)).toBeTruthy()
    // A shipped preset with no metadata is listed by id and carries no mark.
    expect(screen.getByText('bare')).toBeTruthy()
  })

  it('shows the selected id until a stale roster contains it', () => {
    renderRow({ currentValue: 'arriving', options: [] })

    expect(screen.getByRole('button').textContent).toContain('arriving')
  })

  it('writes the picked preset and closes the menu', () => {
    const actions = renderRow()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.click(screen.getByText(`mine · ${en.userTrust}`))

    expect(actions.select).toHaveBeenCalledWith('mine')
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on an outside dismissal', () => {
    renderRow()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('says it is loading before the roster answers', () => {
    renderRow({ status: 'loading', currentValue: '' })

    expect(screen.getByRole('button').textContent).toContain(en.loading)
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })

  it('shows a failure in place of the description', () => {
    renderRow({ error: 'roster unavailable' })

    expect(screen.getByRole('alert').textContent).toBe('roster unavailable')
  })

  it('renders nothing when the deployment composes no presets', () => {
    const { container } = render(<AgentPresetRow {...({
      load: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => Promise.resolve()),
      useAgentPreset: bindSnapshotSelector(
        createSnapshotStore<AgentPresetSettingsState>({ ...ROW_READY, status: 'unavailable', options: [] })),
      t: (key: keyof typeof en) => en[key],
    } as unknown as AgentPresetRowProps)} />)

    expect(container.firstChild).toBeNull()
  })

  it('closes and locks the menu when the settings turn read-only', () => {
    const store = createSnapshotStore<AgentPresetSettingsState>(ROW_READY)
    render(<AgentPresetRow {...({
      load: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => Promise.resolve()),
      useAgentPreset: bindSnapshotSelector(store),
      t: (key: keyof typeof en) => en[key],
    } as unknown as AgentPresetRowProps)} />)
    fireEvent.click(screen.getByRole('button'))

    act(() => { store.set({ ...ROW_READY, writable: false }) })

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })
})

describe('the new-session chip', () => {
  it('reads the roster once and shows the staged preset by name', async () => {
    const actions = renderSeat()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('button').textContent).toContain(en.presetStandardName)
    expect(screen.getByRole('button').getAttribute('title')).toBe(en.seatHint)
  })

  it('offers each preset with what it is for', () => {
    renderSeat()

    fireEvent.click(screen.getByRole('button'))

    // The id alone never said what a preset does; the description is the
    // whole reason a preset can publish metadata at all.
    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
    // A preset that published none still reads as a row, with its id standing
    // in for the name.
    expect(screen.getByText(en.noDescription)).toBeTruthy()
    expect(screen.getByText('mine')).toBeTruthy()
  })

  it('falls back to the id when the staged preset published no name', () => {
    renderSeat({ current: 'mine' })

    expect(screen.getByRole('button').textContent).toContain('mine')
  })

  it('shows the staged id until a stale roster contains it', () => {
    renderSeat({ current: 'arriving' })

    expect(screen.getByRole('button').textContent).toContain('arriving')
  })

  it('stages the picked preset and closes the menu', () => {
    const actions = renderSeat()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.click(screen.getByText('mine'))

    expect(actions.select).toHaveBeenCalledWith('mine')
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('disables the trigger while a switch is in flight', () => {
    renderSeat({ busy: true })

    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })

  it('shows a refused switch on the trigger', () => {
    renderSeat({ error: 'session has already started' })

    expect(screen.getByRole('button').getAttribute('title')).toBe('session has already started')
  })

  it('renders nothing before the roster arrives or when there is none', () => {
    const empty = renderSeat({ options: [] })
    expect(empty).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    renderSeat({ current: '' })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('closes on an outside dismissal', () => {
    renderSeat()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the chip introduce cue', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Character spans carry inline animation delays; nothing else does. */
  function delayedChars(): HTMLElement[] {
    return Array.from(screen.getByRole('button').querySelectorAll<HTMLElement>('[style]'))
  }

  it('reveals a long Latin name inside the shared window, then acknowledges', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.useFakeTimers()
    const actions = renderSeat({
      current: 'creator',
      options: [{ id: 'creator', trust: 'user', name: 'CreatorMode' }],
      introduce: true,
    })

    // Eleven characters split the 200ms window into 20ms steps, where the
    // fixed 40ms tick would have doubled the run for a Latin name.
    const chars = delayedChars()
    expect(chars.map(span => span.textContent).join('')).toBe('CreatorMode')
    expect(chars[0]!.style.animationDelay).toBe('150ms')
    expect(chars[1]!.style.animationDelay).toBe('170ms')
    expect(chars[10]!.style.animationDelay).toBe('350ms')

    // 150 delay + 200 window + 400 fade: acknowledged only once the last
    // character has settled, and the label is plain text again after.
    act(() => { vi.advanceTimersByTime(749) })
    expect(actions.introduced).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(actions.introduced).toHaveBeenCalledTimes(1)
    expect(delayedChars()).toHaveLength(0)
  })

  it('keeps the per-tick cap for a short CJK name', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.useFakeTimers()
    renderSeat({
      current: 'creator',
      options: [{ id: 'creator', trust: 'user', name: '创造模式' }],
      introduce: true,
    })

    // Four characters fit under the window, so the 40ms tick applies as-is.
    const chars = delayedChars()
    expect(chars).toHaveLength(4)
    expect(chars[1]!.style.animationDelay).toBe('190ms')
    expect(chars[3]!.style.animationDelay).toBe('270ms')
  })

  it('starts a one-character name with no stagger at all', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.useFakeTimers()
    const actions = renderSeat({
      current: 'creator',
      options: [{ id: 'creator', trust: 'user', name: 'C' }],
      introduce: true,
    })

    expect(delayedChars()[0]!.style.animationDelay).toBe('150ms')
    act(() => { vi.advanceTimersByTime(550) })
    expect(actions.introduced).toHaveBeenCalledTimes(1)
  })

  it('skips the run under reduced motion and acknowledges at once', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const actions = renderSeat({ introduce: true })

    expect(actions.introduced).toHaveBeenCalledTimes(1)
    expect(delayedChars()).toHaveLength(0)
  })

  it('acknowledges an empty staged name without arming a run', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    const actions = renderSeat({
      current: 'creator',
      options: [{ id: 'creator', trust: 'user', name: '' }],
      introduce: true,
    })

    expect(actions.introduced).toHaveBeenCalledTimes(1)
    expect(delayedChars()).toHaveLength(0)
  })
})

describe('the session-header label', () => {
  it('names the preset the session runs, and never offers a switch', async () => {
    const { load } = renderLabel({ blank: false, agentPreset: 'standard' })

    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    // A control here would promise a switch the host refuses outright.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTitle(en.presetStandardDescription).textContent).toBe(en.presetStandardName)
  })

  it('falls back to the id, and to the generic hint, when metadata is absent', () => {
    renderLabel({ blank: true, agentPreset: 'mine' })

    expect(screen.getByTitle(en.headerHint).textContent).toBe('mine')
  })

  it('shows the id until the roster resolves it', () => {
    renderLabel({ blank: false, agentPreset: 'standard' }, { options: [] })

    // The session's own summary is the authority on which preset it runs; the
    // roster only supplies the display name, and its arrival is a later frame.
    expect(screen.getByTitle(en.headerHint).textContent).toBe('standard')
  })

  it('renders nothing, and reads no roster, when the session records no preset', async () => {
    const absent = renderLabel({ blank: true })
    expect(absent.view.container.firstChild).toBeNull()
    cleanup()

    // A session the list has not caught up to is the same answer: a deployment
    // that composes no presets must not pay for a roster read per header.
    const unknown = renderLabel(undefined)
    expect(unknown.view.container.firstChild).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(absent.load).not.toHaveBeenCalled()
    expect(unknown.load).not.toHaveBeenCalled()
  })
})

describe('the drag-and-drop composer', () => {
  const draft = (over: Partial<ComposeDraft> = {}): ComposeDraft => ({
    id: 'my-agent', name: 'My agent',
    graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash'),
    saving: false, error: null,
    original: { id: '', name: '', graph: emptyChainGraph('', '') },
    ...over,
  })

  /** A DataTransfer stub, since jsdom ships no drag payloads. */
  function dragData() {
    return {
      setData: vi.fn(),
      getData: vi.fn(() => ''),
      effectAllowed: 'none',
      dropEffect: 'none',
    }
  }

  /** Select one node through the canvas mock, as a click would. */
  function selectNode(id: string): void {
    act(() => { flow.surface!.selectNode(id) })
  }

  /** One node wrapper by its canvas id. */
  function nodeOf(id: string): HTMLElement {
    const node = document.querySelector(`[data-node-id="${id}"]`)
    if (node === null) throw new Error(`no node ${id}`)
    return node as HTMLElement
  }

  function renderComposer(
    state: Partial<ComposeDraft> = {},
    palette: ComposePalette | null = PALETTE,
    roster: readonly PresetRow[] = ROSTER,
    options: { handoff?: boolean } = {},
    modelCatalog: ModelCatalog | null = MODEL_CATALOG,
    addRowReturn?: string,
    addNodeAtReturn?: string,
    confirmReturns?: boolean,
  ) {
    const creatorDraft = options.handoff === true ? vi.fn() : undefined
    const actions: AgentPresetComposerActions = {
      closeComposer: vi.fn(),
      setComposerId: vi.fn(),
      setComposerName: vi.fn(),
      // The picker tests pin what id a picked module gets; the default is a
      // void stub so the palette's click path asserts the call, not a value.
      addRow: addRowReturn === undefined ? vi.fn() : vi.fn(() => addRowReturn),
      addNodeAt: addNodeAtReturn === undefined ? vi.fn() : vi.fn(() => addNodeAtReturn),
      removeRow: vi.fn(),
      removeNode: vi.fn(),
      moveRow: vi.fn(),
      moveNode: vi.fn(),
      reorderNode: vi.fn(),
      updateAgentModelKind: vi.fn(),
      confirmCompose: vi.fn(() => Promise.resolve(confirmReturns ?? true)),
      ...creatorDraft === undefined ? {} : { startCreatorDraft: creatorDraft },
    }
    // The handoff names the self-referential preset, so it appears only when
    // both the Creator flow and the cordis preset are present.
    const reachable: readonly PresetRow[] = options.handoff === true
      ? [...roster, { id: 'cordis', trust: 'system', isDefault: false }]
      : roster
    render(<AgentPresetComposer
      draft={draft(state)}
      palette={palette}
      modelCatalog={modelCatalog}
      roster={reachable}
      t={(key: keyof typeof en) => en[key]}
      actions={actions}
    />)
    return actions
  }

  it('renders the palette, the composition, and the fields', () => {
    const actions = renderComposer()
    const palette = screen.getByRole('heading', { name: en.palette }).closest('aside')!

    expect(screen.getByRole('heading', { name: en.newAgent })).toBeTruthy()
    // The palette annotates each module with a display name and the mono
    // specifier, so a card reads as the plugin it installs.
    expect(within(palette).getByText('Bash')).toBeTruthy()
    expect(within(palette).getByText('@deepseek-ai/dsh-tool-bash')).toBeTruthy()
    expect(within(palette).getByText('Read')).toBeTruthy()
    expect(within(palette).getByText('Web Search')).toBeTruthy()
    // The composition renders the module already in the draft as one node on
    // the flow canvas, in chain order.
    const node = nodeOf('agent-1')
    expect(within(node).getByText('Bash')).toBeTruthy()
    expect(within(node).getByText('@deepseek-ai/dsh-tool-bash')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText(en.presetIdPlaceholder), { target: { value: 'renamed' } })
    fireEvent.change(screen.getByPlaceholderText(en.displayNamePlaceholder), { target: { value: 'Renamed' } })
    expect(actions.setComposerId).toHaveBeenCalledWith('renamed')
    expect(actions.setComposerName).toHaveBeenCalledWith('Renamed')
  })

  it('titles an in-place edit as such', () => {
    renderComposer({ id: 'mine', original: { id: 'mine', name: 'mine', graph: draft().graph } })

    expect(screen.getByRole('heading', { name: en.composeTitle })).toBeTruthy()
    expect(screen.getByText(en.overwriteWarning)).toBeTruthy()
  })

  it('adds a row from the palette on click, and ignores an added module', () => {
    const actions = renderComposer()
    const palette = screen.getByRole('heading', { name: en.palette }).closest('aside')!

    fireEvent.click(within(palette).getByText('@deepseek-ai/dsh-tool-read'))
    expect(actions.addRow).toHaveBeenCalledWith('@deepseek-ai/dsh-tool-read')

    // The row already in the composition is marked, and clicking it adds nothing.
    expect(within(palette).getByText(en.rowAdded)).toBeTruthy()
    fireEvent.click(within(palette).getByText('@deepseek-ai/dsh-tool-bash'))
    expect(actions.addRow).toHaveBeenCalledTimes(1)
  })

  it('carries the module name on a palette drag', () => {
    renderComposer()
    const data = dragData()
    const palette = screen.getByRole('heading', { name: en.palette }).closest('aside')!

    fireEvent.dragStart(within(palette).getByText('@deepseek-ai/dsh-tool-read'), { dataTransfer: data })

    expect(data.setData).toHaveBeenCalledWith('text/plain', '@deepseek-ai/dsh-tool-read')
    expect(data.effectAllowed).toBe('copy')
  })

  it('drops a palette module on the canvas to append it', () => {
    const actions = renderComposer()

    act(() => { flow.surface!.addNodeAt('@deepseek-ai/dsh-web-search', { x: 280, y: 40 }) })

    // The drop IS the add: the surface appends the module at the graph point
    // it landed on, and the store selects the new node for the inspector.
    expect(actions.addNodeAt).toHaveBeenCalledWith('@deepseek-ai/dsh-web-search', { x: 280, y: 40 })
  })

  it('connects a port to run the dropped node after the source', () => {
    const actions = renderComposer({ graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })

    act(() => { flow.surface!.addEdge('agent-1', 'agent-2') })

    // The connect gesture IS the reorder: the chain relinks so the node the
    // gesture ended on runs right after the node the port came from.
    expect(actions.reorderNode).toHaveBeenCalledWith('agent-1', 'agent-2')
  })

  it('removes the selected node through the delete key', () => {
    const actions = renderComposer()
    selectNode('agent-1')

    act(() => { flow.surface!.removeNode('agent-1') })

    expect(actions.removeNode).toHaveBeenCalledWith('agent-1')
  })

  it('refuses to remove the chain terminals', () => {
    const actions = renderComposer()

    act(() => { flow.surface!.removeNode('start') })
    act(() => { flow.surface!.removeNode('end') })

    // The terminals are the composition's frame, not rows: a delete key
    // reaching them is a no-op, never a mutation of the chain.
    expect(actions.removeNode).not.toHaveBeenCalled()
  })

  it('renders an empty composition as the bare chain', () => {
    renderComposer({ graph: emptyChainGraph('', '') })

    // Nothing composed yet: the canvas holds the start and end terminals only.
    expect(nodeOf('start')).toBeTruthy()
    expect(nodeOf('end')).toBeTruthy()
    expect(document.querySelector('[data-node-id="agent-1"]')).toBeNull()
  })

  it('shows the selected node\'s details in the inspector', () => {
    renderComposer()
    // Nothing selected: the inspector is not on the stage at all — it floats
    // out over the canvas only while a node is selected.
    expect(screen.queryByRole('heading', { name: en.inspectorTitle })).toBeNull()

    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    expect(within(inspector).getByText(en.rowId)).toBeTruthy()
    expect(within(inspector).getByText('tool-bash')).toBeTruthy()
    expect(within(inspector).getByText('Bash')).toBeTruthy()
  })

  it('moves the selected node through the inspector', () => {
    const actions = renderComposer({ graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })
    selectNode('agent-2')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    // The last node cannot move down; moving it up is the point.
    const moveDown = within(inspector).getByRole('button', { name: en.moveDown })
    expect(moveDown).toHaveProperty('disabled', true)

    fireEvent.click(within(inspector).getByRole('button', { name: en.moveUp }))

    expect(actions.moveRow).toHaveBeenCalledWith(1, 0)
  })

  it('removes the selected node through the inspector', () => {
    const actions = renderComposer()
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    fireEvent.click(within(inspector).getByRole('button', { name: en.removeRow }))

    expect(actions.removeRow).toHaveBeenCalledWith('tool-bash')
  })

  it('annotates a selected node with the palette category and description', () => {
    renderComposer(
      {},
      {
        status: 'ready',
        modules: [
          { moduleName: '@deepseek-ai/dsh-tool-bash', displayName: 'Bash', category: 'tool', description: 'Runs shell commands.' },
        ],
      },
    )
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    expect(within(inspector).getByText('tool')).toBeTruthy()
    expect(within(inspector).getByText('Runs shell commands.')).toBeTruthy()
  })

  it('explains a node the palette does not know, by its row name', () => {
    const bare = chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash')
    // A composition the host served without a stable row id.
    const bareGraph: FlowGraph = {
      ...bare,
      nodes: bare.nodes.map(node => node.type === 'agent'
        ? { ...node, composition: { module: node.composition!.module } }
        : node),
    }
    const actions = renderComposer(
      { graph: bareGraph },
      { status: 'ready', modules: [{ moduleName: '@deepseek-ai/dsh-web-search', displayName: 'Web Search' }] },
    )
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    // No inventory annotation: the name falls back to the module, and with no
    // id the remove key names the module itself.
    expect(within(inspector).getByText('Bash')).toBeTruthy()
    expect(within(inspector).queryByText(en.rowId)).toBeNull()
    fireEvent.click(within(inspector).getByRole('button', { name: en.removeRow }))
    expect(actions.removeRow).toHaveBeenCalledWith('@deepseek-ai/dsh-tool-bash')
  })

  it('deselects on a canvas-background click', () => {
    renderComposer()
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    expect(within(inspector).getByText('tool-bash')).toBeTruthy()

    // A click on the canvas background, not on a node, is an explicit deselect
    // and the inspector floats away again.
    act(() => { flow.surface!.selectNode(null) })

    expect(screen.queryByRole('heading', { name: en.inspectorTitle })).toBeNull()
  })

  it('offers a provider and model picker per configured model kind', () => {
    renderComposer()
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    // The four kinds all have configured providers in the fixture, so all four
    // rows appear, each pairing a provider select with a model select.
    expect(within(inspector).getByText(en.modelKindText)).toBeTruthy()
    expect(within(inspector).getByText(en.modelKindImage)).toBeTruthy()
    expect(within(inspector).getByText(en.modelKindAudio)).toBeTruthy()
    expect(within(inspector).getByText(en.modelKindEmbedding)).toBeTruthy()
    expect(within(inspector).getAllByRole('combobox')).toHaveLength(8)
  })

  it('binds a provider through the picker, clearing a stale model', () => {
    const actions = renderComposer()
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    fireEvent.change(
      within(inspector).getByLabelText(`${en.modelKindText} · ${en.modelKindProvider}`),
      { target: { value: 'deepseek' } },
    )

    // A route is a provider/model pair: picking a provider also clears a model
    // that was bound under the old one.
    expect(actions.updateAgentModelKind).toHaveBeenNthCalledWith(1, 'agent-1', 'text', 'provider', 'deepseek')
    expect(actions.updateAgentModelKind).toHaveBeenNthCalledWith(2, 'agent-1', 'text', 'model', '')
  })

  it('lists the models the chosen provider serves', () => {
    const actions = renderComposer({
      graph: setAgentModelKind(chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash'), 'agent-1', 'text', 'provider', 'deepseek'),
    })
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    const modelSelect = within(inspector).getByLabelText(`${en.modelKindText} · ${en.modelKindModel}`) as HTMLSelectElement
    expect(modelSelect).toHaveProperty('disabled', false)
    // The bound provider's models, filtered to the kind, are what the select offers.
    expect([...modelSelect.options].map(option => option.value)).toEqual(['', 'deepseek-chat'])

    fireEvent.change(modelSelect, { target: { value: 'deepseek-chat' } })

    expect(actions.updateAgentModelKind).toHaveBeenCalledWith('agent-1', 'text', 'model', 'deepseek-chat')
  })

  it('inherits the node default through the placeholder option', () => {
    const actions = renderComposer({
      graph: setAgentModelKind(chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash'), 'agent-1', 'text', 'provider', 'deepseek'),
    })
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    fireEvent.change(
      within(inspector).getByLabelText(`${en.modelKindText} · ${en.modelKindProvider}`),
      { target: { value: '' } },
    )

    expect(actions.updateAgentModelKind).toHaveBeenNthCalledWith(1, 'agent-1', 'text', 'provider', '')
    expect(actions.updateAgentModelKind).toHaveBeenNthCalledWith(2, 'agent-1', 'text', 'model', '')
  })

  it('reports the catalog loading and unavailable states', () => {
    renderComposer({}, PALETTE, ROSTER, {}, { status: 'loading', groups: [], failures: [] })
    selectNode('agent-1')
    expect(within(screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!)
      .getByText(en.modelKindsLoading)).toBeTruthy()
    cleanup()

    renderComposer({}, PALETTE, ROSTER, {}, { status: 'unavailable', groups: [], failures: [] })
    selectNode('agent-1')
    expect(within(screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!)
      .getByText(en.modelKindsUnavailable)).toBeTruthy()
    cleanup()

    // A ready catalog with no configured providers reads as unavailable too.
    renderComposer({}, PALETTE, ROSTER, {}, { status: 'ready', groups: [], failures: [] })
    selectNode('agent-1')
    expect(within(screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!)
      .getByText(en.modelKindsUnavailable)).toBeTruthy()
  })

  it('collapses and reopens the palette overlay', () => {
    renderComposer()
    expect(screen.getByRole('heading', { name: en.palette })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.paletteCollapse }))
    expect(screen.queryByRole('heading', { name: en.palette })).toBeNull()
    expect(screen.getByRole('button', { name: en.paletteExpand })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.paletteExpand }))
    expect(screen.getByRole('heading', { name: en.palette })).toBeTruthy()
  })

  it('reports the palette loading, unavailable, and empty states', () => {
    renderComposer({}, { status: 'loading', modules: [] })
    expect(screen.getByText(en.paletteLoading)).toBeTruthy()
    cleanup()

    renderComposer({}, { status: 'unavailable', modules: [] })
    expect(screen.getByText(en.paletteUnavailable)).toBeTruthy()
    cleanup()

    renderComposer({}, { status: 'ready', modules: [] })
    expect(screen.getByText(en.paletteEmpty)).toBeTruthy()
  })

  it('filters the palette by the search box', () => {
    renderComposer()
    const palette = screen.getByRole('heading', { name: en.palette }).closest('aside')!
    const search = screen.getByPlaceholderText(en.paletteSearch)

    fireEvent.change(search, { target: { value: 'read' } })

    expect(within(palette).queryByText('@deepseek-ai/dsh-tool-bash')).toBeNull()
    expect(within(palette).getByText('@deepseek-ai/dsh-tool-read')).toBeTruthy()
    expect(within(palette).queryByText('@deepseek-ai/dsh-web-search')).toBeNull()
  })

  it('disables Save while blocked, and shows why', () => {
    const actions = renderComposer({ id: '' })

    const save = screen.getByRole('button', { name: en.save })
    expect(save).toHaveProperty('disabled', true)
    expect(screen.getByRole('alert').textContent).toBe(en.idRequired)
    fireEvent.click(save)
    expect(actions.confirmCompose).not.toHaveBeenCalled()
  })

  it('disables Save while a save is in flight', () => {
    const actions = renderComposer({ saving: true })

    fireEvent.click(screen.getByRole('button', { name: en.saving }))
    expect(actions.confirmCompose).not.toHaveBeenCalled()
  })

  it('submits through the controller once the composition is valid', () => {
    const actions = renderComposer()

    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(actions.confirmCompose).toHaveBeenCalledTimes(1)
  })

  it('shows a host refusal on the composer', () => {
    renderComposer({ error: 'preset my-agent already exists' })

    expect(screen.getByRole('alert').textContent).toBe('preset my-agent already exists')
  })

  it('closes through Back and through Cancel', () => {
    const actions = renderComposer()

    fireEvent.click(screen.getByRole('button', { name: en.back }))
    expect(actions.closeComposer).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(actions.closeComposer).toHaveBeenCalledTimes(2)
  })

  it('offers the handoff only when Creator mode is reachable', () => {
    renderComposer()
    expect(screen.queryByRole('button', { name: en.handoff })).toBeNull()
    cleanup()

    renderComposer({}, PALETTE, ROSTER, { handoff: true })
    expect(screen.getByRole('button', { name: en.handoff })).toBeTruthy()
  })

  it('disables the handoff while the draft cannot compose', () => {
    const actions = renderComposer({ id: '' }, PALETTE, ROSTER, { handoff: true })
    const creatorDraft = actions.startCreatorDraft as unknown as Mock

    const handoff = screen.getByRole('button', { name: en.handoff })
    expect(handoff).toHaveProperty('disabled', true)
    expect(handoff.getAttribute('title')).toBe(en.idRequired)
    fireEvent.click(handoff)
    expect(creatorDraft).not.toHaveBeenCalled()
  })

  it('hands a changed draft to Creator mode after saving it', async () => {
    const actions = renderComposer({}, PALETTE, ROSTER, { handoff: true })
    const creatorDraft = actions.startCreatorDraft as unknown as Mock

    fireEvent.click(screen.getByRole('button', { name: en.handoff }))

    expect(actions.confirmCompose).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(creatorDraft).toHaveBeenCalledTimes(1) })
  })

  it('hands an untouched preset to Creator mode without saving', async () => {
    const actions = renderComposer(
      { original: { id: 'my-agent', name: 'My agent', graph: draft().graph } },
      PALETTE, ROSTER, { handoff: true },
    )
    const creatorDraft = actions.startCreatorDraft as unknown as Mock

    fireEvent.click(screen.getByRole('button', { name: en.handoff }))

    await waitFor(() => { expect(creatorDraft).toHaveBeenCalledTimes(1) })
    expect(actions.confirmCompose).not.toHaveBeenCalled()
  })

  it('opens the node picker from a node add button, anchored on that node', () => {
    renderComposer()

    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { flow.onAddNode!('agent-1') })

    // The node "+" opens the same picker as the palette, anchored so a pick
    // inserts right after the node the button floated on.
    const dialog = screen.getByRole('dialog', { name: en.nodePickerTitle })
    expect(within(dialog).getByText(`${en.nodePickerAfter} agent-1`)).toBeTruthy()
  })

  it('opens the node picker from an edge insert button, anchored on the edge source', () => {
    renderComposer({ graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })

    act(() => { flow.onInsertBetween!('agent-1', 'agent-2') })

    // Inserting between two nodes is inserting after the earlier one; the
    // picker names the source as the anchor.
    const dialog = screen.getByRole('dialog', { name: en.nodePickerTitle })
    expect(within(dialog).getByText(`${en.nodePickerAfter} agent-1`)).toBeTruthy()
  })

  it('inserts a picked module right after the anchor node', () => {
    const actions = renderComposer(
      { graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') },
      PALETTE, ROSTER, {}, MODEL_CATALOG, 'agent-3',
    )
    act(() => { flow.onAddNode!('agent-1') })
    const dialog = screen.getByRole('dialog', { name: en.nodePickerTitle })

    fireEvent.click(within(dialog).getByRole('button', { name: /@deepseek-ai\/dsh-web-search/ }))

    expect(actions.addRow).toHaveBeenCalledWith('@deepseek-ai/dsh-web-search')
    // The new node starts at the chain tail (index 2) and moves to follow
    // agent-1 (slot 1).
    expect(actions.moveRow).toHaveBeenCalledWith(2, 1)
    // A picked node is the new selection, and the picker closes.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('appends a picked module at the tail when anchored on the end terminal', () => {
    const actions = renderComposer({}, PALETTE, ROSTER, {}, MODEL_CATALOG, 'agent-2')
    act(() => { flow.onAddNode!('end') })
    const dialog = screen.getByRole('dialog', { name: en.nodePickerTitle })

    fireEvent.click(within(dialog).getByRole('button', { name: /@deepseek-ai\/dsh-tool-read/ }))

    // The end terminal keeps the tail: the append already put the new node
    // last, so no chain move is needed.
    expect(actions.addRow).toHaveBeenCalledWith('@deepseek-ai/dsh-tool-read')
    expect(actions.moveRow).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('adds a picked module after start without a redundant move', () => {
    const actions = renderComposer(
      { graph: emptyChainGraph('my-agent', 'My agent') },
      PALETTE, ROSTER, {}, MODEL_CATALOG, 'agent-1',
    )
    act(() => { flow.onAddNode!('start') })
    const dialog = screen.getByRole('dialog', { name: en.nodePickerTitle })

    fireEvent.click(within(dialog).getByRole('button', { name: /@deepseek-ai\/dsh-tool-bash/ }))

    // The new node is the chain's first (slot 0) as added, so the start
    // anchor needs no move either.
    expect(actions.addRow).toHaveBeenCalledWith('@deepseek-ai/dsh-tool-bash')
    expect(actions.moveRow).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a plugin\'s one-line description on its node card', () => {
    const described: ComposePalette = {
      status: 'ready',
      modules: [{ moduleName: '@deepseek-ai/dsh-tool-bash', displayName: 'Bash', description: '持久 bash 会话。' }],
    }
    renderComposer({}, described)

    expect(within(nodeOf('agent-1')).getByText('持久 bash 会话。')).toBeTruthy()
  })

  it('drops an edge selection whose edge the graph no longer carries', () => {
    renderComposer()

    act(() => { flow.surface!.selectEdge('nope') })

    // A selection outlives its edge only by accident: the id never existed in
    // this graph, so it reads back as no selection.
    expect(flow.surface!.selectedEdgeId).toBeNull()
  })

  it('swallows the removeEdge gesture for preset chains', () => {
    const actions = renderComposer({ graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })

    act(() => { flow.surface!.removeEdge('e-0') })

    // A preset chain's edges are implicit in the row order, so the gesture is
    // a no-op that only clears the edge selection.
    expect(actions.removeNode).not.toHaveBeenCalled()
    expect(flow.surface!.selectedEdgeId).toBeNull()
  })

  it('selects the node a canvas drop adds, for the inspector', () => {
    const actions = renderComposer({}, PALETTE, ROSTER, {}, MODEL_CATALOG, undefined, 'agent-1')

    act(() => { flow.surface!.addNodeAt('@deepseek-ai/dsh-web-search', { x: 280, y: 40 }) })

    // The drop IS the add, and the add answers with the new node id — the
    // surface selects it so it lands under the inspector, Dify-style.
    expect(actions.addNodeAt).toHaveBeenCalledWith('@deepseek-ai/dsh-web-search', { x: 280, y: 40 })
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    expect(within(inspector).getByText('tool-bash')).toBeTruthy()
  })

  it('selects the row a palette click adds, for the inspector', () => {
    const actions = renderComposer({}, PALETTE, ROSTER, {}, MODEL_CATALOG, 'agent-1')
    const palette = screen.getByRole('heading', { name: en.palette }).closest('aside')!

    fireEvent.click(within(palette).getByText('@deepseek-ai/dsh-tool-read'))

    expect(actions.addRow).toHaveBeenCalledWith('@deepseek-ai/dsh-tool-read')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    expect(within(inspector).getByText('tool-bash')).toBeTruthy()
  })

  it('hints the handoff when the composition is empty and Creator mode is reachable', () => {
    renderComposer({ graph: emptyChainGraph('my-agent', 'My agent') }, PALETTE, ROSTER, { handoff: true })

    expect(screen.getByText(en.handoffHint)).toBeTruthy()
  })

  it('keeps the draft in the composer when the handoff save is refused', async () => {
    const actions = renderComposer({}, PALETTE, ROSTER, { handoff: true }, MODEL_CATALOG, undefined, undefined, false)
    const creatorDraft = actions.startCreatorDraft as unknown as Mock

    fireEvent.click(screen.getByRole('button', { name: en.handoff }))

    await waitFor(() => { expect(actions.confirmCompose).toHaveBeenCalledTimes(1) })
    expect(creatorDraft).not.toHaveBeenCalled()
  })

  it('renders nothing for flow-only nodes a preset composition never composes', () => {
    renderComposer({
      graph: {
        id: 'my-agent', name: 'My agent',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'branch', type: 'condition', position: { x: 220, y: 0 }, expression: 'args.flag' },
          { id: 'end', type: 'end', position: { x: 440, y: 0 } },
          { id: 'orphan', type: 'agent', position: { x: 220, y: 120 }, prompt: '' },
        ],
        edges: [
          { id: 'e-start', from: 'start', to: 'branch' },
          { id: 'e-true', from: 'branch', to: 'end', label: 'true' },
        ],
      },
    })

    // The shared canvas knows condition/loop nodes, which a preset composition
    // never composes; an agent node without a composition row is likewise not
    // a row. Both render as empty cards on the stage.
    expect(nodeOf('branch').textContent).toBe('')
    expect(nodeOf('orphan').textContent).toBe('')
  })

  it('closes the node picker without picking', () => {
    renderComposer()
    act(() => { flow.onAddNode!('agent-1') })
    const dialog = screen.getByRole('dialog', { name: en.nodePickerTitle })

    fireEvent.click(within(dialog).getByRole('button', { name: en.close }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders a bullet monogram for a module that published no display name', () => {
    const blank: ComposePalette = {
      status: 'ready',
      modules: [{ moduleName: '@deepseek-ai/dsh-tool-bash', displayName: '' }],
    }
    renderComposer({}, blank)

    // The display name is empty, so the node's monogram falls back to a bullet.
    expect(within(nodeOf('agent-1')).getByText('•')).toBeTruthy()
  })

  it('refuses to drag a module already in the composition', () => {
    renderComposer()
    const data = dragData()
    const palette = screen.getByRole('heading', { name: en.palette }).closest('aside')!

    fireEvent.dragStart(within(palette).getByText('@deepseek-ai/dsh-tool-bash'), { dataTransfer: data })

    expect(data.setData).not.toHaveBeenCalled()
    expect(data.effectAllowed).toBe('none')
  })

  it('badges a palette module with its spine category', () => {
    const categorized: ComposePalette = {
      status: 'ready',
      modules: [{ moduleName: '@deepseek-ai/dsh-tool-bash', displayName: 'Bash', category: 'shell' }],
    }
    renderComposer({}, categorized)
    const palette = screen.getByRole('heading', { name: en.palette }).closest('aside')!

    // The category names the palette group AND badges the module card.
    expect(within(palette).getAllByText('shell')).toHaveLength(2)
  })

  it('moves the selected node down through the inspector', () => {
    const actions = renderComposer({ graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-read') })
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    const moveDown = within(inspector).getByRole('button', { name: en.moveDown })
    expect(moveDown).toHaveProperty('disabled', false)
    fireEvent.click(moveDown)

    expect(actions.moveRow).toHaveBeenCalledWith(0, 1)
  })

  it('serves text to a model that declared no kinds', () => {
    const bare: ModelCatalog = {
      status: 'ready',
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
      failures: [],
    }
    renderComposer(
      {
        graph: setAgentModelKind(chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash'), 'agent-1', 'text', 'provider', 'deepseek'),
      },
      PALETTE, ROSTER, {}, bare,
    )
    selectNode('agent-1')
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    // A model that declares no kinds serves text by default.
    const modelSelect = within(inspector).getByLabelText(`${en.modelKindText} · ${en.modelKindModel}`) as HTMLSelectElement
    expect([...modelSelect.options].map(option => option.value)).toEqual(['', 'deepseek-chat'])
  })
})

describe('the read-only composer (a shipped preset\'s view)', () => {
  /** A view draft, mirroring what the section derives from a shipped preset. */
  const viewDraft = (over: Partial<ComposeDraft> = {}): ComposeDraft => ({
    id: 'standard', name: '标准模式',
    graph: chainGraph('standard', '标准模式', '@deepseek-ai/dsh-tool-bash'),
    saving: false, error: null,
    original: { id: 'standard', name: '标准模式', graph: emptyChainGraph('standard', '标准模式') },
    ...over,
  })

  function renderView(over: Partial<ComposeDraft> = {}, modelCatalog: ModelCatalog | null = MODEL_CATALOG) {
    const actions: AgentPresetComposerActions = {
      closeComposer: vi.fn(),
      setComposerId: vi.fn(),
      setComposerName: vi.fn(),
      addRow: vi.fn(),
      addNodeAt: vi.fn(),
      removeRow: vi.fn(),
      removeNode: vi.fn(),
      moveRow: vi.fn(),
      moveNode: vi.fn(),
      reorderNode: vi.fn(),
      updateAgentModelKind: vi.fn(),
      confirmCompose: vi.fn(() => Promise.resolve(false)),
    }
    render(<AgentPresetComposer
      readOnly
      draft={viewDraft(over)}
      palette={PALETTE}
      modelCatalog={modelCatalog}
      roster={ROSTER}
      t={(key: keyof typeof en) => en[key]}
      actions={actions}
    />)
    return actions
  }

  it('renders a shipped composition as a design page', () => {
    renderView()

    // The head names the preset under the view title; the body is the same
    // flow canvas an edit shows, with the chain as start, the plugin, and end.
    expect(screen.getByRole('heading', { name: `${en.view} · 标准模式` })).toBeTruthy()
    expect(screen.getByText(en.compositionLabel)).toBeTruthy()
    const node = document.querySelector('[data-node-id="agent-1"]')
    expect(node).toBeTruthy()
    expect(within(node as HTMLElement).getByText('Bash')).toBeTruthy()
  })

  it('renders no palette, fields, or footer', () => {
    renderView()

    expect(screen.queryByRole('heading', { name: en.palette })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
    expect(screen.queryByRole('button', { name: en.handoff })).toBeNull()
    expect(screen.queryByRole('button', { name: en.cancel })).toBeNull()
  })

  it('renders the chain legible but not editable: no ports, no node actions', () => {
    renderView()

    // The shipped composition is the known-good copy source, so its chain is
    // legible but cannot be reordered or removed from. Selection still works —
    // the inspector explains a node — but the editable affordances are gone:
    // the canvas receives no picker hooks, so no node "+" and no edge "+".
    expect(document.querySelector('[data-node-id="agent-1"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.connectLabel })).toBeNull()
    expect(screen.queryByRole('button', { name: en.removeRow })).toBeNull()
    expect(flow.onAddNode).toBeNull()
    expect(flow.onInsertBetween).toBeNull()
  })

  it('explains a selected node without the edit actions', () => {
    renderView()

    act(() => { flow.surface!.selectNode('agent-1') })
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    expect(within(inspector).getByText(en.rowId)).toBeTruthy()
    expect(within(inspector).queryByRole('button', { name: en.moveUp })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: en.moveDown })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: en.removeRow })).toBeNull()
  })

  it('shows the model routes without pickers in the read-only view', () => {
    renderView({ graph: setAgentModelKind(viewDraft().graph, 'agent-1', 'text', 'provider', 'deepseek') })

    act(() => { flow.surface!.selectNode('agent-1') })
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    // The bound route reads as provider / model; every unbound kind reads as
    // inherit, and nothing here is a picker.
    expect(within(inspector).getByText(`DeepSeek / ${en.modelKindInherit}`)).toBeTruthy()
    expect(within(inspector).getAllByText(en.modelKindInherit)).toHaveLength(3)
    expect(within(inspector).queryByRole('combobox')).toBeNull()
  })

  it('shows a fully bound route by provider and model names', () => {
    const routed = setAgentModelKind(
      setAgentModelKind(viewDraft().graph, 'agent-1', 'text', 'provider', 'deepseek'),
      'agent-1', 'text', 'model', 'deepseek-chat',
    )
    renderView({ graph: routed })
    act(() => { flow.surface!.selectNode('agent-1') })

    // Both sides of the route resolve against the catalog, so the read-only
    // text names the provider and the model rather than their raw ids.
    expect(screen.getByText('DeepSeek / DeepSeek Chat')).toBeTruthy()
  })

  it('resolves a bound model under an inherited provider', () => {
    renderView({ graph: setAgentModelKind(viewDraft().graph, 'agent-1', 'text', 'model', 'deepseek-chat') })

    act(() => { flow.surface!.selectNode('agent-1') })
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    // The route reads provider / model; a provider the node never bound reads
    // as inherit, and the model resolves raw because no group hosts an
    // inherited provider.
    expect(within(inspector).getByText(`${en.modelKindInherit} / deepseek-chat`)).toBeTruthy()
  })

  it('falls back to the raw route when the catalog knows neither side', () => {
    const routed = setAgentModelKind(
      setAgentModelKind(viewDraft().graph, 'agent-1', 'text', 'provider', 'nope'),
      'agent-1', 'text', 'model', 'x',
    )
    renderView({ graph: routed })

    act(() => { flow.surface!.selectNode('agent-1') })
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    // A provider and model the catalog does not serve resolve to themselves;
    // the read-only view never guesses a display name for an unknown route.
    expect(within(inspector).getByText('nope / x')).toBeTruthy()
  })

  it('closes through Back', () => {
    const actions = renderView()

    fireEvent.click(screen.getByRole('button', { name: en.back }))

    expect(actions.closeComposer).toHaveBeenCalledTimes(1)
  })
})
