/**
 * Models section stylesheet contract, asserted against the CSS text on disk.
 *
 * The section paints in both themes, and a `--dsw-*` name the theme does not
 * declare fails silently: the browser takes the `var()` fallback, so the sheet
 * still renders and only the dark theme looks wrong. Checking the names against
 * the sheet that declares them is what turns that into a test failure.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/ModelsSection.module.css', import.meta.url)), 'utf8')
// The theme package maps `./styles/*` to `./src/styles/*`, so the declarations
// stay on the source plane rather than needing a build.
// Every theme sheet, not just the platform tokens: font and scrollbar
// variables are declared in siblings, and a gate reading one file would call
// their names undeclared.
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

/** The declarations of one top-level rule, by selector. */
function block(selector: string): string {
  const match = new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)
  if (match === null) throw new Error(`ModelsSection.module.css has no \`${selector}\` rule`)
  return match[1] ?? ''
}

describe('ModelsSection theme styles', () => {
  it('names only theme variables the token sheet defines', () => {
    // A `--dsw-*` name the sheet never declares is not a near miss: it silently
    // resolves to whatever literal sits in its fallback slot, which is how this
    // section stayed light under the dark theme before. Undeclared names have
    // no fallback at all and inherit, so both spellings must fail here.
    // Every theme-variable prefix the sheets actually use, not just `--dsw-`:
    // a `--dsh-` name reads as a plausible sibling and would otherwise slip
    // past this gate into a fallback literal.
    const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
    const undeclared = [...new Set(named)].filter(name => !tokens.includes(`  ${String(name)}:`))
    expect(undeclared).toEqual([])
    expect(css).not.toMatch(/var\(--(?:surface|text-|border|accent-strong)/)
  })

  it('closes every block, so no rule is swallowed by the one above it', () => {
    // A missing `}` on an `@media` block is not a parse error: every rule after
    // it silently becomes conditional, and the whole fetch dialog once painted
    // unstyled for anyone whose system does not ask for reduced motion. Nothing
    // downstream reports this — the sheet loads and the classes still attach.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect((bare.match(/\}/g) ?? []).length).toBe((bare.match(/\{/g) ?? []).length)
  })

  it('flows the add dialog as one auto-growing container', () => {
    // The pick dialog's contract: provider cells flow left-to-right then
    // top-to-bottom at natural width (never a stretched grid), the flow and
    // the form below it sit in ONE scroll container (the form carries no fill
    // and no divider — two stacked surfaces would read as two cards), and
    // past the dialog's max height that container alone scrolls, so neither
    // part ever scrolls separately.
    expect(block('.pickGrid')).toContain('flex-wrap: wrap')
    expect(block('.pickGrid')).not.toMatch(/grid-template|max-height|overflow/)
    expect(block('.pickForm')).not.toMatch(/border|background|padding/)
    expect(block('.pickScroll')).toContain('overflow-y: auto')
    expect(block('.pickDialog')).toContain('max-height: calc(100vh - 48px)')
    expect(block('.editorEmbedded')).not.toMatch(/background|border/)
  })

  it('keeps the mapping table five columns aligned across every row', () => {
    // Every mapping row is its own grid, so a content-sized track would drift
    // between rows — the header's label against the fallback's em dash — and
    // break the column alignment a table of inputs owes. Only fr shares and
    // the fixed picker track size identically everywhere, so the caption and
    // every row must spell the same content-free template.
    const tracks = (selector: string): string =>
      /grid-template-columns: ([^;]+);/.exec(block(selector))?.[1] ?? ''
    expect(tracks('.mappingRow')).toBe(tracks('.mappingHeaderRow'))
    expect(tracks('.mappingRow')).not.toMatch(/auto|max-content|min-content/)
  })

  it('reserves the scrollbar gutter on every scroll container', () => {
    // The theme scrollbar is space-taking (8px `::-webkit-scrollbar`, see
    // ui-theme styles/scrollbar.css): an appearing bar eats into the content
    // box, so rows, cells, and inputs flush with a container's right edge
    // land under the thumb. `scrollbar-gutter: stable` reserves the slot up
    // front — no occlusion, and no reflow when the bar appears.
    for (const selector of [
      '.editorDialogBody',
      '.pickScroll',
      '.candidateList',
      '.iconGrid',
      '.modelChoiceList',
    ]) {
      expect(block(selector), selector).toContain('overflow-y: auto')
      expect(block(selector), selector).toContain('scrollbar-gutter: stable')
    }
  })

  it('widens and caps every dialog through its own width and shrink chain', () => {
    // The Modal's card declares `width: min(380px, 100%)`, and a `max-width`
    // on the className cannot widen it — measured in chromium: the icon
    // picker rendered 380px while its rule said 760px. Every dialog wider
    // than the Modal default must therefore carry its own `width`. And an
    // uncapped card grows past the fixed overlay on a short window, leaving
    // its footer below the viewport; the cap plus the content/body
    // `min-height: 0` chain is what hands the overflow to the list instead.
    for (const dialog of ['.editorDialog', '.pickDialog', '.iconDialog', '.fetchDialog']) {
      expect(block(dialog), dialog).toMatch(/width: min\(/)
      expect(block(dialog), dialog).toContain('max-height: calc(100vh - 48px)')
    }
    for (const region of [
      '.editorDialogContent', '.editorDialogBody',
      '.pickDialogContent', '.pickDialogBody',
      '.iconDialogContent', '.iconDialogBody',
      '.fetchDialogContent', '.fetchDialogBody',
    ]) {
      expect(block(region), region).toContain('min-height: 0')
    }
  })

  it('separates the provider card from the editor it opens beside', () => {
    // `bg-layer-3` and `bg-module-platform` both resolve to neutral-bluish-800
    // under the dark theme, so filling the card with either erases the nested
    // editor's boundary. The card is outlined; the fill is the editor's alone.
    expect(block('.editor')).toContain('background: var(--dsw-alias-bg-module-platform)')
    expect(block('.card')).toContain('border: 1px solid var(--dsw-alias-border-l2)')
    expect(block('.card')).not.toMatch(/\bbackground\s*:/)
  })

  it('marks the default provider card by recoloring its outline, not its fill', () => {
    // The in-use card must stay readable next to its siblings: the brand
    // border recolors while the fill stays empty, so the badge and the outline
    // carry the highlight without washing out the dark theme.
    expect(block('.cardDefault')).toContain('border-color: var(--dsw-alias-brand-primary)')
    expect(block('.cardDefault')).not.toMatch(/\bbackground\s*:/)
  })

  it('keeps the card icon actions always visible', () => {
    // cc-switch renders its edit/duplicate/delete row on every card; gating
    // the row behind a hover would hide management from keyboard and touch
    // users, so the actions carry no opacity or pointer-events gating.
    expect(block('.iconActions')).not.toMatch(/opacity\s*:/)
    expect(block('.iconActions')).not.toMatch(/pointer-events\s*:/)
  })

  it('gives every dropdown the shared chevron instead of the OS arrow', () => {
    // `select.input` caps the control at 240px, and the OS arrow is painted
    // flush inside that shrunk right edge — visibly tighter than every other
    // control on the page. `.selectInput` is what removes it, reserves the
    // right pad, and paints the shared chevron; a `<select>` that takes
    // `.input` alone silently keeps the OS one.
    const sources = readdirSync(fileURLToPath(new URL('../src/client/', import.meta.url)))
      .filter(name => name.endsWith('.tsx'))
      .map(name => ({
        name,
        text: readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8'),
      }))
    const bare = sources.flatMap(({ name, text }) => text
      .split('<select')
      .slice(1)
      // The element's own attributes end at the first `>`; a child `<option>`
      // carries no className of its own and must not answer for the select.
      .map(rest => rest.slice(0, rest.indexOf('>')))
      .filter(attributes => !attributes.includes('selectInput'))
      .map(() => name))
    expect(bare).toEqual([])
  })

  it('never falls back to a literal colour', () => {
    // A token that resolves is never the problem; an undeclared one takes this
    // branch, and a literal here is a single colour for both themes.
    expect(css).not.toMatch(/var\(--dsw-[a-z0-9-]+\s*,\s*(?:#|rgb|rgba|hsl|hsla)/)
  })
})
