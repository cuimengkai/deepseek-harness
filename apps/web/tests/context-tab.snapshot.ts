// @vitest-environment jsdom
// Assembled context-tab snapshot: boots the real built workspace client
// bundles through AppWebEntry's ModuleLoader path against the keyless
// FixtureApiClient transport (no API key, no model round), opens the fixture
// session, and pins the surface the context view tab renders — the fixed
// summary header, the capacity bar legend, the grouped tree (envelope rows,
// priced surface rows, and the compaction group), and the selected row's
// detail pane. The fixture log
// carries a recorded route capacity, so the capacity bar pins its free tail
// figure too.
//
// Keyless and deterministic: the fixture is the fake server, so the
// composition the tab reads folds from the fixture's own committed log, not
// from a live model. The per-package suites bench the controller's state
// machine over src; here the assembled bundles prove the registration, the
// wire projection, and the rendering survive the real bundle path.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/context-tab/ui.expected.txt')

installAssembledBootEnv()

/** Flatten a rendered element to stable `name=value` text lines: direct text
 *  of the element then of each descendant that carries exactly one text node. */
function textLines(root: Element): string[] {
  const lines: string[] = []
  const walk = (el: Element): void => {
    const own = [...el.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => (node.textContent ?? '').trim())
      .join(' ')
    if (own !== '') lines.push(own)
    for (const child of el.children) walk(child)
  }
  walk(root)
  return lines
}

/** Serialize the context tab to stable lines: the fixed summary header's
 *  identity row, the capacity legend, the tree groups with their rows, and
 *  the detail pane. */
function contextShape(root: Element): string {
  const lines: string[] = []
  lines.push(...headShape(root))
  const legend = [...root.querySelectorAll('*')].filter(el => hasClass(el, 'capacityLegend'))[0]
  if (legend !== undefined) lines.push(...textLines(legend).map(line => `legend=${line}`))
  const tree = [...root.querySelectorAll('*')].filter(el => hasClass(el, 'tree'))[0]
  if (tree !== undefined) {
    for (const line of textLines(tree)) lines.push(`tree=${line}`)
  }
  lines.push(...detailShape(root))
  return lines.join('\n')
}

/** Serialize only the detail pane (the surface-selection re-render arm). */
function detailShape(root: Element): string[] {
  const detail = [...root.querySelectorAll('*')].filter(el => hasClass(el, 'detail'))[0]
  if (detail === undefined) return []
  return textLines(detail).map(line => `detail=${line}`)
}

/** Serialize the fixed summary header's identity row (model, provider,
 *  used/window, log revision). */
function headShape(root: Element): string[] {
  const head = [...root.querySelectorAll('*')].filter(el => hasClass(el, 'summaryHead'))[0]
  return head === undefined ? [] : textLines(head).map(line => `head=${line}`)
}

/** Serialize the range action bar (present only while a range is active). */
function rangeShape(root: Element): string[] {
  const bar = [...root.querySelectorAll('*')].filter(el => hasClass(el, 'rangeBar'))[0]
  if (bar === undefined) return []
  return textLines(bar).map(line => `range=${line}`)
}

/** Serialize one tree group's title/count row pair, matched by title text. */
function groupCountShape(root: Element, title: string): string[] {
  const group = [...root.querySelectorAll('*')]
    .filter(el => hasClass(el, 'treeGroup'))
    .find(el => (el.textContent ?? '').includes(title))
  if (group === undefined) return []
  const head = [...group.children].filter(el => hasClass(el, 'treeGroupTitle'))[0]
  return head === undefined ? [] : [`group=${head.textContent?.replace(/\s+/g, ' ').trim() ?? ''}`]
}

/** The compaction-history rows the tree currently lists. */
function compactionRows(root: Element): string[] {
  const group = [...root.querySelectorAll('*')]
    .filter(el => hasClass(el, 'treeGroup'))
    .find(el => (el.textContent ?? '').includes('Compaction history'))
  if (group === undefined) return []
  return [...group.querySelectorAll('button')]
    .map(button => `compaction=${button.textContent?.replace(/\s+/g, ' ').trim() ?? ''}`)
}

/** Wait for the context view's body to replace its centered loading frame. */
async function awaitContextBody(): Promise<Element> {
  return await waitFor(() => {
    const found = document.querySelector('[data-context-view]')
    expect(found, 'context view body must mount once the wire answers').not.toBeNull()
    return found!
  }, { timeout: 10_000 })
}

describe('assembled context tab', () => {
  it('renders the capacity bar, tree, and detail pane from the built bundles', async () => {
    mountAssembledApp()

    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
    await waitFor(() => {
      expect(document.querySelector('[data-sample="bash"]')).not.toBeNull()
    }, { timeout: 10_000 })

    // The tab ring carries the context view's registration (order after the
    // trajectory tab); opening it mounts the read through the fixture wire.
    const tab = await screen.findByRole('tab', { name: 'Context' }, { timeout: 10_000 })
    act(() => { fireEvent.click(tab) })

    // The body replaces the centered loading frame once the fixture wire
    // answers; the capacity legend's free-tail figure proves the recorded
    // route capacity reached the bar (128_000 window over the fixture log).
    const root = await awaitContextBody()

    let shape = contextShape(root)
    // Pin the default selection (system prompt) first, then a surface row
    // with a preview: the detail pane must re-render the selected row. Only
    // the detail pane repeats — the tree and legend are selection-invariant.
    const surfaceRow = await waitFor(() => {
      const row = [...root.querySelectorAll('button')]
        .find(button => (button.textContent ?? '').includes('#'))
      if (row === undefined) throw new Error('context tree has no surface row')
      return row
    }, { timeout: 10_000 })
    act(() => { fireEvent.click(surfaceRow) })
    shape += '\n--surface selection--\n' + detailShape(root).join('\n')

    // Range selection: shift-click extends from the anchored row (#2) to #9;
    // the action bar summarizes the inclusive span (3 rows, 15+15+15 tokens).
    // The row's `#9` label is its own span, so match on that element rather
    // than the button's concatenated text.
    const targetRow = [...root.querySelectorAll('button')]
      .find(button => [...button.querySelectorAll('*')]
        .some(el => hasClass(el, 'rowLabel') && (el.textContent ?? '') === '#9'))
    expect(targetRow, 'context tree must carry the #9 surface row').toBeDefined()
    act(() => { fireEvent.click(targetRow!, { shiftKey: true }) })
    shape += '\n--range selection--\n' + rangeShape(root).join('\n')

    // The trigger routes /compact 2:9 through the commands Remote; the fixture
    // commits the real durable marker + surface replacement, so the reloaded
    // composition shows the shrunken surface and the compaction-history row.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Compact selection' })) })
    // The composition reload can remount the view body, so re-query the live
    // element instead of holding the pre-compaction reference.
    const liveRoot = (): Element => document.querySelector('[data-context-view]') ?? root
    await waitFor(() => {
      expect(compactionRows(liveRoot()).length, 'compaction history must gain the committed marker').toBe(1)
    }, { timeout: 10_000 })
    shape += '\n--post-compaction--\n' + [
      ...groupCountShape(liveRoot(), 'Conversation surface'),
      ...compactionRows(liveRoot()),
      ...headShape(liveRoot()),
    ].join('\n')

    // Selecting the compaction row pins the checkpoint detail the tab renders
    // from the durable marker (provider/model, shadowed span, summary text).
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Compaction #/ })) })
    shape += '\n--compaction detail--\n' + detailShape(liveRoot()).join('\n')

    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
  })
})
