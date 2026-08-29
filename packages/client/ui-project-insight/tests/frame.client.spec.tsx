// @vitest-environment jsdom
/**
 * The non-content frame states: loading and stale center a spinner beside the
 * copy and announce politely (the host is still scanning); none and error stay
 * centered without a spinner; and the ready document renders no frame.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { InsightTab, type InsightTabProps } from '../src/client/InsightTab.tsx'
import type { ProjectInsightState } from '../src/client/insight-store.ts'
import { en } from '../src/client/locales.ts'
import css from '../src/client/insight.module.css'

afterEach(cleanup)

/** Render one insight tab seeded with the given controller state. */
function renderTab(state: ProjectInsightState) {
  const store = createSnapshotStore<ProjectInsightState>(state)
  return render(<InsightTab {...({
    useProjectInsight: bindSnapshotSelector(store),
    load: vi.fn(),
    dispose: vi.fn(),
    variant: 'techStack',
    t: (key: keyof typeof en) => en[key],
  } as unknown as InsightTabProps)} />)
}

/** The spinner element a busy frame renders, or null. */
function spinner(container: HTMLElement): Element | null {
  return container.querySelector(`.${css.frameSpinner}`)
}

describe('insight frame states', () => {
  it('centers a spinner beside the scanning copy and announces politely', () => {
    const { container } = renderTab({ status: 'loading', error: null, doc: null })

    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.className).toBe(css.frame)
    expect(spinner(container)).not.toBeNull()
    expect(status.textContent).toBe(en['frame.scanning'])
  })

  it('centers a spinner beside the re-scanning copy', () => {
    const { container } = renderTab({ status: 'stale', error: null, doc: null })

    expect(spinner(container)).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe(en['frame.stale'])
  })

  it('centers the unscanned copy without a spinner', () => {
    const { container } = renderTab({ status: 'none', error: null, doc: null })

    expect(spinner(container)).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(en['frame.none'])
  })

  it('centers the read error with its reason and no spinner', () => {
    const { container } = renderTab({ status: 'error', error: 'boom', doc: null })

    expect(spinner(container)).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('boom')
  })
})
