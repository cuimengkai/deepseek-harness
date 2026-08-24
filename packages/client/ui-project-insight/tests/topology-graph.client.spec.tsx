// @vitest-environment jsdom
/**
 * The topology graph through the real React Flow DOM. jsdom cannot lay out or
 * hit-test, so the spec stubs measurement (ResizeObserver, rects, offset
 * sizes), then drives the reliable gestures: node tap, pane tap, and mouse
 * hover (React Flow v12 reports hover from the node itself). Node and edge
 * projection are covered by graph.ts; this spec asserts the same graph through
 * the canvas plus the chrome (controls, minimap, accents, LR layout, fit and
 * re-fit on container resize).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GraphEdge, GraphNode } from '../src/client/graph.ts'
import { NODE_HEIGHT, NODE_WIDTH } from '../src/client/layout.ts'
import { TopologyGraph } from '../src/client/TopologyGraph.tsx'
import css from '../src/client/insight.module.css'

const A: GraphNode = { id: 'a', label: 'a' }
const B: GraphNode = { id: 'b', label: 'b' }
const C: GraphNode = { id: 'c', label: 'c' }
const A_TO_B: GraphEdge = { source: 'a', target: 'b' }
const B_TO_C: GraphEdge = { source: 'b', target: 'c' }

/** The current container size the measurement stubs report. */
let currentSize = { width: 900, height: 600 }

/**
 * The captured ResizeObserver callbacks, keyed by what the observed element is:
 * the topology wrapper (`graph`, TopologyGraph's own observer), React Flow's
 * viewport container (`.react-flow__renderer`, the element its useResizeHandler
 * sizes the store from), and everything else (`other` — nodes, minimap, and
 * other `react-flow__*` children).
 */
const observers = new Map<string, (entries: ResizeObserverEntry[]) => void>()

/** A deterministic DOMRect for the measurement stubs. */
function rect(width: number, height: number): DOMRect {
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }
}

/** Point the rect and offset stubs at a new container size. */
function stubRects(size: { width: number; height: number }): void {
  currentSize = size
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const className = typeof this.className === 'string' ? this.className : ''
    if (className.includes('react-flow__node')) return rect(NODE_WIDTH, NODE_HEIGHT)
    if (className.includes('graph') || className.includes('react-flow')) return rect(size.width, size.height)
    return rect(900, 600)
  }
  // React Flow measures nodes through offsetWidth/offsetHeight (not the rect);
  // without the stub every node measures 0×0 and the edge pipeline stays
  // uninitialized. The same call sizes the viewport container.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      const className = this.className
      if (className.includes('react-flow__node')) return NODE_WIDTH
      if (className.includes('graph') || className.includes('react-flow')) return size.width
      return 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const className = this.className
      if (className.includes('react-flow__node')) return NODE_HEIGHT
      if (className.includes('graph') || className.includes('react-flow')) return size.height
      return 0
    },
  })
}

