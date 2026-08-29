// @vitest-environment jsdom
/** SidebarNav: Connectors destination and the More menu. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SidebarNav } from '../src/client/SidebarNav.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(en) as TranslateNS<'sidebar'>

describe('SidebarNav', () => {
  it('navigates Connectors and More → Settings', async () => {
    const navigate = vi.fn()
    render(
      <SidebarNav
        wide
        t={t}
        actions={{
          getPathname: () => '/connectors',
          subscribePathname: () => () => {},
          navigate,
        }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Connectors' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    expect(navigate).toHaveBeenCalledWith('/connectors')

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(navigate).toHaveBeenCalledWith('/settings')
  })

  it('offers Files in More when openFiles is provided', async () => {
    const openFiles = vi.fn()
    render(
      <SidebarNav
        wide={false}
        t={t}
        actions={{
          getPathname: () => '/',
          subscribePathname: () => () => {},
          navigate: vi.fn(),
          openFiles,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Files' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Files' }))
    expect(openFiles).toHaveBeenCalledOnce()
  })
})
