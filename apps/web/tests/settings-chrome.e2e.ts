// Web e2e scenarios: the routed settings surface — the full-viewport page
// (trigger navigation semantics, section switching through the URL, the
// back/Escape/close paths, deep-link boot via the SPA fallback), the Appearance
// preference row (the real theme gesture — click 深色 and the whole cascade runs:
// ThemeRuntime preference -> Host settings -> theme/change -> ui-layout's presenter
// -> body attribute -> alias token + browser theme-color metadata)
// the Language row and busy-state Enter preference (both Host-backed), plus
// Permission as the persisted default for subsequently created sessions.
// Zero model calls: everything is pure client + persistence state on a blank
// frame, so there is no fixture and a stray stream would fail loud on the
// open llm seam.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/settings-chrome', import.meta.url))
const DIALOG_EXPECTED = join(SNAPSHOT_DIR, 'dialog.expected.md')
const PLUGINS_EXPECTED = join(SNAPSHOT_DIR, 'plugins.expected.md')
// The English fallback surface: a browser naming no shipped language.
const DIALOG_EN_EXPECTED = join(SNAPSHOT_DIR, 'dialog-en.expected.md')
const PLUGIN_ROW_SELECTOR = '[data-plugin-entry$="ui-settings"]'
const MODE = webSnapshotMode()

