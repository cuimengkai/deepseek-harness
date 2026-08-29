// Web e2e: session Results rail (details remapped). Cold-seeds a produced-files
// turn, opens the header Results toggle, and asserts Artifacts lists a path.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const OVERLAY = fileURLToPath(new URL('./produced-files.overlay.yml', import.meta.url))
const SEED_ID = 'results-panel-web-e2e'
const DONE = 'RESULTS_PANEL_DONE'
const ARTIFACT = 'results-panel-site.html'

function resultsFixture(): string {
  const session = Session.create(SessionId('results-panel-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Create a site file.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Results panel', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const callId = ToolCallId('results-panel-write')
  const args = JSON.stringify({ file_path: ARTIFACT, content: 'ok\n' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'write', arguments: args }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  const source = session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'write', arguments: args,
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: `Created ${ARTIFACT}` }],
      isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `Created the site.\n\n${DONE}` }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event, time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: Results panel opens from the session header', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    await seedSession(scaffold, resultsFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1280, height: 900 })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('opens Results with an Artifacts or Changes entry', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-results-panel'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    // Auto-open may already show the panel; ensure it is open via the toggle.
    const toggle = page.locator('[data-results-toggle]')
    await toggle.waitFor({ timeout: 10_000 })
    if (await page.locator('[data-results-panel]').count() === 0) await toggle.click()
    await expect.poll(() => page.locator('[data-results-panel]').count(), { timeout: 10_000 }).toBe(1)

    const panel = page.locator('[data-results-panel]')
    expect(await panel.getByRole('tab', { name: 'Artifacts' }).count()).toBe(1)
    expect(await panel.getByRole('tab', { name: 'Changes' }).count()).toBe(1)
    expect(await panel.getByRole('tab', { name: 'Files' }).count()).toBe(1)
    expect(await panel.getByRole('tab', { name: 'Inspect' }).count()).toBe(1)
    expect(await panel.getByText(ARTIFACT, { exact: true }).count()
      + await panel.getByText('results-panel-site.html').count()).toBeGreaterThan(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
