/**
 * Agent hub path helpers: tab query parsing and deep-link construction.
 */

import { describe, expect, it } from 'vitest'
import {
  agentHubPath, legacyAgentSectionTab, searchParam, tabFromSearch,
} from '../src/client/AgentHubSection.tsx'

describe('Agent hub path helpers', () => {
  it('reads tab and deep-link params from search', () => {
    expect(tabFromSearch('?tab=modes')).toBe('modes')
    expect(tabFromSearch('tab=presets')).toBe('presets')
    expect(tabFromSearch('')).toBeUndefined()
    expect(searchParam('?tab=modes&mode=hello-orchestration', 'mode')).toBe('hello-orchestration')
    expect(searchParam('?preset=standard', 'preset')).toBe('standard')
  })

  it('builds hub paths with optional deep links', () => {
    expect(agentHubPath()).toBe('/settings/agent')
    expect(agentHubPath('presets')).toBe('/settings/agent?tab=presets')
    expect(agentHubPath('modes', { mode: 'hello-orchestration' }))
      .toBe('/settings/agent?tab=modes&mode=hello-orchestration')
    expect(agentHubPath('presets', { preset: 'orchestration-sample' }))
      .toBe('/settings/agent?tab=presets&preset=orchestration-sample')
  })

  it('maps legacy section ids onto hub tabs', () => {
    expect(legacyAgentSectionTab('agent-presets')).toBe('presets')
    expect(legacyAgentSectionTab('agent-modes')).toBe('modes')
    expect(legacyAgentSectionTab('agent')).toBeUndefined()
  })
})
