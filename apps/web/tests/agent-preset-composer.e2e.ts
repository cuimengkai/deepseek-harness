// Web e2e scenario: the agent-preset settings section as a flow-canvas
// composer. An agent IS a plugin composition backed by agent.cordis.yml, and
// the composer assembles one by dragging installed plugins out of the
// annotated inventory palette onto the shared flow canvas, relinking the chain
// with the connect gesture, removing nodes through the inspector, and saving.
// The browser never writes YAML and never sends a path: it sends the
// composition as a flow graph, and the host projects the graph back to rows,
// re-checks that every named module is installed, and enforces the row
// invariants before the file is touched. This lane drives the real HTML5 DnD
// the component listens to (Playwright's native mouse sequence: palette card
// onto the canvas, and a node's port onto another node for the connect), then
// asserts the target user preset's agent.cordis.yml landed on disk with
// exactly the composed rows — the chain order the positional layout cannot
// show.
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

  /** The flow canvas's drop surface: the `.canvas` element behind the view
   * content. The view content carries the data-view attributes; the surface
   * that owns the drop handlers is its parent. */
  function canvas(): Locator {
    return settingsPage().locator('[data-view-x]').locator('xpath=..')
  }

  /** A canvas node by its internal id (`agent-1`, the terminals `start`/`end`). */
  function node(id: string): Locator {
    return settingsPage().locator(`[data-node-id="${id}"]`)
  }

  /**
   * Native HTML5 drag of one element onto a point inside another, as fractions
   * of the target's box; the canvas resolves the drop by `clientX`, so the
   * horizontal fraction is where the node is drawn.
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

  /** Drag one node's connect port onto another, relinking the chain so the
   * target runs right after the source. */
  async function connectAfter(sourceNode: Locator, targetNode: Locator): Promise<void> {
    const port = sourceNode.getByRole('button', { name: '把该节点接到此节点之后' })
    await dragOnto(port, targetNode)
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
    // The composer owns the section while open: the bare chain renders its
    // terminals, the palette chip is offered, the canvas hint names the
    // gestures, and the save is blocked until an id and a row exist.
    expect(snapshot).toContain('把插件拖入画布')
    expect(snapshot).toContain('开始')
    expect(snapshot).toContain('结束')
    expect(snapshot).toContain(STR_REPLACE)
    expect(snapshot).toContain('请填写标识符')
    expect(await settings.getByRole('button', { name: '保存' }).isDisabled()).toBe(true)
  }, 60_000)

  it('drags rows in, relinks the chain by connect, and saves the agent composition', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-composer-rows'))
    const settings = settingsPage()

    // Drag the filtered chip onto the canvas: the chain appends it, and the
    // drop position is where the node is drawn.
    await dragOnto(settings.getByText(STR_REPLACE), canvas(), { fx: 0.5, fy: 0.5 })
    await node('agent-1').waitFor({ timeout: 10_000 })

    // A second module, dropped to the right so the nodes stay apart.
    await settings.getByPlaceholder('搜索插件').fill('tool-bash')
    await settings.getByText(TOOL_BASH).waitFor({ timeout: 10_000 })
    await dragOnto(settings.getByText(TOOL_BASH), canvas(), { fx: 0.7, fy: 0.5 })
    await node('agent-2').waitFor({ timeout: 10_000 })

    // Relink the chain so bash runs before str-replace: connect agent-2's port
    // onto agent-1. The layout is positional, so the proof is the saved rows.
    // A drop auto-selects the new node, which floats the inspector over the
    // right edge and covers the selected node's port; click the canvas
    // background first so the port is reachable.
    const canvasBox = await canvas().boundingBox()
    if (canvasBox !== null) {
      await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.9)
    }
    await connectAfter(node('agent-2'), node('agent-1'))

    const snapshot = await captureStableAria(page, '[data-settings-page]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(COMPOSER_ROWS_EXPECTED, snapshot, MODE)

    // Name and save the agent.
    await settings.getByPlaceholder('my-agent').fill('my-agent')
    await settings.getByPlaceholder('选择器中显示的名字，缺省用标识符').fill('我的组合')
    await settings.getByRole('button', { name: '保存' }).click()

    // The composer closes and the roster shows the new user preset.
    await settings.getByRole('heading', { name: '新建 Agent' }).waitFor({ state: 'detached', timeout: 10_000 })
    await settings.getByText('我的组合').first().waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '编辑组合: 我的组合' }).waitFor({ timeout: 10_000 })

    // The host wrote exactly the rows the composition held, in the chain order
    // the connect gesture established.
    const written = await readFile(join(userRoot, 'my-agent', 'agent.cordis.yml'), 'utf8')
    expect(written.indexOf('tool-bash')).toBeLessThan(written.indexOf('tool-str-replace-editor'))
    expect(written).toContain(`name: '${TOOL_BASH}'`)
    expect(written).toContain(`name: '${STR_REPLACE}'`)
    const metadata = await readFile(join(userRoot, 'my-agent', 'preset.yml'), 'utf8')
    expect(metadata).toContain('name: 我的组合')
  }, 60_000)

  it('edits a user preset in place, removing a node and overwriting its composition', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-composer-edit'))
    const settings = settingsPage()
    // The overwrite path is user-root only: system presets keep no compose
    // button, and the new preset's editor re-opens its composed rows.
    expect(await settings.getByRole('button', { name: '编辑组合: 标准模式' }).count()).toBe(0)
    await settings.getByRole('button', { name: '编辑组合: 我的组合' }).click()
    await settings.getByRole('heading', { name: '编辑 Agent 组合' }).waitFor({ timeout: 10_000 })
    expect(await settings.locator('[data-node-id^="agent-"]').count()).toBe(2)
    expect(await settings.getByPlaceholder('my-agent').inputValue()).toBe('my-agent')
    expect(await settings.getByPlaceholder('选择器中显示的名字，缺省用标识符').inputValue()).toBe('我的组合')

    // Remove the str-replace node (agent-1, dropped first) through the
    // inspector: select the node, then remove.
    await node('agent-1').click()
    await settings.getByRole('button', { name: '移除', exact: true }).click()
    await node('agent-1').waitFor({ state: 'detached', timeout: 10_000 })

    await settings.getByRole('button', { name: '保存' }).click()
    await settings.getByRole('heading', { name: '编辑 Agent 组合' }).waitFor({ state: 'detached', timeout: 10_000 })
    await settings.getByText('我的组合').first().waitFor({ timeout: 10_000 })

    // The overwrite kept the directory and wrote the single remaining row
    // (the row serializer emits `name` before `id`).
    const written = await readFile(join(userRoot, 'my-agent', 'agent.cordis.yml'), 'utf8')
    expect(written).toContain('id: tool-bash')
    expect(written).toContain(`name: '${TOOL_BASH}'`)
    expect(written).not.toContain('tool-str-replace-editor')
  }, 60_000)

  it('drove every surface without a page error or a stream warning', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
