// Web e2e scenario: the agent-preset settings section as a horizontal pipeline
// composer. An agent IS a plugin composition backed by agent.cordis.yml, and
// the composer assembles one by dragging installed plugins out of the
// annotated inventory palette into a canvas chain, reordering nodes within it,
// removing them, and saving. The browser never writes YAML: it sends ROW
// STRUCTURES over the wire, and the host re-checks that every named module is
// installed before the file is touched. This lane drives the real HTML5 DnD
// the component listens to (Playwright's native mouse sequence, releasing left
// of a target node's midpoint for the reorder), then asserts the target user
// preset's agent.cordis.yml landed on disk with exactly the composed rows.
//
// Reuses the authoring lane's overlay: the api-gateway pin (nativeOpen:
// false, provider/model) is the same shared composition fact that lane
// drives, and this lane asserts no location affordance of its own.
//
// Zero model calls: no replay fixture mounts, so a stray stream fails loud.
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-preset-composer', import.meta.url))
const COMPOSER_OPEN_EXPECTED = join(SNAPSHOT_DIR, 'composer-open.expected.md')
const COMPOSER_ROWS_EXPECTED = join(SNAPSHOT_DIR, 'composer-rows.expected.md')
/** The shipped roster, beside the composition that names it. */
const SHIPPED_PRESETS = fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./agent-preset-authoring.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()

/** The two tool modules the composer lane drags: shipped rows the web bundle keeps in the inventory. */
const STR_REPLACE = '@deepseek-ai/dsh-tool-str-replace-editor'
const TOOL_BASH = '@deepseek-ai/dsh-tool-bash'

