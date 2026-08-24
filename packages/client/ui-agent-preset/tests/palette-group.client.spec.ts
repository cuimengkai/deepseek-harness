/**
 * The palette's search-and-group step, shared by the palette panel and the node
 * picker: trim-and-lowercase the query, match it against the module's name,
 * display name, category, and description, then bucket the hits by category in
 * first-seen order — the Other fallback labels the modules the inventory left
 * uncategorized.
 */

import { describe, expect, it } from 'vitest'
import type { ComposePalette } from '../src/client/section-store.ts'
import { filterAndGroupPalette } from '../src/client/palette-group.ts'

const READY: ComposePalette = {
  status: 'ready',
  modules: [
    { moduleName: '@deepseek-ai/dsh-tool-bash', displayName: 'Bash', category: 'shell', description: '持久 bash 会话。' },
    { moduleName: '@deepseek-ai/dsh-tool-read', displayName: 'Read', category: 'fs' },
    { moduleName: '@deepseek-ai/dsh-web-search', displayName: 'Web Search' },
  ],
}

describe('filterAndGroupPalette', () => {
  it('offers nothing while the inventory is not ready', () => {
    expect(filterAndGroupPalette(null, '', 'Other')).toEqual([])
    expect(filterAndGroupPalette({ status: 'loading', modules: [] }, '', 'Other')).toEqual([])
    expect(filterAndGroupPalette({ status: 'unavailable', modules: [] }, '', 'Other')).toEqual([])
  })

  it('matches a trimmed, case-insensitive query against every field', () => {
    // The module name, the display name, the category, and the description all
    // match, and the query's case and padding are not part of what the user
    // typed.
    expect(filterAndGroupPalette(READY, '  bash  ', 'Other')[0]?.modules.map(module => module.moduleName))
      .toEqual(['@deepseek-ai/dsh-tool-bash'])
    expect(filterAndGroupPalette(READY, 'WEB SEARCH', 'Other')[0]?.modules.map(module => module.moduleName))
      .toEqual(['@deepseek-ai/dsh-web-search'])
    expect(filterAndGroupPalette(READY, 'shell', 'Other')[0]?.modules.map(module => module.moduleName))
      .toEqual(['@deepseek-ai/dsh-tool-bash'])
    expect(filterAndGroupPalette(READY, '持久', 'Other')[0]?.modules.map(module => module.moduleName))
      .toEqual(['@deepseek-ai/dsh-tool-bash'])
  })

  it('groups hits by category in first-seen order, keeping inventory order', () => {
    const groups = filterAndGroupPalette(READY, '', 'Other')

    expect(groups.map(group => group.key)).toEqual(['shell', 'fs', 'Other'])
    expect(groups[0]!.modules.map(module => module.moduleName)).toEqual(['@deepseek-ai/dsh-tool-bash'])
    expect(groups[1]!.modules.map(module => module.moduleName)).toEqual(['@deepseek-ai/dsh-tool-read'])
    // A module the inventory did not categorize shares the Other bucket, which
    // is never a real category.
    expect(groups[2]!.modules.map(module => module.moduleName)).toEqual(['@deepseek-ai/dsh-web-search'])
  })

  it('returns no groups when nothing matches', () => {
    expect(filterAndGroupPalette(READY, 'no such plugin', 'Other')).toEqual([])
  })
})
