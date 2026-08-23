/**
 * The per-session conversation-view projection: entries declaring a `modes`
 * filter show only when the session's resolved agent preset is a member; the
 * filter is per-session so a preset switch never flashes another mode's tabs.
 */

import { describe, expect, it } from 'vitest'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { filterViewTabs } from '../src/client/view-filter.ts'

/** One registered 'conversation.view' entry; label and modes are the knobs under test. */
function entry(id: string, options: { label?: string; modes?: readonly string[] } = {}): StoredEntry {
  return { component: undefined, options: { id, ...options } }
}

describe('filterViewTabs', () => {
  it('shows every ungated entry and hides gated entries while the preset is unknown', () => {
    const tabs = filterViewTabs([
      entry('chat', { label: '对话' }),
      entry('develop-modules', { label: '模块依赖拓扑图', modes: ['develop'] }),
      entry('trajectory', { label: '轨迹' }),
    ], undefined)

    // A preset switch must never flash the previous mode's tabs mid-load.
    expect(tabs).toEqual([
      { id: 'chat', label: '对话' },
      { id: 'trajectory', label: '轨迹' },
    ])
  })

  it('shows gated entries only when the preset is a member', () => {
    const tabs = filterViewTabs([
      entry('chat', { label: '对话' }),
      entry('develop-modules', { label: '模块依赖拓扑图', modes: ['develop'] }),
      entry('trajectory', { label: '轨迹' }),
    ], 'develop')

    expect(tabs).toEqual([
      { id: 'chat', label: '对话' },
      { id: 'develop-modules', label: '模块依赖拓扑图' },
      { id: 'trajectory', label: '轨迹' },
    ])
  })

  it('hides gated entries for a preset outside the member list', () => {
    const tabs = filterViewTabs([
      entry('develop-modules', { label: '模块依赖拓扑图', modes: ['develop'] }),
      entry('chat', { label: '对话' }),
    ], 'code')

    expect(tabs).toEqual([{ id: 'chat', label: '对话' }])
  })

  it('keeps multiple gated entries in ledger order for a matching preset', () => {
    const tabs = filterViewTabs([
      entry('develop-modules', { label: '模块依赖拓扑图', modes: ['develop'] }),
      entry('develop-components-dep', { label: '组件依赖', modes: ['develop'] }),
      entry('develop-tech', { label: '技术栈', modes: ['develop'] }),
    ], 'develop')

    expect(tabs.map(tab => tab.id)).toEqual(['develop-modules', 'develop-components-dep', 'develop-tech'])
  })

  it('falls back to the entry id when no label resolves', () => {
    const tabs = filterViewTabs([entry('develop-modules')], 'develop')
    expect(tabs).toEqual([{ id: 'develop-modules', label: 'develop-modules' }])
  })
})
