import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { agentModeProjectionDefinition, resolveSessionMode } from '../src/session.ts'

/** A header carrying the creation-time mode, if any. */
function header(agentMode?: string): SessionHeader {
  return {
    version: 0,
    id: SessionId('s'),
    createdAt: 1,
    delegationDepth: 0,
    ...agentMode === undefined ? {} : { agentMode },
  }
}

/** One logged selection. */
function selected(agentMode: string, seq: number): SessionEvent {
  return { type: 'agent-mode/selected', seq, time: seq, data: { agentMode } }
}

describe('agent mode selection projection', () => {
  it('starts from the creation header, including no configured mode', () => {
    expect(agentModeProjectionDefinition.init(header('demo'))).toBe('demo')
    expect(agentModeProjectionDefinition.init(header())).toBeNull()
  })

  it('keeps the latest selected mode', () => {
    let state = agentModeProjectionDefinition.init(header('demo'))
    state = agentModeProjectionDefinition.apply(state, selected('other', 0))
    state = agentModeProjectionDefinition.apply(state, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    expect(agentModeProjectionDefinition.wire.view(state)).toBe('other')
  })

  it('resolveSessionMode prefers the newest selection', () => {
    expect(resolveSessionMode({
      header: header('demo'),
      events: [selected('other', 0)],
    })).toBe('other')
  })
})
