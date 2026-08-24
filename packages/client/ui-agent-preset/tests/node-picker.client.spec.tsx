// @vitest-environment jsdom
/**
 * The node picker: the modal that offers the installed plugins to add a node
 * after one on the canvas. It opens from a node's floating "+" (successor) or
 * an edge's midpoint "+" (insert between), offers the same search-and-group as
 * the palette, and disables the modules already in the composition — one agent
 * runs one instance of a plugin.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposePalette } from '../src/client/section-store.ts'
import { NodePickerModal, type NodePickerModalProps } from '../src/client/NodePickerModal.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const READY: ComposePalette = {
  status: 'ready',
  modules: [
    { moduleName: '@deepseek-ai/dsh-tool-bash', displayName: 'Bash', category: 'shell', description: '持久 bash 会话。' },
    { moduleName: '@deepseek-ai/dsh-tool-read', displayName: 'Read', category: 'fs' },
    { moduleName: '@deepseek-ai/dsh-web-search', displayName: 'Web Search' },
  ],
}

function renderPicker(props: Partial<NodePickerModalProps> = {}) {
  const onPick = props.onPick ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  render(<NodePickerModal
    after="agent-1"
    palette={READY}
    inComposition={new Set()}
    onPick={onPick}
    onClose={onClose}
    t={(key: keyof typeof en) => en[key]}
    {...props}
  />)
  return { onPick, onClose }
}

describe('the node picker', () => {
  it('names the anchor and offers the grouped, annotated modules', () => {
    renderPicker()

    const dialog = screen.getByRole('dialog', { name: en.nodePickerTitle })
    // The modal says where a pick lands: right after the node the "+" floated on.
    expect(within(dialog).getByText(`${en.nodePickerAfter} agent-1`)).toBeTruthy()
    // The picker is the palette's own search-and-group, with the same cards.
    expect(within(dialog).getByRole('heading', { name: 'shell' })).toBeTruthy()
    expect(within(dialog).getByText('Bash')).toBeTruthy()
    expect(within(dialog).getByText('@deepseek-ai/dsh-tool-bash')).toBeTruthy()
    expect(within(dialog).getByText('持久 bash 会话。')).toBeTruthy()
  })

  it('filters the offered modules by the search box', () => {
    renderPicker()

    fireEvent.change(screen.getByPlaceholderText(en.paletteSearch), { target: { value: 'read' } })

    expect(screen.queryByText('Bash')).toBeNull()
    expect(screen.getByText('Read')).toBeTruthy()
  })

  it('reports a search with no matches', () => {
    renderPicker()

    fireEvent.change(screen.getByPlaceholderText(en.paletteSearch), { target: { value: 'no such plugin' } })

    expect(screen.getByText(en.nodePickerEmpty)).toBeTruthy()
  })

  it('marks a module already in the composition as spent', () => {
    const { onPick } = renderPicker({
      inComposition: new Set(['@deepseek-ai/dsh-tool-bash']),
    })

    const card = screen.getByRole('button', { name: /@deepseek-ai\/dsh-tool-bash/ })
    expect(card).toHaveProperty('disabled', true)
    expect(card.getAttribute('title')).toBe(en.alreadyAdded)
    expect(within(card).getByText(en.rowAdded)).toBeTruthy()

    // One agent runs one instance of a plugin, so a spent module is a hard stop.
    fireEvent.click(card)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('picks a module through the controller', () => {
    const { onPick } = renderPicker()

    fireEvent.click(screen.getByRole('button', { name: /@deepseek-ai\/dsh-web-search/ }))

    expect(onPick).toHaveBeenCalledWith('@deepseek-ai/dsh-web-search')
  })

  it('closes on the close button, the mask, and Escape', () => {
    const { onClose } = renderPicker()

    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(onClose).toHaveBeenCalledTimes(1)

    // The mask is the dialog's first sibling inside the overlay root.
    const root = screen.getByRole('dialog').parentElement!
    const mask = root.children[0]!
    fireEvent.click(mask)
    expect(onClose).toHaveBeenCalledTimes(2)

    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('reports the loading and unavailable palette states, and no inventory at all', () => {
    renderPicker({ palette: { status: 'loading', modules: [] } })
    expect(screen.getByText(en.paletteLoading)).toBeTruthy()
    cleanup()

    renderPicker({ palette: { status: 'unavailable', modules: [] } })
    expect(screen.getByText(en.paletteUnavailable)).toBeTruthy()
    cleanup()

    // Before the palette's first load the picker reads exactly like loading.
    renderPicker({ palette: null })
    expect(screen.getByText(en.paletteLoading)).toBeTruthy()
  })

  it('falls back to the Other bucket for uncategorized modules', () => {
    renderPicker({
      palette: {
        status: 'ready',
        modules: [
          { moduleName: '@deepseek-ai/dsh-tool-bash', displayName: 'Bash', category: 'shell', description: '持久 bash 会话。' },
          { moduleName: '@deepseek-ai/dsh-web-search', displayName: 'Web Search' },
        ],
      },
    })

    // The module the inventory left uncategorized shares the Other bucket,
    // which is never a real category.
    expect(screen.getByText(en.paletteCategoryOther)).toBeTruthy()
    expect(screen.getByText('持久 bash 会话。')).toBeTruthy()
  })
})
