// @vitest-environment jsdom
/**
 * The management section's rendering rules: which actions a row offers depends
 * on its trust, a shipped composition opens as a read-only design page, creation is
 * a copy dialog that collects an id and an optional name, and the location
 * action follows the host's desktop capability.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import { cascadePosition, chainAddModule, emptyChainGraph } from '../src/client/preset-graph.ts'
import { AgentPresetSection } from '../src/client/AgentPresetSection.tsx'
import type { AgentPresetSectionProps } from '../src/client/AgentPresetSection.tsx'
import type { AgentPresetSectionState, ComposeDraft, ComposePalette, CopyDraft } from '../src/client/section-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const READY: AgentPresetSectionState = {
  status: 'ready',
  error: null,
  authorable: true,
  hasDocument: true,
  rows: [
    { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '完整的编码 agent。' },
    { id: 'mine', trust: 'user', isDefault: false },
  ],
  copy: null,
  view: null,
  composer: null,
  palette: null,
  pendingDelete: null,
  deleting: false,
  revealedPaths: {},
}

/**
 * Render the section over a fixed snapshot, with every action a spy.
 * @param state - the snapshot to render.
 * @returns the spies, so a test can assert what a click reached.
 */
function renderSection(
  state: Partial<AgentPresetSectionState> = {},
  options: { creator?: boolean } = {},
) {
  const store = createSnapshotStore<AgentPresetSectionState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    // The shell-owned section affordance (SettingsSectionOwnerProps.close).
    close: vi.fn(),
    ...options.creator === false ? {} : { startCreatorDraft: vi.fn() },
    view: vi.fn(() => Promise.resolve()),
    closeView: vi.fn(),
    beginCopy: vi.fn(),
    cancelCopy: vi.fn(),
    setCopyId: vi.fn(),
    setCopyName: vi.fn(),
    confirmCopy: vi.fn(() => Promise.resolve()),
    beginCompose: vi.fn(() => Promise.resolve()),
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
    confirmCompose: vi.fn(() => Promise.resolve(true)),
    openLocation: vi.fn(() => Promise.resolve()),
    confirmDelete: vi.fn(),
    remove: vi.fn(() => Promise.resolve()),
    makeDefault: vi.fn(() => Promise.resolve()),
  }
  const props = {
    ...actions,
    useAgentPresetSection: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as AgentPresetSectionProps
  render(<AgentPresetSection {...props} />)
  return actions
}

/** Locate a card by the id it prints, not by its display name. */
function rowFor(id: string): HTMLElement {
  const key = screen.getAllByText(id).find(node => node.tagName === 'CODE')
  const row = key?.closest('li') ?? null
  /* v8 ignore next -- every rendered card prints its id */
  if (row === null) throw new Error(`no card for ${id}`)
  return row
}

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

/** An open composer, unchanged from a blank draft, with one row assembled. */
const COMPOSER_DRAFT: ComposeDraft = {
  id: 'my-agent', name: 'My agent',
  graph: chainGraph('my-agent', 'My agent', '@deepseek-ai/dsh-tool-bash'),
  saving: false, error: null,
  original: { id: '', name: '', graph: emptyChainGraph('', '') },
}

/** A ready palette for an open composer; the handoff needs no modules. */
const PALETTE: ComposePalette = { status: 'ready', modules: [] }

