// Web e2e: WorkBuddy final IA — New task, Results, Experts deep-link, Projects workspaces.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()

describe('web e2e: WorkBuddy final IA chrome', () => {
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

  it.skipIf(MODE === 'record')('shows New task; Experts opens Agent settings; Projects lists workspaces', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbuddy-final-ia'))

    await expect.poll(
      () => page.getByRole('button', { name: 'New task' }).count(),
      { timeout: 60_000 },
    ).toBeGreaterThan(0)

    await expect.poll(
      () => page.locator('[data-results-toggle]').count(),
      { timeout: 30_000 },
    ).toBe(1)

    await page.getByRole('button', { name: 'Experts · skills' }).click()
    await page.waitForURL(/\/settings\/agent/, { timeout: 30_000 })
    expect(page.url()).toMatch(/\/settings\/agent/)

    // A routed `page` makes the AppFrame grid inert; Escape closes Settings.
    await page.keyboard.press('Escape')
    await page.waitForURL(url => !url.pathname.startsWith('/settings'), { timeout: 30_000 })

    await page.getByRole('button', { name: 'Projects' }).click()
    await page.waitForURL(/\/projects/, { timeout: 30_000 })
    await expect.poll(
      () => page.getByRole('heading', { name: 'Projects' }).count(),
      { timeout: 10_000 },
    ).toBe(1)
    expect(await page.getByRole('button', { name: 'Back to Assistant' }).count()).toBe(1)

    await page.getByRole('button', { name: 'Connectors' }).click()
    await page.waitForURL(/\/connectors/, { timeout: 30_000 })
    await expect.poll(
      () => page.getByRole('heading', { name: 'Connectors' }).count(),
      { timeout: 10_000 },
    ).toBe(1)

    await page.getByRole('button', { name: 'Automation' }).click()
    await page.waitForURL(/\/automation/, { timeout: 30_000 })
    await expect.poll(
      () => page.getByRole('heading', { name: 'Automation' }).count(),
      { timeout: 10_000 },
    ).toBe(1)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
