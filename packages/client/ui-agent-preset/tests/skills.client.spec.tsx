// @vitest-environment jsdom
/** Skills Map hub tab: session catalog vs empty / no-session paths. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SkillMapSection } from '../src/client/SkillMapSection.tsx'
import type { SkillMapSectionProps } from '../src/client/SkillMapSection.tsx'
import { hubEn } from '../src/client/hub-locales.ts'

afterEach(() => { cleanup() })

function translate(key: keyof typeof hubEn, params?: Record<string, unknown>): string {
  const template = hubEn[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function mount(options: {
  current?: SessionId
  listSkills?: SkillMapSectionProps['listSkills']
} = {}) {
  const listSkills = options.listSkills ?? vi.fn(async () => [
    { name: 'demo', description: 'A demo skill', modelInvocable: true },
  ])
  render(
    <SkillMapSection
      {...({
        listSkills,
        useSessions: (select: (state: { current: SessionId | undefined }) => unknown) =>
          select({ current: options.current }),
        t: translate,
        close: vi.fn(),
      } as unknown as SkillMapSectionProps)}
    />,
  )
  return { listSkills }
}

describe('SkillMapSection', () => {
  it('asks for a session when none is current', () => {
    mount()
    expect(screen.getByText(hubEn['skills.noSession'])).toBeTruthy()
    expect(screen.getByText(hubEn['skills.pathHome'])).toBeTruthy()
  })

  it('lists skills for the current session', async () => {
    const sessionId = SessionId('sess-1')
    const { listSkills } = mount({ current: sessionId })
    await waitFor(() => {
      expect(screen.getByText('/demo')).toBeTruthy()
    })
    expect(listSkills).toHaveBeenCalledWith(sessionId)
    expect(screen.getByText('A demo skill')).toBeTruthy()
  })
})
