// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SettingsPageComponentProps, SettingsSectionRow } from '../src/client/shell-contract.ts'
import { SettingsPage } from '../src/client/SettingsPage.tsx'

afterEach(cleanup)

type Row = SettingsSectionRow

/** Stand-in slot content: the section seat paints a marker, the others their text. */
const SEAT_CONTENT: Record<string, string> = {
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
  'settings.close': 'Close',
}

/** The page's own shell copy (the `settings` namespace subset the page reads). */
const T: Record<string, string> = {
  back: 'Back',
  nav: 'Settings navigation',
  close: 'Close',
}

/**
 * Mount the page with stand-in slot content and face callbacks. `active` stands
 * in for the bound useSectionId (the observable's URL projection is covered in
 * shell.client.spec.ts); bump() plays a ledger change through the same
 * observable contract the real useSections hook rides.
 */
function mount({
  rows = [
    { id: 'general', order: 0, label: 'General' },
    { id: 'models', order: 10, label: 'Models' },
    { id: 'agent-presets', order: 20, label: 'Agent presets' },
  ],
  active = rows[0]?.id,
}: { rows?: Row[]; active?: string | undefined } = {}) {
  let current = rows
  const listeners = new Set<() => void>()
  const renderSlot = vi.fn(
    ((key: string, _owner: unknown, opts?: { only?: string }) => {
      if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`} />
      return SEAT_CONTENT[key]
    }) as SettingsPageComponentProps['renderSlot'],
  )
  const close = vi.fn()
  const back = vi.fn()
  const openSection = vi.fn()
  const props: SettingsPageComponentProps = {
    useSections: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }, [])
      return select(current)
    },
    useSectionId: select => select(active),
    close,
    back,
    openSection,
    renderSlot,
    t: (key: string) => T[key] ?? key,
  }
  const view = render(<SettingsPage {...props} />)
  const bump = (next: Row[]) => {
    act(() => {
      current = next
      for (const fn of [...listeners]) fn()
    })
  }
  return { view, renderSlot, close, back, openSection, bump, listeners }
}

describe('SettingsPage top bar', () => {
  it('renders back, title, actions, and a close control named by the close seat', () => {
    const { renderSlot } = mount()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Settings Title' })).toBeTruthy()
    expect(screen.getByText('Open configuration file')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('settings.header', {})
    expect(renderSlot).toHaveBeenCalledWith('settings.action', {})
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.hasAttribute('aria-label')).toBe(false)
    expect(close.textContent).toContain('Close')
  })

  it('steps back via the back button and leaves via the header close control', () => {
    const { back, close } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(back).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledOnce()
    expect(back).toHaveBeenCalledOnce()
  })

  it('lands focus on the close control when the page mounts', () => {
    mount()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })
})

describe('SettingsPage navigation', () => {
  it('projects rows, marks the active one, and renders only that section with the close owner', () => {
    const { renderSlot, close } = mount()
    expect(screen.getByRole('navigation', { name: 'Settings navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('settings.section', { close }, { only: 'general' })
  })

  it('navigates to a section on nav click', () => {
    const { openSection } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(openSection).toHaveBeenCalledWith('models')
  })

  it('gives every section a nav glyph, distinct for the ids the shell knows', () => {
    mount({
      rows: [
        { id: 'general', order: 0, label: 'General' },
        { id: 'models', order: 10, label: 'Models' },
        { id: 'agent-presets', order: 20, label: 'Agent presets' },
        { id: 'plugins', order: 30, label: 'Plugins' },
        { id: 'contributed', order: 40, label: 'Contributed' },
      ],
    })
    // Glyphs carry no id of their own, so the drawn paths are what tells them apart.
    const glyphs = ['General', 'Models', 'Agent presets', 'Plugins', 'Contributed']
      .map(name => screen.getByRole('button', { name }).querySelector('svg')?.innerHTML)
    expect(glyphs.every(glyph => glyph !== undefined && glyph !== '')).toBe(true)
    // The three ids the shell names get their own glyph; every other section —
    // including one this package never heard of — shares the gear.
    expect(new Set(glyphs.slice(0, 4)).size).toBe(4)
    expect(glyphs[4]).toBe(glyphs[0])
  })

  it('renders an empty content column when the ledger is empty', () => {
    const { renderSlot } = mount({ rows: [], active: undefined })
    const sectionCalls = renderSlot.mock.calls.filter(c => c[0] === 'settings.section')
    expect(sectionCalls).toHaveLength(0)
  })

  it('drops the ledger subscription on unmount', () => {
    const { view, listeners } = mount()
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})

describe('SettingsPage close paths', () => {
  it('closes on document-level Escape and unhooks the listener with the page', () => {
    const { view, close } = mount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    // Non-Escape keys are ignored, and the listener dies with the page.
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(close).toHaveBeenCalledOnce()
    view.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })
})
