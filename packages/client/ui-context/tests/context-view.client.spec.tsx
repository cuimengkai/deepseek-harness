// @vitest-environment jsdom
/**
 * ContextView range selection: a plain click anchors and selects, a
 * shift-click on a surface row extends a range (rows highlight, the action
 * bar summarizes it), the trigger fires compactRange with the inclusive
 * endpoints and clears on admission while a rejection keeps the range and
 * shows the failure, and the clear action dismisses it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ContextComposition } from '@deepseek-ai/dsh-context-composition/types'
import { ContextView, type ContextViewProps } from '../src/client/ContextView.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SID = 's-1' as SessionId

const t: ContextViewProps['t'] = makeTranslate(zh)

/** A three-row surface (seq 2, 4, 6) with a priced envelope. */
const COMPOSITION: ContextComposition = {
  logRevision: 9,
  envelope: {
    provider: 'mock',
    model: 'm-1',
    system: 'You are a test.',
    systemTokens: 5,
    tools: [{ name: 'read', tokens: 12 }],
    toolsTokens: 12,
  },
  surface: [
    { seq: 2, role: 'user', tokens: 10, preview: 'a' },
    { seq: 4, role: 'assistant', tokens: 20, preview: 'b' },
    { seq: 6, role: 'user', tokens: 30, preview: 'c' },
  ],
  surfaceTokens: 60,
  contextWindow: 32_000,
  compactions: [],
}

/** A session snapshot whose last node seq keeps the revision marker steady. */
const SESSION = {
  sessionId: SID,
  nodes: [{ seq: 6 }],
  partial: null,
} as unknown as ConversationSnapshot

/** Mount the view over hand-held stores; compactRange defaults to admission. */
function setup(
  state: { status: 'ready'; composition: ContextComposition },
  compactRange = vi.fn(() => Promise.resolve<string | null>(null)),
) {
  const compositionStore = createSnapshotStore(state)
  const sessionStore = createSnapshotStore(SESSION)
  const load = vi.fn()
  const dispose = vi.fn()
  const props = {
    sessionId: SID,
    useSession: bindSnapshotSelector(sessionStore),
    useContextComposition: bindSnapshotSelector(compositionStore),
    load,
    dispose,
    compactRange,
    t,
  } as unknown as ContextViewProps
  const view = render(<ContextView {...props} />)
  return { view, compactRange, load }
}

/** The tree button for one surface row, located by its label. */
const row = (seq: number) => screen.getByRole('button', { name: new RegExp(`#${seq} `) })

describe('ContextView range selection', () => {
  it('anchors on a plain click and extends a range on shift-click', () => {
    setup({ status: 'ready', composition: COMPOSITION })
    fireEvent.click(row(2))
    // No range yet: only the hint rides the footer.
    expect(screen.getByText('Shift+点击选择范围')).toBeTruthy()
    fireEvent.click(row(6), { shiftKey: true })
    // The bar summarizes the inclusive span: three rows, 60 tokens.
    expect(screen.getByText('已选 3 条 · 约 60 tokens')).toBeTruthy()
    // Every row inside the span is range-marked; rows outside are not.
    for (const seq of [2, 4, 6]) {
      expect(row(seq).getAttribute('aria-selected')).toBe('true')
    }
    expect(screen.queryByText('Shift+点击选择范围')).toBeNull()
  })

  it('extends backwards from the anchor the same way', () => {
    setup({ status: 'ready', composition: COMPOSITION })
    fireEvent.click(row(6))
    fireEvent.click(row(2), { shiftKey: true })
    expect(screen.getByText('已选 3 条 · 约 60 tokens')).toBeTruthy()
  })

  it('fires compactRange with the inclusive endpoints and clears on admission', async () => {
    const compactRange = vi.fn(() => Promise.resolve<string | null>(null))
    setup({ status: 'ready', composition: COMPOSITION }, compactRange)
    fireEvent.click(row(4))
    fireEvent.click(row(6), { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: '压缩所选' }))
    expect(compactRange).toHaveBeenCalledWith(4, 6)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '压缩所选' })).toBeNull()
    })
    expect(screen.getByText('Shift+点击选择范围')).toBeTruthy()
  })

  it('keeps the range and surfaces the failure on a rejected execution', async () => {
    const compactRange = vi.fn(() => Promise.resolve<string | null>('range is not compactable'))
    setup({ status: 'ready', composition: COMPOSITION }, compactRange)
    fireEvent.click(row(2))
    fireEvent.click(row(4), { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: '压缩所选' }))
    expect((await screen.findByRole('alert')).textContent).toBe('range is not compactable')
    expect(screen.getByText('已选 2 条 · 约 30 tokens')).toBeTruthy()
  })

  it('dismisses the range through the clear action', () => {
    setup({ status: 'ready', composition: COMPOSITION })
    fireEvent.click(row(2))
    fireEvent.click(row(6), { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }))
    expect(screen.queryByText(/已选/)).toBeNull()
    expect(screen.getByText('Shift+点击选择范围')).toBeTruthy()
  })

  it('dismisses the range on Escape', () => {
    setup({ status: 'ready', composition: COMPOSITION })
    fireEvent.click(row(2))
    fireEvent.click(row(6), { shiftKey: true })
    expect(screen.getByText('已选 3 条 · 约 60 tokens')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(/已选/)).toBeNull()
    expect(screen.getByText('Shift+点击选择范围')).toBeTruthy()
    // The plain-click re-anchor still works after the Escape dismissal.
    fireEvent.click(row(4))
    fireEvent.click(row(6), { shiftKey: true })
    expect(screen.getByText('已选 2 条 · 约 50 tokens')).toBeTruthy()
  })

  it('clears the range when a plain click re-anchors elsewhere', () => {
    setup({ status: 'ready', composition: COMPOSITION })
    fireEvent.click(row(2))
    fireEvent.click(row(6), { shiftKey: true })
    fireEvent.click(row(6))
    expect(screen.queryByText(/已选/)).toBeNull()
  })

  it('re-anchors on the clicked row when a refresh dropped the anchored row', () => {
    const { view } = setup({ status: 'ready', composition: COMPOSITION })
    fireEvent.click(row(2))
    // Simulate the compaction refresh: seq 2 collapsed away.
    view.rerender(<ContextView {...({
      sessionId: SID,
      useSession: bindSnapshotSelector(createSnapshotStore(SESSION)),
      useContextComposition: bindSnapshotSelector(createSnapshotStore({
        status: 'ready',
        composition: {
          ...COMPOSITION,
          surface: COMPOSITION.surface.filter(candidate => candidate.seq !== 2),
        },
      })),
      load: vi.fn(),
      dispose: vi.fn(),
      compactRange: vi.fn(() => Promise.resolve<string | null>(null)),
      t,
    } as unknown as ContextViewProps)} />)
    fireEvent.click(row(4), { shiftKey: true })
    // The gone anchor degrades to a one-row range instead of a rejected span.
    expect(screen.getByText('已选 1 条 · 约 20 tokens')).toBeTruthy()
  })
})