describe('web e2e: agent-preset composer assembles an agent by dragging plugins', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let userRoot: string

  /** The settings page, opened on the Agent-presets section. */
  function settingsPage(): Locator {
    return page.locator('[data-settings-page]')
  }

  /** The composition of the open composer: the pipeline canvas zone. The head
   * label now sits above the canvas (so a floating panel never covers it), so
   * the zone is reached by its own data attribute rather than the label's
   * parent. */
  function composition(): Locator {
    return settingsPage().locator('[data-composition]')
  }

  /** The composition's row ids, in chain order (the exact order to assert). */
  async function rowIds(): Promise<string[]> {
    return composition().locator('[data-row-id]').evaluateAll(
      nodes => nodes.map(node => node.getAttribute('data-row-id') as string),
    )
  }

  /**
   * Native HTML5 drag of one element onto a point inside another, as fractions
   * of the target's box; the canvas resolves the drop by `clientX`, so the
   * horizontal fraction is what places the slot.
   */
  async function dragOnto(
    source: Locator,
    target: Locator,
    drop = { fx: 0.5, fy: 0.5 },
  ): Promise<void> {
    const from = await source.boundingBox()
    const to = await target.boundingBox()
    if (from === null || to === null) throw new Error('composer e2e: drag bounds unavailable')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width * drop.fx, to.y + to.height * drop.fy, { steps: 12 })
    await page.mouse.up()
  }

  /** Drag one composition row so it lands before the node it is dropped on. */
  async function dragRowBefore(source: Locator, target: Locator): Promise<void> {
    // The drop slot is the target node's horizontal midpoint (strictly-greater
    // comparison), so releasing in the node's left half is reliably "before".
    // fx 0.4 keeps the point on-canvas even when the node's own left edge is
    // clipped by the reorder scroll.
    await dragOnto(source, target, { fx: 0.4, fy: 0.5 })
  }

  /** Scroll the canvas so the last node's center sits just inside its right
   * edge. A long chain clips whichever node is off to either side; for short
   * chains the canvas fits without scrolling, so this is a no-op. */
  async function scrollCanvasForReorder(): Promise<void> {
    await page.locator('[data-canvas]').evaluate((el) => {
      const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-row-index]'))
      const last = nodes[nodes.length - 1]
      if (last === undefined) return
      const rect = el.getBoundingClientRect()
      const lastRect = last.getBoundingClientRect()
      el.scrollLeft += lastRect.left + lastRect.width / 2 - (rect.right - 24)
    })
  }

  beforeAll(async () => {
    userRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-e2e-compose-')))
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      agentPresets: {
        roots: [
          { path: SHIPPED_PRESETS, trust: 'system' },
          { path: userRoot, trust: 'user' },
        ],
        default: 'standard',
      },
    })
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the composer with the installed-plugin palette and a blocked save', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-composer-open'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = settingsPage()
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: 'Agent 预设' }).click()
    await settings.getByRole('heading', { name: 'Agent 预设' }).waitFor({ timeout: 10_000 })
    await settings.getByText('标准模式').first().waitFor({ timeout: 10_000 })

    // A shipped preset has no compose button: its composition is the
    // known-good copy source, and rows stay read-only until a copy is the
    // user's own.
    expect(await settings.getByRole('button', { name: '编辑组合: 标准模式' }).count()).toBe(0)

    await settings.getByRole('button', { name: '新建 Agent' }).click()
    await settings.getByRole('heading', { name: '新建 Agent' }).waitFor({ timeout: 10_000 })

    // Filter the palette so the golden holds a small deterministic set.
    await settings.getByPlaceholder('搜索插件').fill('str-replace-editor')
    await settings.getByText(STR_REPLACE).waitFor({ timeout: 10_000 })

    const snapshot = await captureStableAria(page, '[data-settings-page]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(COMPOSER_OPEN_EXPECTED, snapshot, MODE)
    // The composer owns the section while open: empty composition, palette
    // chip offered, and the save blocked until an id and a row exist.
    expect(snapshot).toContain('把插件拖到这里')
    expect(snapshot).toContain(STR_REPLACE)
    expect(snapshot).toContain('请填写标识符')
    expect(await settings.getByRole('button', { name: '保存' }).isDisabled()).toBe(true)
  }, 60_000)

  it('drags rows in, reorders by drag, removes, and saves the agent composition', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-composer-rows'))
    const settings = settingsPage()

    // Drag the filtered chip into the empty composition.
    await dragOnto(settings.getByText(STR_REPLACE), settings.getByText('把插件拖到这里'))
    await settings.locator('[data-row-id="tool-str-replace-editor"]').waitFor({ timeout: 10_000 })
    expect(await rowIds()).toEqual(['tool-str-replace-editor'])

    // A second module: search, then drop in the last node's right half so the
    // slot resolves past its midpoint — the canvas places by clientX with a
    // strictly-greater comparison, so the right half is the append point.
    await settings.getByPlaceholder('搜索插件').fill('tool-bash')
    await settings.getByText(TOOL_BASH).waitFor({ timeout: 10_000 })
    await dragOnto(
      settings.getByText(TOOL_BASH),
      settings.locator('[data-row-index]').last(),
      { fx: 0.75, fy: 0.5 },
    )
    await expect.poll(async () => rowIds(), { timeout: 10_000 }).toEqual(['tool-str-replace-editor', 'tool-bash'])

    // Reorder the trailing node before the first. A two-node chain fits the
    // canvas without scrolling, so the scroll helper is a no-op here.
    await scrollCanvasForReorder()
    await dragRowBefore(
      composition().locator('[data-row-index]').nth(1),
      composition().locator('[data-row-index]').nth(0),
    )
    expect(await rowIds()).toEqual(['tool-bash', 'tool-str-replace-editor'])

    const snapshot = await captureStableAria(page, '[data-settings-page]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(COMPOSER_ROWS_EXPECTED, snapshot, MODE)

    // Remove one row, then name and save the agent.
    await settings.getByRole('button', { name: `移除: ${STR_REPLACE}` }).click()
    await settings.locator('[data-row-id="tool-str-replace-editor"]').waitFor({ state: 'detached', timeout: 10_000 })
    await settings.getByPlaceholder('my-agent').fill('my-agent')
    await settings.getByPlaceholder('选择器中显示的名字，缺省用标识符').fill('我的组合')
    await settings.getByRole('button', { name: '保存' }).click()

    // The composer closes and the roster shows the new user preset.
    await settings.getByRole('heading', { name: '新建 Agent' }).waitFor({ state: 'detached', timeout: 10_000 })
    await settings.getByText('我的组合').first().waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '编辑组合: 我的组合' }).waitFor({ timeout: 10_000 })

    // The host wrote exactly the rows the composition held.
    const written = await readFile(join(userRoot, 'my-agent', 'agent.cordis.yml'), 'utf8')
    expect(written).toContain('- id: tool-bash')
    expect(written).toContain(`name: '${TOOL_BASH}'`)
    expect(written).not.toContain('tool-str-replace-editor')
    const metadata = await readFile(join(userRoot, 'my-agent', 'preset.yml'), 'utf8')
    expect(metadata).toContain('name: 我的组合')
  }, 60_000)

  it('edits a user preset in place, appending a row and overwriting its composition', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-composer-edit'))
    const settings = settingsPage()
    // The overwrite path is user-root only: system presets keep no compose
    // button, and the new preset's editor re-opens its composed rows.
    expect(await settings.getByRole('button', { name: '编辑组合: 标准模式' }).count()).toBe(0)
    await settings.getByRole('button', { name: '编辑组合: 我的组合' }).click()
    await settings.getByRole('heading', { name: '编辑 Agent 组合' }).waitFor({ timeout: 10_000 })
    expect(await rowIds()).toEqual(['tool-bash'])
    expect(await settings.getByPlaceholder('my-agent').inputValue()).toBe('my-agent')
    expect(await settings.getByPlaceholder('选择器中显示的名字，缺省用标识符').inputValue()).toBe('我的组合')

    // Add one more module in the last node's right half, then save over.
    await settings.getByPlaceholder('搜索插件').fill('str-replace-editor')
    await settings.getByText(STR_REPLACE).waitFor({ timeout: 10_000 })
    await dragOnto(
      settings.getByText(STR_REPLACE),
      settings.locator('[data-row-index]').last(),
      { fx: 0.75, fy: 0.5 },
    )
    await expect.poll(async () => rowIds(), { timeout: 10_000 }).toEqual(['tool-bash', 'tool-str-replace-editor'])
    await settings.getByRole('button', { name: '保存' }).click()

    await settings.getByRole('heading', { name: '编辑 Agent 组合' }).waitFor({ state: 'detached', timeout: 10_000 })
    await settings.getByText('我的组合').first().waitFor({ timeout: 10_000 })

    // The overwrite kept the directory and re-rendered both rows in order.
    const written = await readFile(join(userRoot, 'my-agent', 'agent.cordis.yml'), 'utf8')
    expect(written.indexOf('tool-bash')).toBeLessThan(written.indexOf('tool-str-replace-editor'))
    expect(written).toContain(`name: '${TOOL_BASH}'`)
    expect(written).toContain(`name: '${STR_REPLACE}'`)
  }, 60_000)

  it('drove every surface without a page error or a stream warning', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