describe('the preset list', () => {
  it('reads the roster once when it first renders', async () => {
    const actions = renderSection()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
  })

  it('shows resolved copy for built-ins and falls back to custom ids', () => {
    renderSection()

    // Display copy is what a picker reads; the id stays visible as the key the
    // composition and the session header actually carry.
    expect(screen.getByText(en.presetStandardName)).toBeTruthy()
    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
    const mine = rowFor('mine')
    expect(within(mine).getAllByText('mine').length).toBeGreaterThan(0)
    expect(within(mine).getByText(en.noDescription)).toBeTruthy()
  })

  it('marks trust and the one in use, and offers no "set default" on it', () => {
    renderSection()

    const standard = rowFor('standard')
    expect(within(standard).getByText(en.builtIn)).toBeTruthy()
    expect(within(standard).getByText(en.inUse)).toBeTruthy()
    expect(within(standard).queryByText(en.setDefault)).toBeNull()
    expect(within(rowFor('mine')).getByText(en.userTrust)).toBeTruthy()
  })

  it('separates built-in presets from custom ones', () => {
    renderSection()

    // Two different things: one set ships with the deployment and is
    // read-only, the other is the user's own.
    expect(screen.getByRole('heading', { name: en.builtInGroup })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.customGroup })).toBeTruthy()
  })

  it('keeps the custom group on screen for a set nobody has', () => {
    renderSection({ rows: [{ id: 'standard', trust: 'system', isDefault: true }] })

    // The custom group is where one's own preset will appear, and the composer
    // entry lives there, so an empty set still shows the place to create.
    expect(screen.getByRole('heading', { name: en.customGroup })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.newAgent })).toBeTruthy()
  })

  it('leads with the two ways a preset is created', () => {
    renderSection()

    // The composer entry is the button on the list; the intro is what tells a
    // first-time reader that duplicating an existing preset — or letting the
    // agent draft one in Creator mode — is the other way to make one.
    expect(screen.getByText(new RegExp('Creator mode'))).toBeTruthy()
  })

  it('picks a preset by clicking its card, and the one in use is inert', () => {
    const actions = renderSection()

    const inUse = within(rowFor('standard')).getByRole('button', { name: `${en.inUse}: ${en.presetStandardName}` })
    expect(inUse).toHaveProperty('disabled', true)
    fireEvent.click(inUse)

    // Clicking the card IS the choice; the preset already in use cannot be
    // re-picked, so the click reaches nothing.
    expect(actions.makeDefault).not.toHaveBeenCalled()
  })

  it('offers View on a shipped row and the location on a custom one', () => {
    renderSection()

    // A shipped preset is the composition a copy starts from — reading it is
    // the point. A custom preset is edited in its files, so its row leads
    // there instead; there is no editor for either.
    const standard = rowFor('standard')
    expect(within(standard).getByRole('button', { name: `${en.view}: ${en.presetStandardName}` })).toBeTruthy()
    expect(within(standard).queryByRole('button', { name: `${en.openLocation}: ${en.presetStandardName}` })).toBeNull()
    const mine = rowFor('mine')
    expect(within(mine).getByRole('button', { name: `${en.openLocation}: mine` })).toBeTruthy()
    expect(within(mine).queryByRole('button', { name: `${en.view}: mine` })).toBeNull()
  })

  it('offers Delete only for a locally authored preset', () => {
    renderSection()

    expect(within(rowFor('mine')).getByRole('button', { name: `${en.delete}: mine` })).toBeTruthy()
    expect(within(rowFor('standard')).queryByRole('button', { name: `${en.delete}: ${en.presetStandardName}` })).toBeNull()
  })

  it('disables duplication when nothing is writable, and says why', () => {
    renderSection({ authorable: false })

    const duplicate = within(rowFor('standard')).getByRole('button', { name: `${en.duplicate}: ${en.presetStandardName}` })
    expect(duplicate).toHaveProperty('disabled', true)
    expect(duplicate.getAttribute('data-tip')).toBe(en.duplicateUnavailable)
  })

  it('marks a broken custom preset: unselectable, uncopyable, still deletable', () => {
    const actions = renderSection({
      rows: [
        { id: 'standard', trust: 'system', isDefault: true },
        { id: 'ghost', trust: 'user', isDefault: false, name: '幽灵预设', broken: 'the composition file agent.cordis.yml is missing' },
      ],
    })

    const ghost = rowFor('ghost')
    // The reason is on the card, and the body cannot pick what cannot mount.
    expect(within(ghost).getByText(en.brokenBadge)).toBeTruthy()
    expect(within(ghost).getByRole('alert').textContent).toContain('is missing')
    const body = within(ghost).getByRole('button', { name: `${en.brokenBadge}: 幽灵预设` })
    expect(body).toHaveProperty('disabled', true)
    fireEvent.click(body)
    expect(actions.makeDefault).not.toHaveBeenCalled()
    // Copying a broken preset would only mint another broken one; deleting
    // and the location remain — the files are where it gets fixed.
    const duplicate = within(ghost).getByRole('button', { name: `${en.duplicate}: 幽灵预设` })
    expect(duplicate).toHaveProperty('disabled', true)
    expect(duplicate.getAttribute('data-tip')).toBe(en.brokenNoCopy)
    expect(within(ghost).getByRole('button', { name: `${en.delete}: 幽灵预设` })).toBeTruthy()
    expect(within(ghost).getByRole('button', { name: `${en.openLocation}: 幽灵预设` })).toBeTruthy()
  })

  it('withholds the viewer on a broken shipped preset', () => {
    renderSection({
      rows: [{ id: 'standard', trust: 'system', isDefault: false, name: '标准模式', broken: 'the composition is not valid YAML' }],
    })

    // There is no readable composition to offer; the reason on the card is
    // the whole story a shipped row can tell.
    const standard = rowFor('standard')
    expect(within(standard).queryByRole('button', { name: `${en.view}: ${en.presetStandardName}` })).toBeNull()
    expect(within(standard).getByRole('alert').textContent).toContain('not valid YAML')
  })

  it('labels the location by what it will do without a desktop', () => {
    renderSection({ hasDocument: false })

    expect(within(rowFor('mine')).getByRole('button', { name: `${en.showLocation}: mine` })).toBeTruthy()
  })

  it('shows a revealed directory on its row', () => {
    renderSection({ revealedPaths: { mine: '/home/user/.dsh/.agent-presets/mine' } })

    const mine = rowFor('mine')
    expect(within(mine).getByText('/home/user/.dsh/.agent-presets/mine')).toBeTruthy()
    expect(within(mine).getByText(en.revealedPathLabel)).toBeTruthy()
    // The reveal belongs to its row alone.
    expect(within(rowFor('standard')).queryByText(en.revealedPathLabel)).toBeNull()
  })

  it('routes the row actions to the controller', () => {
    const actions = renderSection()

    // The card body is the control that picks a preset.
    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.setDefault}: mine` }))
    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.openLocation}: mine` }))
    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.duplicate}: mine` }))
    fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.view}: ${en.presetStandardName}` }))

    expect(actions.makeDefault).toHaveBeenCalledWith('mine')
    expect(actions.openLocation).toHaveBeenCalledWith('mine')
    expect(actions.beginCopy).toHaveBeenCalledWith('mine')
    expect(actions.view).toHaveBeenCalledWith('standard')
  })

  it('reaches Creator mode from the composer handoff and leaves settings', async () => {
    const actions = renderSection({
      rows: [...READY.rows, { id: 'cordis', trust: 'system', isDefault: false, name: '创造模式' }],
      composer: COMPOSER_DRAFT,
      palette: PALETTE,
    })

    fireEvent.click(screen.getByRole('button', { name: en.handoff }))

    // Save-then-handoff: the draft is a new preset, so the section saves it
    // before starting the Creator-mode session on the cordis preset.
    expect(actions.confirmCompose).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(actions.startCreatorDraft).toHaveBeenCalledTimes(1) })
    // Leaving settings is part of the gesture: the flow lands in the new
    // session, not behind the modal.
    expect(actions.close).toHaveBeenCalledTimes(1)
  })

  it('hides the composer handoff without the creator flow', () => {
    renderSection({
      rows: [...READY.rows, { id: 'cordis', trust: 'system', isDefault: false, name: '创造模式' }],
      composer: COMPOSER_DRAFT,
      palette: PALETTE,
    }, { creator: false })

    expect(screen.queryByRole('button', { name: en.handoff })).toBeNull()
  })

  it('hides the composer handoff until the cordis preset is on the roster', () => {
    renderSection({ composer: COMPOSER_DRAFT, palette: PALETTE })

    expect(screen.queryByRole('button', { name: en.handoff })).toBeNull()
  })

  it('shows a page-level failure without hiding the list', () => {
    renderSection({ error: 'settings are read-only' })

    expect(screen.getByRole('alert').textContent).toBe('settings are read-only')
    expect(rowFor('mine')).toBeTruthy()
  })

  it('renders nothing when the deployment composes no presets', () => {
    const { container } = render(<AgentPresetSection {...({
      useAgentPresetSection: bindSnapshotSelector(
        createSnapshotStore<AgentPresetSectionState>({ ...READY, status: 'unavailable', rows: [] })),
      t: (key: keyof typeof en) => en[key],
      load: vi.fn(() => Promise.resolve()),
    } as unknown as AgentPresetSectionProps)} />)

    expect(container.firstChild).toBeNull()
  })

  it('offers a retry when the roster could not be read', () => {
    const actions = renderSection({ status: 'error', error: 'roster unavailable' })

    expect(screen.getByRole('alert').textContent).toContain('roster unavailable')
    fireEvent.click(screen.getByText(en.retry))

    expect(actions.load).toHaveBeenCalledTimes(2)
  })
})