describe('web e2e: settings page and General preferences', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    // Chinese browser: the shared page asserts the localized settings surface
    // the client derives from it (the English default has its own spec below).
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the settings page, switches sections through the URL, and leaves by every path', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-shell'))
    const trigger = page.getByRole('button', { name: '设置', exact: true })
    // The trigger is a navigation affordance, not a popup owner: it never
    // carries haspopup/expanded state, and the row reflects the active route.
    expect(await trigger.getAttribute('aria-haspopup')).toBeNull()
    expect(await trigger.getAttribute('aria-expanded')).toBeNull()
    expect(await trigger.getAttribute('aria-current')).toBeNull()
    await trigger.click()
    const settings = page.locator('[data-settings-page]')
    await settings.waitFor({ timeout: 10_000 })
    await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 5_000 }).toBe('/settings')
    await expect.poll(() => trigger.getAttribute('aria-current'), { timeout: 5_000 }).toBe('page')
    await settings.getByRole('heading', { name: '设置' }).waitFor({ timeout: 10_000 })
    // General is active by default; Permission, Language and Appearance are functional.
    expect(await settings.getByRole('button', { name: '通用设置' }).getAttribute('aria-current')).toBe('page')
    await settings.getByRole('button', { name: '可写入工作区' }).waitFor({ timeout: 10_000 })
    await expect.poll(() => settings.getByText('语言', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    await expect.poll(() => settings.getByText('外观', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    const openDocument = settings.getByRole('button', { name: '打开配置文件' })
    await openDocument.waitFor({ timeout: 10_000 })
    let openRequests = 0
    await page.route('**/api/settings.openDocument', async (route) => {
      const envelope = route.request().postDataJSON() as {
        rpcId: string
        payload: Record<string, never>
      }
      expect(envelope.payload).toEqual({})
      openRequests += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value: { opened: true } },
        }),
      })
    })
    await openDocument.click()
    await expect.poll(() => openRequests, { timeout: 5_000 }).toBe(1)
    await expect.poll(() => openDocument.isEnabled(), { timeout: 5_000 }).toBe(true)
    await page.unroute('**/api/settings.openDocument')
    // Golden of the freshly opened settings page (default zh, General active).
    const snapshot = await captureStableAria(page, '[data-settings-page]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DIALOG_EXPECTED, snapshot, MODE)
    // Section switch: the URL parameter drives the active row.
    await settings.getByRole('button', { name: '模型' }).click()
    await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 5_000 }).toBe('/settings/models')
    await expect.poll(
      () => settings.getByRole('button', { name: '模型' }).getAttribute('aria-current'),
      { timeout: 5_000 },
    ).toBe('page')
    expect(await settings.getByRole('button', { name: '通用设置' }).getAttribute('aria-current')).toBeNull()
    // Back path: the header back button steps one entry back through the
    // section stack (deep → the settings root), never leaving the app under a
    // covering page.
    await settings.getByRole('button', { name: '返回' }).click()
    await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 5_000 }).toBe('/settings')
    expect(await settings.count()).toBe(1)
    await expect.poll(
      () => settings.getByRole('button', { name: '通用设置' }).getAttribute('aria-current'),
      { timeout: 5_000 },
    ).toBe('page')
    // Plugins is a read-only projection of the same assembled Loader tree.
    // Capture one stable shipped row rather than the whole inventory so adding
    // an unrelated plugin does not rewrite this surface's golden.
    await settings.getByRole('button', { name: '插件', exact: true }).click()
    await settings.getByRole('heading', { name: '插件', exact: true }).waitFor({ timeout: 10_000 })
    await settings.getByRole('tab', { name: '插件', exact: true }).click()
    const pluginRow = settings.locator(PLUGIN_ROW_SELECTOR)
    await pluginRow.waitFor({ timeout: 10_000 })
    const expectedPluginCount = [...scaffold.ctx.loader.entries()]
      .filter(entry => !entry.options.group)
      .length
    expect(await settings.getByRole('searchbox', { name: '搜索插件' }).count()).toBe(1)
    expect(await settings.locator('[data-plugin-entry]').count()).toBe(expectedPluginCount)
    expect(await settings.getByRole('button', { name: '插件', exact: true }).getAttribute('aria-current')).toBe('page')
    expect(await settings.getByRole('tab', { name: '插件', exact: true }).getAttribute('aria-selected')).toBe('true')
    expect(await settings.getByRole('button', { name: '模型' }).getAttribute('aria-current')).toBeNull()
    const pluginsSnapshot = await captureStableAria(
      page,
      PLUGIN_ROW_SELECTOR,
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(PLUGINS_EXPECTED, pluginsSnapshot, MODE)
    // Close path 1: Escape leaves for the root no matter how deep the stack is.
    await settings.getByRole('button', { name: '模型' }).click()
    await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 5_000 }).toBe('/settings/models')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 5_000 }).toBe('/')
    await expect.poll(() => settings.count(), { timeout: 5_000 }).toBe(0)
    await expect.poll(() => trigger.getAttribute('aria-current'), { timeout: 5_000 }).toBeNull()
    // Close path 2: the header close control (focus lands there on open).
    await trigger.click()
    await page.locator('[data-settings-page]').getByRole('button', { name: '关闭' }).click()
    await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 5_000 }).toBe('/')
    await expect.poll(() => page.locator('[data-settings-page]').count(), { timeout: 5_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('deep-links into a section through history routing and the SPA fallback', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-deep-link'))
    // A fresh load of the route must serve the SPA (frontend-static fallback)
    // and the router must activate the Models section from the URL — the
    // deep-link guarantee history routing and the fallback exist to provide.
    const warningStart = tripwire.warnings.length
    await page.goto(`${scaffold.baseUrl}/settings/models`, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    const settings = page.locator('[data-settings-page]')
    await settings.waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => window.location.pathname)).toBe('/settings/models')
    await expect.poll(
      () => settings.getByRole('button', { name: '模型' }).getAttribute('aria-current'),
      { timeout: 5_000 },
    ).toBe('page')
    await settings.getByText('填入各提供方的 API 密钥即可使用其模型。').waitFor({ timeout: 10_000 })
    // The trigger reflects the active route even on a deep-link boot.
    await expect.poll(
      () => page.getByRole('button', { name: '设置', exact: true }).getAttribute('aria-current'),
      { timeout: 5_000 },
    ).toBe('page')
    // A fresh tab has no history to step back through: the header close still
    // lands on the root, leaving the app fully uncovered.
    await settings.getByRole('button', { name: '关闭' }).click()
    await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 5_000 }).toBe('/')
    await expect.poll(() => settings.count(), { timeout: 5_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('stores Permission as the default for future sessions without changing an existing session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-permission'))
    const existing = scaffold.ctx.sessions.create(SessionId('settings-permission-before'))
    expect(existing.events.find(event => event.type === 'permission/preset')?.data)
      .toEqual({ preset: 'workspace-write', origin: 'default' })

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.locator('[data-settings-page]')
    await settings.waitFor({ timeout: 10_000 })
    const selector = settings.getByRole('button', { name: '可写入工作区' })
    await selector.waitFor({ timeout: 10_000 })
    await expect.poll(() => selector.isEnabled(), { timeout: 5_000 }).toBe(true)
    await selector.click()
    await page.getByRole('menuitem', { name: '仅可查看' }).click()
    await settings.getByRole('button', { name: '仅可查看' }).waitFor({ timeout: 10_000 })

    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('permission:')
    expect(document).toContain('defaultPreset: read-only')
    expect(existing.events.find(event => event.type === 'permission/preset')?.data)
      .toEqual({ preset: 'workspace-write', origin: 'default' })

    const created = scaffold.ctx.sessions.create(SessionId('settings-permission-after'))
    expect(created.events.map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'read-only', origin: 'default' }],
      ['sandbox/mode', { mode: 'read-only' }],
      ['approval/policy', { policy: 'ask' }],
    ])

    await settings.getByRole('button', { name: '仅可查看' }).click()
    await page.getByRole('menuitem', { name: '完全权限' }).click()
    const confirmation = page.getByRole('dialog', { name: '确认启用完全权限？' })
    const enable = confirmation.getByRole('button', { name: '启用完全权限' })
    expect(await enable.isDisabled()).toBe(true)
    await confirmation.getByRole('checkbox').click()
    await enable.click()
    await settings.getByRole('button', { name: '完全权限' }).waitFor({ timeout: 10_000 })
    const confirmedDocument = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(confirmedDocument).toContain('defaultPreset: danger-full-access')
    const confirmed = scaffold.ctx.sessions.create(SessionId('settings-permission-confirmed'))
    expect(confirmed.events.map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'danger-full-access', origin: 'default' }],
      ['sandbox/mode', { mode: 'danger-full-access' }],
      ['approval/policy', { policy: 'never' }],
    ])
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('uses the persisted dark preference while plugins are still loading', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-boot-theme'))
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const initialSettings = page.locator('[data-settings-page]')
    const darkCube = initialSettings.getByRole('button', { name: '深色' })
    await darkCube.click()
    await expect.poll(() => darkCube.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-theme:\n\s+preference: dark/)
    await page.keyboard.press('Escape')

    // Hold real plugin bundles so the shell-owned loading page remains observable.
    const pluginPattern = /\/plugins\/@deepseek-ai\/dsh-client-ui-theme\/client\.js(?:\?.*)?$/
    let releaseBundles = (): void => {}
    const bundlesReleased = new Promise<void>((resolve) => { releaseBundles = resolve })
    await page.route(pluginPattern, async (route) => {
      await bundlesReleased
      await route.continue()
    })

    const warningStart = tripwire.warnings.length
    let reload: ReturnType<Page['reload']> | undefined
    try {
      reload = page.reload({ waitUntil: 'domcontentloaded' })
      const loading = page.getByText('Loading plugins…', { exact: true })
      await loading.waitFor({ timeout: 10_000 })
      const state = await loading.evaluate((element) => {
        const boot = element.parentElement?.parentElement
        if (boot === undefined || boot === null) throw new Error('loading hint is detached from the boot page')
        return {
          attr: document.body.hasAttribute('data-ds-dark-theme'),
          background: getComputedStyle(boot).backgroundColor,
          colorScheme: document.documentElement.style.colorScheme,
        }
      })
      expect(state).toEqual({
        attr: true,
        background: 'rgb(21, 21, 23)',
        colorScheme: 'dark',
      })
    } finally {
      releaseBundles()
      await reload
      await page.unroute(pluginPattern)
    }

    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const restoredSettings = page.locator('[data-settings-page]')
    const systemCube = restoredSettings.getByRole('button', { name: '跟随系统' })
    await systemCube.click()
    await expect.poll(() => systemCube.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')), {
      timeout: 5_000,
    }).toBe(false)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('flips the theme through the Appearance cubes and persists across reload and a distinct port', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-appearance'))
    interface ThemeState {
      attr: boolean
      background: string
      /** Pre-migration localStorage key; the Host-backed world never writes it. */
      legacy: string | null
      themeColor: string | null
      themeColorCount: number
      token: string
    }
    const readState = async (target: Page = page): Promise<ThemeState> => await target.evaluate(() => {
      const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      const computed = getComputedStyle(document.body)
      return {
        attr: document.body.hasAttribute('data-ds-dark-theme'),
        background: computed.backgroundColor,
        legacy: localStorage.getItem('dsh.theme'),
        themeColor: metas[0]?.content ?? null,
        themeColorCount: metas.length,
        token: computed.getPropertyValue('--dsw-alias-bg-base').trim(),
      }
    })
    const expectThemeColorSynchronized = (state: ThemeState): void => {
      expect(state.themeColorCount).toBe(1)
      expect(state.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(state.themeColor).toBe(state.background)
    }
    // Pin the OS scheme to light so the default `system` preference resolves
    // light and the dark flip below is unambiguously the gesture's doing.
    await page.emulateMedia({ colorScheme: 'light' })
    const light = await readState()
    expect(light.attr).toBe(false)
    expectThemeColorSynchronized(light)

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.locator('[data-settings-page]')
    await settings.waitFor({ timeout: 10_000 })
    const darkCube = settings.getByRole('button', { name: '深色' })
    expect(await darkCube.getAttribute('aria-pressed')).toBe('false')
    await darkCube.click()
    // The full cascade: pressed state, Host-backed preference, body attribute,
    // alias token flip — all from one real user gesture.
    await expect.poll(() => darkCube.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    const dark = await readState()
    expect(dark.attr).toBe(true)
    expect(dark.legacy).toBeNull()
    expect(dark.token).not.toBe(light.token)
    expectThemeColorSynchronized(dark)
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-theme:\n\s+preference: dark/)
    await page.keyboard.press('Escape')

    // Reload: the preference survives the background Host read + presenter update.
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(async () => (await readState()).attr, { timeout: 5_000 }).toBe(true)
    const reloaded = await readState()
    expect(reloaded.legacy).toBeNull()
    expectThemeColorSynchronized(reloaded)

    // A second live Host binds another ephemeral port but shares the same
    // user-settings home. Its fresh origin has no theme localStorage and still
    // converges to dark before the settings page opens.
    const second = await launchWebScaffold({ harnessHome: scaffold.harnessHome })
    const secondPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    const secondTripwire = watchConsole(secondPage)
    try {
      expect(second.baseUrl).not.toBe(scaffold.baseUrl)
      await secondPage.emulateMedia({ colorScheme: 'light' })
      await secondPage.goto(second.baseUrl, { waitUntil: 'load' })
      await secondPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await expect.poll(async () => (await readState(secondPage)).attr, { timeout: 5_000 }).toBe(true)
      const secondState = await readState(secondPage)
      expect(secondState.legacy).toBeNull()
      expectThemeColorSynchronized(secondState)
      expect(secondTripwire.pageErrors).toEqual([])
      expect(secondTripwire.warnings).toEqual([])
    } finally {
      await secondPage.close()
      await second.close()
    }

    // `system` follows the emulated OS scheme (dark stays dark, light clears).
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const systemCube = page.locator('[data-settings-page]').getByRole('button', { name: '跟随系统' })
    await systemCube.click()
    await expect.poll(() => systemCube.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    await expect.poll(async () => (await readState()).attr, { timeout: 5_000 }).toBe(false)
    expectThemeColorSynchronized(await readState())
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(async () => (await readState()).attr, { timeout: 5_000 }).toBe(true)
    expectThemeColorSynchronized(await readState())
    // Restore for the specs that follow: light preference beats the emulated
    // dark OS scheme, leaving the shared page in the light default.
    await page.locator('[data-settings-page]').getByRole('button', { name: '浅色' }).click()
    await expect.poll(async () => (await readState()).attr, { timeout: 5_000 }).toBe(false)
    expectThemeColorSynchronized(await readState())
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('persists the busy-state Enter behavior across reload and a distinct port', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-enter-behavior'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.locator('[data-settings-page]')
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '排队发送' }).click()
    await page.getByRole('menuitem', { name: '插话发送' }).click()
    await settings.getByRole('button', { name: '插话发送' }).waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => localStorage.getItem('dsh.conversation.busyEnter'))).toBeNull()
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-conversation:\n\s+busyEnter: steer/)
    await page.keyboard.press('Escape')

    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const reloadedSettings = page.locator('[data-settings-page]')
    await reloadedSettings.getByRole('button', { name: '插话发送' }).waitFor({ timeout: 10_000 })

    const second = await launchWebScaffold({ harnessHome: scaffold.harnessHome })
    const secondPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    const secondTripwire = watchConsole(secondPage)
    try {
      expect(second.baseUrl).not.toBe(scaffold.baseUrl)
      await secondPage.goto(second.baseUrl, { waitUntil: 'load' })
      await secondPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await secondPage.getByRole('button', { name: '设置', exact: true }).click()
      await secondPage.locator('[data-settings-page]')
        .getByRole('button', { name: '插话发送' }).waitFor({ timeout: 10_000 })
      expect(await secondPage.evaluate(() => localStorage.getItem('dsh.conversation.busyEnter'))).toBeNull()
      expect(secondTripwire.pageErrors).toEqual([])
      expect(secondTripwire.warnings).toEqual([])
    } finally {
      await secondPage.close()
      await second.close()
    }

    await reloadedSettings.getByRole('button', { name: '插话发送' }).click()
    await page.getByRole('menuitem', { name: '排队发送' }).click()
    await reloadedSettings.getByRole('button', { name: '排队发送' }).waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => localStorage.getItem('dsh.conversation.busyEnter'))).toBeNull()
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-conversation:\n\s+busyEnter: queue/)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('persists the settings language across reload and a distinct port', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-language'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const zhSettings = page.locator('[data-settings-page]')
    await zhSettings.waitFor({ timeout: 10_000 })
    // The document language follows the active locale in the assembled app, not
    // only on a directly-mounted plugin. This is a zh browser, so the served
    // markup's `en` must already have been replaced — asserting it here (rather
    // than only in an English scenario) is what makes the check discriminating.
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN')
    // The Language selector pill shows the active locale's own name.
    const selector = zhSettings.getByRole('button', { name: '中文' })
    expect(await selector.getAttribute('aria-haspopup')).toBe('menu')
    await selector.click()
    await page.getByRole('menuitem', { name: 'English' }).click()
    // The settings-owned copy re-registers localized: page title, nav,
    // Appearance labels. (Only the settings namespaces are localized —
    // the rest of the app's copy is intentionally out of this row's scope.)
    const enSettings = page.locator('[data-settings-page]')
    await enSettings.waitFor({ timeout: 10_000 })
    // ...and the attribute follows that switch, in the assembled app.
    await expect.poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 5_000 }).toBe('en')
    expect(await enSettings.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page')
    await expect.poll(() => enSettings.getByText('Appearance', { exact: true }).count(), { timeout: 5_000 }).toBe(1)
    expect(await page.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: en/)
    // Reload keeps English; then restore zh so shared page state (and the
    // other specs' 设置-anchored selectors + goldens) see the default again.
    // Leave the routed page first (Escape steps back to the app root): a
    // reload at /settings would re-boot the settings page open and bury the
    // trigger under its inert covering layer.
    await page.keyboard.press('Escape')
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    const enTrigger = page.getByRole('button', { name: 'Settings' })
    await enTrigger.waitFor({ timeout: 10_000 })

    // A Chinese browser on another port still receives the explicit English
    // preference from the shared Host settings document.
    const second = await launchWebScaffold({ harnessHome: scaffold.harnessHome })
    const secondPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    const secondTripwire = watchConsole(secondPage)
    try {
      expect(second.baseUrl).not.toBe(scaffold.baseUrl)
      await secondPage.goto(second.baseUrl, { waitUntil: 'load' })
      await secondPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await secondPage.getByRole('button', { name: 'Settings', exact: true }).click()
      await secondPage.locator('[data-settings-page]')
        .getByRole('button', { name: 'English' }).waitFor({ timeout: 10_000 })
      expect(await secondPage.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
      expect(secondTripwire.pageErrors).toEqual([])
      expect(secondTripwire.warnings).toEqual([])
    } finally {
      await secondPage.close()
      await second.close()
    }

    await enTrigger.click()
    await page.locator('[data-settings-page]').getByRole('button', { name: 'English' }).click()
    await page.getByRole('menuitem', { name: '中文' }).click()
    await page.locator('[data-settings-page]').waitFor({ timeout: 10_000 })
    expect(await page.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/locale:\n\s+preference: zh/)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('opens an English browser in English without any stored preference', async () => {
    // A fresh Host home has no locale preference, so its surface follows the
    // browser. English is also FALLBACK_LOCALE, so this scenario alone cannot
    // distinguish detection from the default — the zh scenarios above supply
    // the discriminating half (a Chinese browser must NOT land on the default).
    const fresh = await launchWebScaffold({})
    const enPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
    const enTripwire = watchConsole(enPage)
    onTestFailed(() => saveFailureShot(enPage, 'web-e2e-settings-browser-language'))
    try {
      await enPage.goto(fresh.baseUrl, { waitUntil: 'load' })
      await enPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      expect(await enPage.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
      await enPage.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = enPage.locator('[data-settings-page]')
      await settings.waitFor({ timeout: 10_000 })
      await settings.getByRole('button', { name: 'English' }).waitFor({ timeout: 10_000 })
      // This page has no closing inventory spec to sweep its console, so the
      // scenario clears both tripwire channels itself.
      expect(enTripwire.pageErrors).toEqual([])
      expect(enTripwire.warnings).toEqual([])
    } finally {
      await enPage.close()
      await fresh.close()
    }
  }, 90_000)

  it('opens a browser asking for no shipped language in English', async () => {
    // The product default for "no usable signal": a French browser ships
    // neither zh nor en, so resolution falls to FALLBACK_LOCALE (en) rather
    // than to Chinese.
    const fresh = await launchWebScaffold({})
    const frPage = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'fr-FR' })
    const frTripwire = watchConsole(frPage)
    onTestFailed(() => saveFailureShot(frPage, 'web-e2e-settings-unshipped-language'))
    try {
      await frPage.goto(fresh.baseUrl, { waitUntil: 'load' })
      await frPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      expect(await frPage.evaluate(() => localStorage.getItem('dsh.locale'))).toBeNull()
      await frPage.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = frPage.locator('[data-settings-page]')
      await settings.waitFor({ timeout: 10_000 })
      await settings.getByRole('button', { name: 'English' }).waitFor({ timeout: 10_000 })
      // The markup already ships `en`, so this alone cannot prove the sync ran
      // — the zh scenario above is the discriminating half. Asserted here too
      // so a future change that resolves en but writes the wrong tag is caught.
      expect(await frPage.evaluate(() => document.documentElement.lang)).toBe('en')
      // Golden of the English fallback page — the visible output this change
      // produces. The zh golden above covers the detected-locale surface, so
      // the pair pins both directions of the resolution.
      const snapshot = await captureStableAria(frPage, '[data-settings-page]', fresh.workspaceCwd)
      await compareOrRefreshGolden(DIALOG_EN_EXPECTED, snapshot, MODE)
      expect(frTripwire.pageErrors).toEqual([])
      expect(frTripwire.warnings).toEqual([])
    } finally {
      await frPage.close()
      await fresh.close()
    }
  }, 90_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['dialog-en.expected.md', 'dialog.expected.md', 'plugins.expected.md'])
  })
})
