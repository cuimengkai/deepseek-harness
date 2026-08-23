/**
 * FlowCanvas.module.css style contracts. jsdom applies no stylesheet, so
 * the declarations are asserted against the module source (the sidebar-styles
 * convention). The canvas must own its touch gestures: with `touch-action:
 * none`, a node drag on a touch screen keeps firing pointermove instead of
 * being cancelled into a scroll by the browser.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/FlowCanvas.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('FlowCanvas.module.css', () => {
  it('lets the canvas own touch gestures so node drags are not cancelled', () => {
    expect(declarations('.canvas')?.get('touch-action')).toBe('none')
  })
})
