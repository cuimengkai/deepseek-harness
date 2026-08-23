// @vitest-environment jsdom
/**
 * The three conversation-adjacent surfaces: the General-settings row naming the
 * default for later sessions, the new-session chip naming the next one's, and
 * the session header's read-only label. The split is the host's rule — a
 * session's history is produced under its preset's tools, so the choice is
 * only ever offered before one starts.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { AgentPresetLabel } from '../src/client/AgentPresetLabel.tsx'
import type { AgentPresetLabelProps } from '../src/client/AgentPresetLabel.tsx'
import { AgentPresetRow } from '../src/client/AgentPresetRow.tsx'
import type { AgentPresetRowProps } from '../src/client/AgentPresetRow.tsx'
import { AgentPresetSeat } from '../src/client/AgentPresetSeat.tsx'
import type { AgentPresetSeatProps } from '../src/client/AgentPresetSeat.tsx'
import { AgentPresetComposer } from '../src/client/AgentPresetComposer.tsx'
import type { AgentPresetComposerActions } from '../src/client/AgentPresetComposer.tsx'
import type { ComposeDraft, ComposePalette, PresetRow } from '../src/client/section-store.ts'
import type { AgentPresetSettingsState } from '../src/client/settings-store.ts'
import type { AgentPresetSeatState } from '../src/client/seat-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

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
    rows: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }],
    saving: false, error: null,
    original: { id: '', name: '', rows: [] },
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

  function renderComposer(
    state: Partial<ComposeDraft> = {},
    palette: ComposePalette | null = PALETTE,
    roster: readonly PresetRow[] = ROSTER,
    options: { handoff?: boolean } = {},
  ) {
    const creatorDraft = options.handoff === true ? vi.fn() : undefined
    const actions: AgentPresetComposerActions = {
      closeComposer: vi.fn(),
      setComposerId: vi.fn(),
      setComposerName: vi.fn(),
      addRow: vi.fn(),
      insertRowAt: vi.fn(),
      removeRow: vi.fn(),
      moveRow: vi.fn(),
      confirmCompose: vi.fn(() => Promise.resolve(true)),
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
    // the pipeline canvas, in chain order.
    const node = screen.getByTitle(en.reorderHint)
    expect(within(node).getByText('Bash')).toBeTruthy()
    expect(within(node).getByText('@deepseek-ai/dsh-tool-bash')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText(en.presetIdPlaceholder), { target: { value: 'renamed' } })
    fireEvent.change(screen.getByPlaceholderText(en.displayNamePlaceholder), { target: { value: 'Renamed' } })
    expect(actions.setComposerId).toHaveBeenCalledWith('renamed')
    expect(actions.setComposerName).toHaveBeenCalledWith('Renamed')
  })

  it('titles an in-place edit as such', () => {
    renderComposer({ id: 'mine', original: { id: 'mine', name: 'mine', rows: draft().rows } })

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

  it('inserts a dropped palette module at the slot under the pointer', () => {
    const actions = renderComposer()
    const data = dragData()
    data.getData.mockReturnValue('@deepseek-ai/dsh-web-search')

    // jsdom lays nothing out, so every midpoint is 0 and a drop past the end
    // lands in the last slot — the end of the one-row chain.
    fireEvent.drop(screen.getByTitle(en.reorderHint), { clientX: 20, dataTransfer: data })

    expect(actions.insertRowAt).toHaveBeenCalledWith('@deepseek-ai/dsh-web-search', 1)
  })

  it('reorders the composition when a row is dragged to a new slot', () => {
    const actions = renderComposer({
      rows: [
        { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
        { id: 'tool-read', name: '@deepseek-ai/dsh-tool-read' },
      ],
    })
    const data = dragData()
    const nodes = screen.getAllByTitle(en.reorderHint)

    fireEvent.dragStart(nodes[0]!, { dataTransfer: data })
    // jsdom lays nothing out, so every midpoint is 0 and a drop past the end
    // lands in the last slot.
    fireEvent.drop(nodes[0]!, { clientX: 100, dataTransfer: data })

    expect(actions.moveRow).toHaveBeenCalledWith(0, 2)
  })

  it('removes a row through the × action', () => {
    const actions = renderComposer()

    fireEvent.click(screen.getByRole('button', { name: `${en.removeRow}: @deepseek-ai/dsh-tool-bash` }))

    expect(actions.removeRow).toHaveBeenCalledWith('tool-bash')
  })

  it('keeps the drop hint when the composition is empty', () => {
    renderComposer({ rows: [] })

    expect(screen.getByText(en.compositionEmpty)).toBeTruthy()
  })

  it('shows the selected node\'s details in the inspector', () => {
    renderComposer()
    // Nothing selected: the inspector is not on the stage at all — it floats
    // out over the canvas only while a node is selected.
    expect(screen.queryByRole('heading', { name: en.inspectorTitle })).toBeNull()

    fireEvent.click(screen.getByTitle(en.reorderHint))
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    expect(within(inspector).getByText(en.rowId)).toBeTruthy()
    expect(within(inspector).getByText('tool-bash')).toBeTruthy()
    expect(within(inspector).getByText('Bash')).toBeTruthy()
  })

  it('moves the selected node through the inspector', () => {
    const actions = renderComposer({
      rows: [
        { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
        { id: 'tool-read', name: '@deepseek-ai/dsh-tool-read' },
      ],
    })
    fireEvent.click(screen.getAllByTitle(en.reorderHint)[1]!)
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    // The last node cannot move down; moving it up is the point.
    const moveDown = within(inspector).getByRole('button', { name: en.moveDown })
    expect(moveDown).toHaveProperty('disabled', true)

    fireEvent.click(within(inspector).getByRole('button', { name: en.moveUp }))

    expect(actions.moveRow).toHaveBeenCalledWith(1, 0)
  })

  it('removes the selected node through the inspector', () => {
    const actions = renderComposer()
    fireEvent.click(screen.getByTitle(en.reorderHint))
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!

    fireEvent.click(within(inspector).getByRole('button', { name: en.removeRow }))

    expect(actions.removeRow).toHaveBeenCalledWith('tool-bash')
  })

  it('deselects on a canvas-background click', () => {
    renderComposer()
    fireEvent.click(screen.getByTitle(en.reorderHint))
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    expect(within(inspector).getByText('tool-bash')).toBeTruthy()

    // A click on the canvas background, not on a node, is an explicit deselect
    // and the inspector floats away again. The head label now sits above the
    // canvas, so reach the background by its data attribute, not a heading's
    // ancestor.
    fireEvent.click(document.querySelector<HTMLElement>('[data-canvas]')!)

    expect(screen.queryByRole('heading', { name: en.inspectorTitle })).toBeNull()
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
      { original: { id: 'my-agent', name: 'My agent', rows: draft().rows } },
      PALETTE, ROSTER, { handoff: true },
    )
    const creatorDraft = actions.startCreatorDraft as unknown as Mock

    fireEvent.click(screen.getByRole('button', { name: en.handoff }))

    await waitFor(() => { expect(creatorDraft).toHaveBeenCalledTimes(1) })
    expect(actions.confirmCompose).not.toHaveBeenCalled()
  })
})

describe('the read-only composer (a shipped preset\'s view)', () => {
  /** A view draft, mirroring what the section derives from a shipped preset. */
  const viewDraft = (over: Partial<ComposeDraft> = {}): ComposeDraft => ({
    id: 'standard', name: '标准模式',
    rows: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }],
    saving: false, error: null,
    original: { id: 'standard', name: '标准模式', rows: [] },
    ...over,
  })

  function renderView(over: Partial<ComposeDraft> = {}) {
    const actions: AgentPresetComposerActions = {
      closeComposer: vi.fn(),
      setComposerId: vi.fn(),
      setComposerName: vi.fn(),
      addRow: vi.fn(),
      insertRowAt: vi.fn(),
      removeRow: vi.fn(),
      moveRow: vi.fn(),
      confirmCompose: vi.fn(() => Promise.resolve(false)),
    }
    render(<AgentPresetComposer
      readOnly
      draft={viewDraft(over)}
      palette={PALETTE}
      roster={ROSTER}
      t={(key: keyof typeof en) => en[key]}
      actions={actions}
    />)
    return actions
  }

  it('renders a shipped composition as a design page', () => {
    renderView()

    // The head names the preset under the view title; the body is the same
    // pipeline canvas an edit shows, with the row as one chain node.
    expect(screen.getByRole('heading', { name: `${en.view} · 标准模式` })).toBeTruthy()
    expect(screen.getByText(en.compositionLabel)).toBeTruthy()
    const node = document.querySelector<HTMLElement>('[data-row-id="tool-bash"]')
    expect(node).toBeTruthy()
    expect(within(node!).getByText('Bash')).toBeTruthy()
  })

  it('renders no palette, fields, or footer', () => {
    renderView()

    expect(screen.queryByRole('heading', { name: en.palette })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
    expect(screen.queryByRole('button', { name: en.handoff })).toBeNull()
    expect(screen.queryByRole('button', { name: en.cancel })).toBeNull()
  })

  it('renders the nodes non-draggable with no remove control', () => {
    renderView()

    const node = document.querySelector('[data-row-id="tool-bash"]')
    expect(node?.getAttribute('draggable')).toBe('false')
    expect(screen.queryByRole('button', { name: new RegExp(`^${en.removeRow}:`) })).toBeNull()
  })

  it('explains a selected node without the edit actions', () => {
    renderView()

    fireEvent.click(document.querySelector<HTMLElement>('[data-row-id="tool-bash"]')!)
    const inspector = screen.getByRole('heading', { name: en.inspectorTitle }).closest('aside')!
    expect(within(inspector).getByText(en.rowId)).toBeTruthy()
    expect(within(inspector).queryByRole('button', { name: en.moveUp })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: en.moveDown })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: en.removeRow })).toBeNull()
  })

  it('closes through Back', () => {
    const actions = renderView()

    fireEvent.click(screen.getByRole('button', { name: en.back }))

    expect(actions.closeComposer).toHaveBeenCalledTimes(1)
  })
})