describe('the copy dialog', () => {
  const draft: CopyDraft = {
    from: 'standard', fromTitle: '标准模式', id: '', name: '', saving: false, error: null,
  }

  it('names its source and collects only an id and a display name', () => {
    const actions = renderSection({ copy: draft })

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe(`${en.copyTitle} · ${en.copyOf} ${en.presetStandardName}`)
    expect(within(dialog).getByText(en.copyIntro)).toBeTruthy()
    fireEvent.change(within(dialog).getByPlaceholderText(en.presetIdPlaceholder), { target: { value: 'my-agent' } })
    fireEvent.change(within(dialog).getByPlaceholderText(en.displayNamePlaceholder), { target: { value: '我的模式' } })

    expect(actions.setCopyId).toHaveBeenCalledWith('my-agent')
    expect(actions.setCopyName).toHaveBeenCalledWith('我的模式')
    // Nothing else is collected: the description and the composition are
    // edited in the preset's own files.
    expect(within(dialog).queryByRole('textbox', { name: /description/i })).toBeNull()
  })

  it('creates and cancels through the controller', () => {
    const actions = renderSection({ copy: { ...draft, id: 'my-agent' } })

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText(en.create))
    fireEvent.click(within(dialog).getByText(en.cancel))

    expect(actions.confirmCopy).toHaveBeenCalledTimes(1)
    expect(actions.cancelCopy).toHaveBeenCalledTimes(1)
  })

  it('blocks a copy the host would refuse, and says why', () => {
    const actions = renderSection({ copy: { ...draft, id: 'Upper Case' } })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert').textContent).toBe(en.idInvalid)
    fireEvent.click(within(dialog).getByText(en.create))

    // Disabled rather than round-tripping: the id is a directory name and the
    // rule is the host's own.
    expect(actions.confirmCopy).not.toHaveBeenCalled()
  })

  it('shows the host\'s refusal instead of the local blocker', () => {
    renderSection({ copy: { ...draft, id: 'my-agent', error: 'already exists' } })

    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('already exists')
  })

  it('reports a copy in flight and blocks a second click', () => {
    const actions = renderSection({ copy: { ...draft, id: 'my-agent', saving: true } })

    fireEvent.click(within(screen.getByRole('dialog')).getByText(en.creating))

    expect(actions.confirmCopy).not.toHaveBeenCalled()
  })

  it('dismisses on Escape', () => {
    const actions = renderSection({ copy: draft })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(actions.cancelCopy).toHaveBeenCalledTimes(1)
  })
})

