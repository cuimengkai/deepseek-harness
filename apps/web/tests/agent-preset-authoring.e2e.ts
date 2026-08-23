// Web e2e scenario: the agent-preset settings section as copy-only authoring.
// The browser never edits composition text — a shipped preset opens as a
// read-only design page, the copy dialog collects an id and an optional display
// name, and the host copies the whole directory. The section's other job is
// getting the user TO the files: this lane pins `nativeOpen: false` (see the
// overlay), so the location affordance answers the preset directory as text —
// the deterministic branch a golden can hold on every platform.
//
// Zero model calls: no replay fixture mounts, so a stray stream fails loud.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Locator } from 'playwright'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-preset-authoring', import.meta.url))
const SECTION_EXPECTED = join(SNAPSHOT_DIR, 'section.expected.md')
const COPY_DIALOG_EXPECTED = join(SNAPSHOT_DIR, 'copy-settings.expected.md')
const CREATED_EXPECTED = join(SNAPSHOT_DIR, 'created.expected.md')
const DAMAGED_EXPECTED = join(SNAPSHOT_DIR, 'damaged.expected.md')
/** The shipped roster, beside the composition that names it. */
const SHIPPED_PRESETS = fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./agent-preset-authoring.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()
/** The tool module the handoff lane drags in so the draft is non-empty. */
const STR_REPLACE = '@deepseek-ai/dsh-tool-str-replace-editor'

