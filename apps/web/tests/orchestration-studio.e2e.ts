// Web e2e: orchestration studio chrome — Agent hub tabs + ModeComposer inspector.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()

describe('web e2e: orchestration studio', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
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

  it.skipIf(MODE === 'record')('opens Agent hub Orchestration and shows Settings / Last Run when composing', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-orchestration-studio'))

    await page.goto(`${scaffold.authenticatedUrl.replace(/\?.*$/, '')}/settings/agent?tab=modes`, {
      waitUntil: 'load',
    })
    await page.waitForURL(/\/settings\/agent/, { timeout: 30_000 })

    await expect.poll(
      async () => await page.getByRole('tab', { name: 'Orchestration' }).count()
        + await page.getByRole('button', { name: 'Orchestration' }).count(),
      { timeout: 60_000 },
    ).toBeGreaterThan(0)

    await expect.poll(
      async () => await page.getByRole('tab', { name: 'Skills' }).count()
        + await page.getByRole('button', { name: 'Skills' }).count(),
      { timeout: 30_000 },
    ).toBeGreaterThan(0)

    await expect.poll(
      async () => await page.getByRole('tab', { name: 'Integrations' }).count()
        + await page.getByRole('button', { name: 'Integrations' }).count(),
      { timeout: 30_000 },
    ).toBeGreaterThan(0)

    // Open the shipped hello-orchestration sample when present.
    const openSample = page.getByRole('button', { name: /hello-orchestration|Open|View/i }).first()
    if (await openSample.count() > 0) {
      await openSample.click()
      await expect.poll(
        async () => await page.getByRole('tab', { name: 'Settings' }).count()
          + await page.getByRole('tab', { name: 'Last Run' }).count(),
        { timeout: 30_000 },
      ).toBeGreaterThan(0)
    }

    expect(tripwire.pageErrors).toEqual([])
  })
})
