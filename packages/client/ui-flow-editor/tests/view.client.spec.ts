/**
 * The canvas view math (pan/zoom) as pure functions: client→graph conversion
 * under an offset view, pointer-anchored zoom that keeps the graph point under
 * the pointer fixed, and scale clamping at both bounds. No DOM is involved, so
 * the geometry is asserted exactly where the gestures drive it from.
 */

import { describe, expect, it } from 'vitest'
import {
  MIN_SCALE, MAX_SCALE, clampScale, clientToGraph, panView, zoomAt,
} from '../src/client/view.ts'

describe('canvas view math', () => {
  it('clamps the scale to the zoom bounds and passes mid values through', () => {
    expect(clampScale(0.05)).toBe(MIN_SCALE)
    expect(clampScale(10)).toBe(MAX_SCALE)
    expect(clampScale(0.2)).toBe(0.2)
    expect(clampScale(2)).toBe(2)
    expect(clampScale(1.5)).toBe(1.5)
  })

  it('converts a client point to graph coordinates under an offset, scaled view', () => {
    const point = clientToGraph(
      { x: 115, y: 35 },
      { left: 10, top: 5 },
      { x: 40, y: 20, scale: 1.5 },
    )
    expect(point.x).toBeCloseTo(43.333, 3)
    expect(point.y).toBeCloseTo(6.667, 3)
  })

  it('pans the view by a client delta without touching the scale', () => {
    expect(panView({ x: 40, y: 20, scale: 1.5 }, 30, -20))
      .toEqual({ x: 70, y: 0, scale: 1.5 })
  })

  it('zooms at the pointer, keeping the graph point under the anchor fixed', () => {
    const view = { x: 0, y: 0, scale: 1 }
    const rect = { left: 0, top: 0 }
    const next = zoomAt(view, { x: 60, y: 40 }, rect, 2)
    expect(next.scale).toBe(2)
    expect(next.x).toBe(-60)
    expect(next.y).toBe(-40)
    // The anchored graph point (60, 40) still lands under (60, 40) in client space.
    const back = clientToGraph({ x: 60, y: 40 }, rect, next)
    expect(back.x).toBeCloseTo(60, 9)
    expect(back.y).toBeCloseTo(40, 9)
  })

  it('zooms out through the minimum and still keeps the anchor fixed', () => {
    const view = { x: -100, y: -50, scale: 1.5 }
    const rect = { left: 10, top: 5 }
    const anchor = clientToGraph({ x: 200, y: 150 }, rect, view)
    const next = zoomAt(view, { x: 200, y: 150 }, rect, 1 / 2)
    expect(next.scale).toBe(0.75)
    const back = clientToGraph({ x: 200, y: 150 }, rect, next)
    expect(back.x).toBeCloseTo(anchor.x, 9)
    expect(back.y).toBeCloseTo(anchor.y, 9)
  })

  it('clamps a zoom at the bound without drifting the anchor', () => {
    const view = { x: 0, y: 0, scale: 0.1 }
    const rect = { left: 0, top: 0 }
    const anchor = clientToGraph({ x: 90, y: 45 }, rect, view)
    const next = zoomAt(view, { x: 90, y: 45 }, rect, 1.2)
    expect(next.scale).toBe(MIN_SCALE)
    const back = clientToGraph({ x: 90, y: 45 }, rect, next)
    expect(back.x).toBeCloseTo(anchor.x, 9)
    expect(back.y).toBeCloseTo(anchor.y, 9)
  })
})
