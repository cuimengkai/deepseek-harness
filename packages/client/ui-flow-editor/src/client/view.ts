/**
 * Canvas view transforms: the mapping between client (screen) coordinates and
 * graph coordinates under a pan/zoom view, plus the gesture math that changes
 * the view. Pure functions over plain values — the component holds the current
 * view as state, and every geometry helper is unit-tested here without a DOM.
 */

/** The canvas view transform: graph origin's screen offset plus a scale. */
export interface ViewState {
  /** Screen offset of the graph origin (graph point 0,0 in client pixels). */
  x: number
  /** Screen offset of the graph origin on the vertical axis. */
  y: number
  /** Graph units per screen pixel. */
  scale: number
}

/** The viewport rectangle the canvas occupies (client coordinates). */
export interface ViewRect {
  left: number
  top: number
}

/** The smallest graph scale the wheel zoom allows. */
export const MIN_SCALE = 0.2
/** The largest graph scale the wheel zoom allows. */
export const MAX_SCALE = 2

/** Clamp a graph scale into the zoom bounds. */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Convert a client point into graph coordinates under a view.
 * @param point - client-space point (absolute page coordinates).
 * @param rect - the canvas's bounding rect, for the client-space origin.
 * @param view - the current pan/zoom view.
 * @returns the graph-space point the client point shows.
 */
export function clientToGraph(
  point: { x: number; y: number },
  rect: ViewRect,
  view: ViewState,
): { x: number; y: number } {
  return {
    x: (point.x - rect.left - view.x) / view.scale,
    y: (point.y - rect.top - view.y) / view.scale,
  }
}

/** Pan the view by a client-space delta. */
export function panView(view: ViewState, dx: number, dy: number): ViewState {
  return { ...view, x: view.x + dx, y: view.y + dy }
}

/**
 * Zoom the view at a client-space anchor, keeping the graph point under the
 * anchor fixed. The returned view maps the same graph point back under the
 * same client point, so the pointer is the zoom center.
 * @param view - the current view.
 * @param point - the client-space anchor under the pointer.
 * @param rect - the canvas's bounding rect.
 * @param factor - the multiplicative scale change (1.2 zooms in).
 * @returns the zoomed view, clamped to the scale bounds.
 */
export function zoomAt(
  view: ViewState,
  point: { x: number; y: number },
  rect: ViewRect,
  factor: number,
): ViewState {
  const scale = clampScale(view.scale * factor)
  const anchor = clientToGraph(point, rect, view)
  return {
    scale,
    x: (point.x - rect.left) - anchor.x * scale,
    y: (point.y - rect.top) - anchor.y * scale,
  }
}