/** The node wrapper's inline transform, translated to a point. */
function nodePosition(container: HTMLElement, id: string): { x: number; y: number } {
  const wrapper = container.querySelector(`[data-node-id="${id}"]`)?.parentElement
  const style = wrapper?.getAttribute('style') ?? ''
  const match = /translate\((-?[\d.]+)px\s*,?\s*(-?[\d.]+)px\)/.exec(style)
  if (match === null) return { x: 0, y: 0 }
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** The viewport's inline transform, or null before React Flow mounts it. */
function viewportTransform(container: HTMLElement): string | null {
  return container.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null
}

/** Drains one macrotask so d3's ghost-click suppressor from any pan gesture clears. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 25))
}

beforeAll(() => {
  // jsdom has no hit-testing or ResizeObserver; React Flow needs both. The
  // topology wrapper is measured through the rect stub (its callback fires
  // immediately on observe), while React Flow's own observer reads the content
  // rect the same stub feeds the viewport store.
  document.elementFromPoint = () => null
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: (entries: ResizeObserverEntry[]) => void
    constructor(callback: (entries: ResizeObserverEntry[]) => void) { this.callback = callback }
    observe(target: Element): void {
      const className = typeof target.className === 'string' ? target.className : ''
      // The `renderer` key captures React Flow's useResizeHandler observer on the
      // viewport container — the one that sizes the store. The shared
      // node-measurement observer also observes that container, so disambiguate
      // by callback arity: useResizeHandler passes `() => updateDimensions()`
      // (ignores the entry, arity 0) while the node observer takes the entries.
      const key = className.includes('graph')
        ? 'graph'
        : className.includes('react-flow__renderer') && this.callback.length === 0
          ? 'renderer'
          : 'other'
      observers.set(key, this.callback)
      this.callback([{ target, contentRect: rect(currentSize.width, currentSize.height) } as ResizeObserverEntry])
    }
    unobserve(): void {}
    disconnect(): void {}
  })
  // d3-drag and d3-zoom read event.view.document on mouse-down; jsdom rejects
  // `view: window` in the constructor but leaves the view null otherwise.
  const nativeMouse = window.MouseEvent
  const nativeWheel = window.WheelEvent
  vi.stubGlobal('MouseEvent', class extends nativeMouse {
    constructor(type: string, init: MouseEventInit = {}) {
      super(type, init)
      Object.defineProperty(this, 'view', { value: window, configurable: true })
    }
  })
  vi.stubGlobal('WheelEvent', class extends nativeWheel {
    constructor(type: string, init: WheelEventInit = {}) {
      super(type, init)
      Object.defineProperty(this, 'view', { value: window, configurable: true })
    }
  })
  vi.stubGlobal('DragEvent', class extends window.MouseEvent {
    dataTransfer: DataTransfer | null
    constructor(type: string, init: DragEventInit = {}) {
      super(type, init)
      this.dataTransfer = init.dataTransfer ?? null
    }
  })
  // React Flow parses the viewport's inline transform to learn the zoom.
  vi.stubGlobal('DOMMatrixReadOnly', class {
    m22 = 1
    constructor(init = '') {
      const scale = /scale\(([-\d.]+)/.exec(init)
      if (scale) this.m22 = Number(scale[1])
    }
  })
  Object.defineProperty(Element.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true })
  Object.defineProperty(Element.prototype, 'releasePointerCapture', { value: vi.fn(), configurable: true })
  stubRects({ width: 900, height: 600 })
})

beforeEach(async () => {
  stubRects({ width: 900, height: 600 })
  observers.clear()
  document.elementFromPoint = () => null
  await settle()
})

afterEach(() => {
  cleanup()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('TopologyGraph', () => {
  it('renders the wrapper, nodes, edges, controls, and minimap', async () => {
    const { container } = render(<TopologyGraph nodes={[A, B]} edges={[A_TO_B]} />)

    expect(screen.getByRole('img', { name: 'dependency graph' })).toBeTruthy()
    expect(container.querySelector('[data-node-id="a"]')?.textContent).toBe('a')
    expect(container.querySelector('[data-node-id="b"]')?.textContent).toBe('b')
    // Edges render once their source/target nodes are measured, so wait for the
    // edge pipeline to come up before asserting the chrome.
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(1)
      expect(container.querySelector('.react-flow__edge-path')).not.toBeNull()
      expect(container.querySelector('.react-flow__edge-smoothstep')).not.toBeNull()
    })
    expect(container.querySelector('.react-flow__controls')).not.toBeNull()
    expect(container.querySelector('.react-flow__minimap')).not.toBeNull()
  })

  it('renders nothing for an empty node set', () => {
    const { container } = render(<TopologyGraph nodes={[]} edges={[]} />)
    expect(container.querySelector('.react-flow')).toBeNull()
    expect(screen.queryByRole('img', { name: 'dependency graph' })).toBeNull()
  })

  it('selects a node on tap and clears the selection on pane tap', async () => {
    const onSelectNode = vi.fn()
    const onTapBackground = vi.fn()
    const { container } = render(
      <TopologyGraph nodes={[A, B]} edges={[A_TO_B]} onSelectNode={onSelectNode} onTapBackground={onTapBackground} />,
    )
    fireEvent.click(container.querySelector('[data-node-id="a"]') as HTMLElement)
    await vi.waitFor(() => { expect(onSelectNode).toHaveBeenCalledWith('a') })

    fireEvent.click(container.querySelector('.react-flow__pane') as HTMLElement)
    await vi.waitFor(() => { expect(onTapBackground).toHaveBeenCalled() })
  })

  it('reports hover enter and leave through the node hook', () => {
    const onHoverNode = vi.fn()
    const { container } = render(<TopologyGraph nodes={[A, B]} edges={[A_TO_B]} onHoverNode={onHoverNode} />)
    const nodeA = container.querySelector('[data-node-id="a"]') as HTMLElement

    fireEvent.mouseEnter(nodeA)
    expect(onHoverNode).toHaveBeenCalledWith('a')
    fireEvent.mouseLeave(nodeA)
    expect(onHoverNode).toHaveBeenCalledWith(null)
  })

  it('survives hover without a hook wired', () => {
    const { container } = render(<TopologyGraph nodes={[A, B]} edges={[A_TO_B]} />)
    const nodeA = container.querySelector('[data-node-id="a"]') as HTMLElement
    expect(() => {
      fireEvent.mouseEnter(nodeA)
      fireEvent.mouseLeave(nodeA)
    }).not.toThrow()
  })

  it('applies the cycle, hover, and selected accents', () => {
    const { container } = render(
      <TopologyGraph
        nodes={[A, B, C]}
        edges={[A_TO_B, B_TO_C]}
        cycleNodeIds={new Set(['b'])}
        hoverNodeId="a"
        selectedNodeId="c"
      />,
    )
    const nodeA = container.querySelector('[data-node-id="a"]')!
    const nodeB = container.querySelector('[data-node-id="b"]')!
    const nodeC = container.querySelector('[data-node-id="c"]')!

    expect(nodeA.className).toContain(css.topologyHover)
    expect(nodeB.className).toContain(css.topologyCycle)
    expect(nodeC.className).toContain(css.topologySelected)
    expect(nodeA.className).not.toContain(css.topologyCycle)
    expect(nodeC.className).not.toContain(css.topologyHover)
  })

  it('lays a chain left-to-right on one row by dagre rank', async () => {
    const { container } = render(<TopologyGraph nodes={[A, B]} edges={[A_TO_B]} />)
    await vi.waitFor(() => {
      const a = nodePosition(container, 'a')
      const b = nodePosition(container, 'b')
      expect(b.x).toBeGreaterThan(a.x)
      expect(b.y).toBe(a.y)
    })
  })

  it('fits the view to the layout once nodes are measured', async () => {
    const { container } = render(<TopologyGraph nodes={[A, B]} edges={[A_TO_B]} />)
    // fitView runs after measurement; the viewport leaves the identity.
    await vi.waitFor(() => {
      expect(viewportTransform(container)).not.toContain('translate(0px,0px) scale(1)')
    })
    expect(viewportTransform(container)).toContain('translate(')
  })

  it('re-fits the view when the container resizes', async () => {
    // A wide chain (wider than the container) so the fit zoom is not pinned at
    // the maxZoom cap and actually re-anchors when the container shrinks.
    const wide: GraphNode[] = Array.from({ length: 10 }, (_, index) => ({
      id: `n${index}`,
      label: `n${index}`,
    }))
    const wideEdges: GraphEdge[] = wide.slice(1).map((node, index) => ({
      source: `n${index}`,
      target: node.id,
    }))
    const { container } = render(<TopologyGraph nodes={wide} edges={wideEdges} />)
    await vi.waitFor(() => {
      expect(viewportTransform(container)).not.toContain('translate(0px,0px) scale(1)')
    })
    const before = viewportTransform(container)

    // Shrink the measured container, then fire the topology wrapper's observer
    // (re-measures the graph) and React Flow's renderer observer (re-sizes the
    // store); the fit re-anchors to the smaller viewport.
    stubRects({ width: 500, height: 400 })
    act(() => {
      observers.get('graph')!([{ target: {} as Element, contentRect: rect(500, 400) } as ResizeObserverEntry])
      observers.get('renderer')!([{ target: {} as Element, contentRect: rect(500, 400) } as ResizeObserverEntry])
    })

    await vi.waitFor(() => { expect(viewportTransform(container)).not.toBe(before) })
  })

  it('keeps natural node spacing and skips the fit for a zero-size wrapper', async () => {
    stubRects({ width: 0, height: 0 })
    const { container } = render(<TopologyGraph nodes={[A, B]} edges={[A_TO_B]} />)
    // Nodes still lay out at their natural positions even before any measure…
    await vi.waitFor(() => {
      const a = nodePosition(container, 'a')
      const b = nodePosition(container, 'b')
      expect(b.x).toBeGreaterThan(a.x)
    })
    // …but the fit never runs against a zero-size container.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(viewportTransform(container)).toContain('translate(0px,0px) scale(1)')
  })
})