describe('web e2e: agent-preset authoring is a host-side copy', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let userRoot: string

  /** The settings page, opened on the Agent-presets section. */
  function settingsPage(): Locator {
    return page.locator('[data-settings-page]')
  }

  /** Native HTML5 drag of a palette card into the empty canvas slot. */
  async function dragOnto(source: Locator, target: Locator): Promise<void> {
    const from = await source.boundingBox()
    const to = await target.boundingBox()
    if (from === null || to === null) throw new Error('authoring e2e: drag bounds unavailable')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()
  }

  /** Tokenize the lane-owned preset root after general aria normalization. */
  function withPresetRoot(snapshot: string): string {
    const rootSuffix = `/${userRoot.split('/').pop()!}`
    return snapshot.split('\n').map((line) => {
      const rootStart = line.indexOf(rootSuffix)
      if (rootStart === -1) return line
      const pathStart = line.lastIndexOf(' ', rootStart) + 1
      return `${line.slice(0, pathStart)}{{presetRoot}}${line.slice(rootStart + rootSuffix.length)}`
    }).join('\n')
  }

  beforeAll(async () => {
    userRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-e2e-presets-')))
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

  it('offers the roster with copy as the only way to create', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-authoring-section'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = settingsPage()
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: 'Agent 预设' }).click()
    await settings.getByRole('heading', { name: 'Agent 预设' }).waitFor({ timeout: 10_000 })
    await settings.getByText('标准模式').first().waitFor({ timeout: 10_000 })

    const snapshot = await captureStableAria(page, '[data-settings-page]', scaffold.workspaceCwd)

    await compareOrRefreshGolden(SECTION_EXPECTED, snapshot, MODE)
    // The intro carries the guidance a create button used to imply, and the
    // shipped rows offer view/copy but never delete or a location — their
    // install is overwritten by upgrades and is not the user's to manage.
    expect(snapshot).toContain('或用「创造模式」让 Agent 帮你创建')
    expect(snapshot).not.toContain('新建预设')
    expect(snapshot).toContain('查看: 标准模式')
    expect(snapshot).not.toContain('删除: 标准模式')
    expect(snapshot).not.toContain('打开目录')
  }, 60_000)

  it('views a shipped composition as a read-only design page', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-authoring-view'))
    const settings = settingsPage()
    await settings.getByRole('button', { name: '查看: 标准模式' }).click()

    // The design page: the composer head names the preset under the view title
    // and the shipped chain renders on the canvas, instead of a read-only
    // dialog holding the raw YAML.
    await settings.getByRole('heading', { name: '查看 · 标准模式' }).waitFor({ timeout: 10_000 })
    await settings.getByRole('heading', { name: '组合', exact: true }).waitFor({ timeout: 10_000 })
    await settings.locator('[data-row-id="persona"]').waitFor({ timeout: 10_000 })

    // The whole shipped chain is on the canvas, first row to last.
    const rows = await settings.locator('[data-row-id]').evaluateAll(
      nodes => nodes.map(node => node.getAttribute('data-row-id') as string),
    )
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]).toBe('persona')

    // Read-only means exactly that: no palette to drag from, no id/name fields,
    // no save, and the nodes neither drag nor offer a remove control.
    expect(await settings.getByPlaceholder('搜索插件').count()).toBe(0)
    expect(await settings.getByRole('textbox').count()).toBe(0)
    expect(await settings.getByRole('button', { name: '保存' }).count()).toBe(0)
    expect(await settings.locator('[data-row-id]').first().getAttribute('draggable')).toBe('false')
    expect(await settings.getByRole('button', { name: /^移除:/ }).count()).toBe(0)

    // Back returns to the roster. The composer's back button carries its own
    // aria-label, distinct from the settings chrome's text-only 返回 button.
    await settings.locator('button[aria-label="返回"]').click()
    await settings.getByRole('heading', { name: 'Agent 预设' }).waitFor({ timeout: 10_000 })
  }, 60_000)

  it('copies 极简模式 whole under a new id and lands in its files', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-authoring-copy'))
    const settings = settingsPage()
    await settings.getByRole('button', { name: '复制: 极简模式' }).click()
    const copyDialog = page.getByRole('dialog', { name: '复制预设 · 复制自 极简模式' })
    await copyDialog.waitFor({ timeout: 10_000 })

    const dialogSnapshot = await captureStableAria(
      page, '[role="dialog"][aria-label^="复制预设"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(COPY_DIALOG_EXPECTED, dialogSnapshot, MODE)
    // Two fields and nothing else: the id is the directory name the host
    // needs up front; description and composition live in the files.
    expect(dialogSnapshot).toContain('标识符')
    expect(dialogSnapshot).not.toContain('描述')

    await copyDialog.getByPlaceholder('my-agent').fill('my-agent')
    await copyDialog.getByPlaceholder('选择器中显示的名字，缺省用标识符').fill('我的模式')
    await copyDialog.getByRole('button', { name: '创建' }).click()
    await copyDialog.waitFor({ state: 'detached', timeout: 10_000 })

    // The new row lands in the custom group, and — with no desktop opener —
    // its directory is revealed as text right away: landing in the files is
    // the completion of a copy, not a follow-up.
    await settings.getByText('我的模式').first().waitFor({ timeout: 10_000 })
    await settings.getByText('预设文件：').waitFor({ timeout: 10_000 })
    // The copy dialog is detached, so the settings page is the only surface
    // left; its aria role is none, so the data attribute selects it.
    const snapshot = withPresetRoot(
      await captureStableAria(page, '[data-settings-page]', scaffold.workspaceCwd))
    await compareOrRefreshGolden(CREATED_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('{{presetRoot}}/my-agent')

    // The host copied the whole directory and rewrote only the display
    // metadata: the composition is byte-identical to the shipped source, the
    // description rides along for the user to edit in place, and neither the
    // source's name nor its roster order survives into the copy.
    const composition = await readFile(join(userRoot, 'my-agent', 'agent.cordis.yml'), 'utf8')
    expect(composition).toBe(await readFile(join(SHIPPED_PRESETS, 'minimal', 'agent.cordis.yml'), 'utf8'))
    const metadata = await readFile(join(userRoot, 'my-agent', 'preset.yml'), 'utf8')
    expect(metadata).toContain('name: 我的模式')
    expect(metadata).toContain('description: 仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。')
    expect(metadata).not.toContain('order:')
  }, 60_000)

  it('deletes the copy after confirmation and reclaims the roster', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-authoring-delete'))
    const settings = settingsPage()
    await settings.getByRole('button', { name: '删除: 我的模式' }).click()
    const confirm = page.getByRole('dialog', { name: '删除该预设？' })
    await confirm.waitFor({ timeout: 10_000 })
    await confirm.getByRole('button', { name: '删除', exact: true }).click()
    await confirm.waitFor({ state: 'detached', timeout: 10_000 })

    await expect.poll(async () => settings.getByText('我的模式').count(), { timeout: 10_000 }).toBe(0)
    expect(existsSync(join(userRoot, 'my-agent'))).toBe(false)
    // The custom group outlives its only member: the heading stays with the
    // new-agent entry so the place to author a preset never disappears.
    expect(await settings.getByRole('heading', { name: '自定义' }).count()).toBe(1)
    expect(await settings.getByRole('button', { name: '新建 Agent' }).count()).toBe(1)
    expect(await settings.getByText('标准模式').count()).toBeGreaterThan(0)
  }, 60_000)

  it('marks damaged presets broken and clears a ghost through delete', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-authoring-damaged'))
    // The two hand-edit damage shapes: a composition that no longer parses,
    // and a directory whose composition file was deleted outright.
    await mkdir(join(userRoot, 'broken-yaml'), { recursive: true })
    await writeFile(join(userRoot, 'broken-yaml', 'agent.cordis.yml'), '- id: x\n  name: [unclosed\n')
    await mkdir(join(userRoot, 'ghost'), { recursive: true })
    await writeFile(join(userRoot, 'ghost', 'preset.yml'), 'name: 幽灵预设\ndescription: composition 已被手动删除。\n')

    // The section reads the roster when it mounts; hop away and back.
    const settings = settingsPage()
    await settings.getByRole('button', { name: '通用设置' }).click()
    await settings.getByRole('button', { name: 'Agent 预设' }).click()
    await settings.getByText('加载失败').first().waitFor({ timeout: 10_000 })

    const snapshot = withPresetRoot(
      await captureStableAria(page, '[data-settings-page]', scaffold.workspaceCwd))
    await compareOrRefreshGolden(DAMAGED_EXPECTED, snapshot, MODE)
    // Both damage shapes surface as marked, unselectable, uncopyable cards
    // that still carry their metadata and the discovery-reported reason.
    expect(snapshot).toContain('加载失败: broken-yaml')
    expect(snapshot).toContain('加载失败: 幽灵预设')
    expect(snapshot).toContain('not valid YAML')
    expect(snapshot).toContain('agent.cordis.yml is missing')
    expect(await settings.getByRole('button', { name: '加载失败: broken-yaml' }).isDisabled()).toBe(true)
    expect(await settings.getByRole('button', { name: '复制: 幽灵预设' }).isDisabled()).toBe(true)
    // A broken card offers no "set default" affordance at all — the aria name
    // IS the broken marking, so the picking name must not exist.
    expect(await settings.getByRole('button', { name: '设为默认: broken-yaml' }).count()).toBe(0)

    // The ghost's way out is the card's own delete — and the id it blocked
    // is claimable again immediately afterwards.
    await settings.getByRole('button', { name: '删除: 幽灵预设' }).click()
    const confirm = page.getByRole('dialog', { name: '删除该预设？' })
    await confirm.waitFor({ timeout: 10_000 })
    await confirm.getByRole('button', { name: '删除', exact: true }).click()
    await confirm.waitFor({ state: 'detached', timeout: 10_000 })
    await expect.poll(async () => settings.getByText('幽灵预设').count(), { timeout: 10_000 }).toBe(0)
    expect(existsSync(join(userRoot, 'ghost'))).toBe(false)

    await settings.getByRole('button', { name: '复制: 极简模式' }).click()
    const copyDialog = page.getByRole('dialog', { name: '复制预设 · 复制自 极简模式' })
    await copyDialog.waitFor({ timeout: 10_000 })
    await copyDialog.getByPlaceholder('my-agent').fill('ghost')
    await copyDialog.getByRole('button', { name: '创建' }).click()
    await copyDialog.waitFor({ state: 'detached', timeout: 10_000 })
    await settings.getByRole('button', { name: '设为默认: ghost' }).waitFor({ timeout: 10_000 })

    // Leave the roster as the earlier tests shaped it.
    await settings.getByRole('button', { name: '删除: ghost' }).click()
    const cleanup = page.getByRole('dialog', { name: '删除该预设？' })
    await cleanup.waitFor({ timeout: 10_000 })
    await cleanup.getByRole('button', { name: '删除', exact: true }).click()
    await cleanup.waitFor({ state: 'detached', timeout: 10_000 })
    await rm(join(userRoot, 'broken-yaml'), { recursive: true, force: true })
  }, 60_000)

  it('hands a composed draft to creator mode and lands in its session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-preset-authoring-creator'))
    // Without a workspace the flow only stages (there is no session to land
    // in until one is connected); connect first so the gesture carries all
    // the way to a composed host session.
    await settingsPage().getByRole('button', { name: '关闭' }).last().click()
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = settingsPage()
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: 'Agent 预设' }).click()

    // The composer's handoff is the creator entry: drag one plugin in so the
    // draft is non-empty, then hand the composition over.
    await settings.getByRole('button', { name: '新建 Agent' }).click()
    await settings.getByRole('heading', { name: '新建 Agent' }).waitFor({ timeout: 10_000 })
    await settings.getByPlaceholder('搜索插件').fill('str-replace-editor')
    await settings.getByText(STR_REPLACE).waitFor({ timeout: 10_000 })
    await dragOnto(settings.getByText(STR_REPLACE), settings.getByText('把插件拖到这里'))
    await settings.locator('[data-row-id="tool-str-replace-editor"]').waitFor({ timeout: 10_000 })
    await settings.getByPlaceholder('my-agent').fill('my-agent')
    await settings.getByRole('button', { name: '让 Agent 帮我搭建/完善' }).click()

    // Leaving settings is part of the gesture: the flow saves the draft, lands
    // on the new-session screen with the self-referential preset staged, and
    // the blank session the flow produces composes from it on the host.
    await settings.waitFor({ state: 'detached', timeout: 10_000 })
    await page.getByRole('button', { name: '创造模式' }).waitFor({ timeout: 10_000 })
    await expect.poll(async () => {
      const response = await fetch(`${scaffold.baseUrl}/api/session.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request', rpcId: 'creator-draft-handoff', method: 'session.list', payload: {},
        }),
      })
      const body = await response.json() as {
        result: { value?: { sessions: unknown[] } }
      }
      return JSON.stringify(body.result.value?.sessions ?? body.result)
    }, { timeout: 15_000 }).toContain('"agentPreset":"cordis"')

    // Save-then-handoff: the drafted composition is already on disk before
    // the creator session picks it up.
    const handed = await readFile(join(userRoot, 'my-agent', 'agent.cordis.yml'), 'utf8')
    expect(handed).toContain(`name: '${STR_REPLACE}'`)
  }, 60_000)

  it('drove every surface without a page error or a stream warning', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