describe('the read-only canvas view', () => {
  const GRAPH = chainGraph('standard', '标准模式', '@deepseek-ai/dsh-tool-bash')

  it('shows a shipped preset as a design page, nodes on the canvas', () => {
    renderSection({ view: { id: 'standard', title: '标准模式', graph: GRAPH } })

    // The composer head names the preset under the view title, and the body is
    // the flow canvas: the chain renders as graph nodes — start, the plugin,
    // end — not a dialog of YAML.
    expect(screen.getByRole('heading', { name: `${en.view} · ${en.presetStandardName}` })).toBeTruthy()
    expect(screen.getByText(en.compositionLabel)).toBeTruthy()
    expect(document.querySelector('[data-node-id="start"]')).toBeTruthy()
    expect(document.querySelector('[data-node-id="agent-1"]')).toBeTruthy()
    expect(document.querySelector('[data-node-id="end"]')).toBeTruthy()
  })

  it('keeps the loaded title when the viewed row leaves the roster', () => {
    renderSection({ view: { id: 'retired', title: 'Retired mode', graph: emptyChainGraph('retired', '') } })

    // The view carries its own title, so a row that vanished from the roster
    // does not degrade the design page into an empty shell.
    expect(screen.getByRole('heading', { name: `${en.view} · Retired mode` })).toBeTruthy()
  })

  it('renders no edit affordance: no fields, palette, save, or node actions', () => {
    renderSection({ view: { id: 'standard', title: '标准模式', graph: GRAPH } })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('heading', { name: en.palette })).toBeNull()
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
    expect(screen.queryByRole('button', { name: en.removeRow })).toBeNull()
  })

  it('renders the chain legible but not editable', () => {
    renderSection({ view: { id: 'standard', title: '标准模式', graph: GRAPH } })

    // The shipped composition is the known-good copy source, so its chain is
    // legible but cannot be reordered or removed from. Selection still works —
    // the inspector explains a node — but the editable affordances are gone:
    // no connect ports, no palette, no footer.
    expect(document.querySelector('[data-node-id="agent-1"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.connectLabel })).toBeNull()
    expect(screen.queryByRole('button', { name: en.handoff })).toBeNull()
  })

  it('closes through the controller', () => {
    const actions = renderSection({ view: { id: 'standard', title: '标准模式', graph: GRAPH } })

    fireEvent.click(screen.getByRole('button', { name: en.back }))

    expect(actions.closeView).toHaveBeenCalledTimes(1)
  })

  it('offers edit as a copy on an authoring deployment', () => {
    const actions = renderSection({ view: { id: 'standard', title: '标准模式', graph: GRAPH } })

    // A shipped preset is read-only by contract, so its edit affordance hands
    // off to a copy instead of mutating the composition in place.
    fireEvent.click(screen.getByRole('button', { name: en.editCopy }))

    expect(actions.closeView).toHaveBeenCalledTimes(1)
    expect(actions.beginCopy).toHaveBeenCalledWith('standard')
  })

  it('withholds the edit affordance when no preset can be written', () => {
    renderSection({ view: { id: 'standard', title: '标准模式', graph: GRAPH }, authorable: false })

    expect(screen.queryByRole('button', { name: en.editCopy })).toBeNull()
  })
})

describe('deleting a preset', () => {
  it('asks before deleting', () => {
    const actions = renderSection()

    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.delete}: mine` }))

    expect(actions.confirmDelete).toHaveBeenCalledWith('mine')
  })

  it('confirms and dismisses through the controller', () => {
    const actions = renderSection({ pendingDelete: 'mine' })

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText(en.deleteConfirm))
    fireEvent.click(within(dialog).getByText(en.cancel))

    expect(actions.remove).toHaveBeenCalledTimes(1)
    expect(actions.confirmDelete).toHaveBeenLastCalledWith(null)
  })

  it('dismisses the confirmation on Escape', () => {
    const actions = renderSection({ pendingDelete: 'mine' })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(actions.confirmDelete).toHaveBeenCalledWith(null)
  })

  it('reports a delete in flight', () => {
    const actions = renderSection({ pendingDelete: 'mine', deleting: true })

    fireEvent.click(within(screen.getByRole('dialog')).getByText(en.deleting))

    expect(actions.remove).not.toHaveBeenCalled()
  })
})

describe('a long card description', () => {
  /** jsdom has no ResizeObserver; the description watches its own box through one. */
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  const LONG = '始终用简体中文交流的友好通用助手，提供持久 bash 与文件编辑能力。'.repeat(8)

  /** Force the clamp to report an overflow: jsdom lays nothing out, so both heights are 0. */
  function clamp(overflowing: boolean): void {
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(overflowing ? 400 : 80)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(80)
  }

  beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('offers the whole description on hover once the card cuts it off', () => {
    clamp(true)
    vi.useFakeTimers()
    try {
      renderSection({ rows: [{ id: 'zh', trust: 'user', isDefault: false, name: '中文助手', description: LONG }] })

      fireEvent.mouseEnter(within(rowFor('zh')).getByText(LONG))
      act(() => { vi.advanceTimersByTime(400) })

      expect(screen.getByRole('tooltip').textContent).toBe(LONG)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays quiet when the description already fits', () => {
    clamp(false)
    vi.useFakeTimers()
    try {
      renderSection({ rows: [{ id: 'zh', trust: 'user', isDefault: false, name: '中文助手', description: '短描述。' }] })

      fireEvent.mouseEnter(within(rowFor('zh')).getByText('短描述。'))
      act(() => { vi.advanceTimersByTime(400) })

      // A bubble repeating what is already fully on the card is noise.
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders where the runtime has no ResizeObserver', () => {
    vi.unstubAllGlobals()
    clamp(true)

    expect(() => {
      renderSection({ rows: [{ id: 'zh', trust: 'user', isDefault: false, description: LONG }] })
    }).not.toThrow()
    // The first measurement does not depend on the observer.
    expect(within(rowFor('zh')).getByText(LONG).getAttribute('title')).toBe('')
  })
})
