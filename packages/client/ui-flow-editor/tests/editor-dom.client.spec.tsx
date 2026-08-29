// @vitest-environment jsdom
/**
 * The shared canvas through the real React Flow DOM. jsdom cannot hit-test (no
 * layout, no `elementFromPoint`), so the spec stubs hit-testing and node
 * measurement, and drives the gestures that are reliable under jsdom:
 * click-select, mouse drag, drop, pane, wheel, and key. The pure
 * gesture→surface mapping is covered by rf-map.client.spec.ts; this spec
 * asserts the same calls through the DOM plus the canvas chrome (fit,
 * read-only, add/insert buttons, delete key).
 */

import { useState, type ReactNode } from 'react'
import { Position, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { FlowGraph, FlowNode } from '@deepseek-ai/dsh-flow/types'
import { FlowCanvas, apply, type FlowCanvasProps, type FlowCanvasSurface } from '../src/client/index.ts'
import { InsertableEdge } from '../src/client/InsertableEdge.tsx'

/** The fixture graph the harness presents: a start → agent → end chain. */
const graph: FlowGraph = {
  id: 'demo',
  name: 'Demo flow',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
    { id: 'agent-a', type: 'agent', prompt: '', position: { x: 220, y: 40 } },
    { id: 'end', type: 'end', position: { x: 440, y: 80 } },
  ],
  edges: [
    { id: 'e-start-agent', from: 'start', to: 'agent-a', label: 'true' },
    { id: 'e-agent-end', from: 'agent-a', to: 'end' },
  ],
}

/** The node card renderer: a stable function so the canvas only re-maps on graph change. */
function renderCard(node: FlowNode): ReactNode {
  return <div data-card={node.id}>{node.label ?? node.id}</div>
}

/** The spy record the harness routes surface mutations through. */
type Spies = {
  selectNode: Mock<(id: string | null) => void>
  selectEdge: Mock<(id: string | null) => void>
  moveNode: Mock<(id: string, position: { x: number; y: number }) => void>
  addEdge: Mock<(from: string, to: string) => void>
  removeNode: Mock<(id: string) => void>
  removeEdge: Mock<(id: string) => void>
  addNodeAt: Mock<(data: string, position: { x: number; y: number }) => void>
}

function makeSpies(): Spies {
  return {
    selectNode: vi.fn<(id: string | null) => void>(),
    selectEdge: vi.fn<(id: string | null) => void>(),
    moveNode: vi.fn<(id: string, position: { x: number; y: number }) => void>(),
    addEdge: vi.fn<(from: string, to: string) => void>(),
    removeNode: vi.fn<(id: string) => void>(),
    removeEdge: vi.fn<(id: string) => void>(),
    addNodeAt: vi.fn<(data: string, position: { x: number; y: number }) => void>(),
  }
}

/** Renders the canvas against a live surface: selection is component state, like the composer. */
function Harness({
  graph: presented, readOnly = false, spies, flowProps = {},
}: {
  graph: FlowGraph | null
  readOnly?: boolean
  spies: Spies
  flowProps?: Partial<Omit<FlowCanvasProps, 'surface' | 'renderNode'>>
}): ReactNode {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const surface: FlowCanvasSurface = {
    graph: presented,
    selectedNodeId,
    selectedEdgeId,
    readOnly,
    selectNode: (id) => { spies.selectNode(id); setSelectedNodeId(id) },
    selectEdge: (id) => { spies.selectEdge(id); setSelectedEdgeId(id) },
    moveNode: spies.moveNode,
    addEdge: spies.addEdge,
    removeNode: spies.removeNode,
    removeEdge: spies.removeEdge,
    addNodeAt: spies.addNodeAt,
  }
  return (
    <FlowCanvas
      surface={surface}
      renderNode={renderCard}
      connectAriaLabel="connect"
      {...flowProps}
    />
  )
}

/** A deterministic DOMRect for the measurement stub. */
function rect(width: number, height: number): DOMRect {
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }
}

/** The per-test rectangle stub: measured nodes, the canvas wrapper, everything else. */
function stubRects(wrapper: { width: number; height: number }): void {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const className = typeof this.className === 'string' ? this.className : ''
    if (className.includes('react-flow__node')) return rect(168, 64)
    if (className.includes('canvas')) return rect(wrapper.width, wrapper.height)
    return rect(900, 500)
  }
  // React Flow measures nodes through offsetWidth/offsetHeight (not the rect),
  // and jsdom reports 0 for both; without the stub every node measures 0×0 and
  // the edge pipeline stays uninitialized (isNodeInitialized never turns true).
  // The same call sizes the viewport store, so the `.react-flow` container reads
  // the wrapper size here too.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      const className = this.className
      if (className.includes('react-flow__node')) return 168
      if (className.includes('react-flow') || className.includes('canvas')) return wrapper.width
      return 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const className = this.className
      if (className.includes('react-flow__node')) return 64
      if (className.includes('react-flow') || className.includes('canvas')) return wrapper.height
      return 0
    },
  })
}

/** The target handle hit-test: jsdom cannot hit-test, so connect points at the explicit target. */
function stubElementFromPoint(selector: string): void {
  document.elementFromPoint = () => document.querySelector(selector)
}

function mockDataTransfer(mime: string, data: string): DataTransfer {
  return {
    getData: (asked: string) => (asked === mime ? data : ''),
    setData: vi.fn(),
    types: [mime],
  } as unknown as DataTransfer
}

function viewportTransform(container: HTMLElement): string | null {
  return container.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null
}

/**
 * Drains one macrotask so d3-drag/d3-zoom's setTimeout(0) ghost-click
 * suppression removal runs. Every drag or pan gesture leaves a capture-phase
 * click listener on window that swallows all later clicks until that timer
 * fires; jsdom does not drain the macrotask queue between tests, so a prior
 * gesture test would otherwise poison every later click test.
 */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 25))
}

beforeAll(() => {
  // jsdom has no hit-testing or ResizeObserver; React Flow needs both.
  document.elementFromPoint = () => null
  // jsdom cannot lay out, so every observed element is measured from the rect
  // stub. React Flow measures its nodes through this observer, and without a
  // measurement the edge pipeline refuses to render (isNodeInitialized).
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: (entries: ResizeObserverEntry[]) => void
    constructor(callback: (entries: ResizeObserverEntry[]) => void) { this.callback = callback }
    observe(target: Element): void {
      this.callback([{ target, contentRect: { width: 900, height: 500 } } as ResizeObserverEntry])
    }
    unobserve(): void {}
    disconnect(): void {}
  })
  // d3-drag and d3-zoom read event.view.document on mouse-down; jsdom rejects
  // `view: window` in the constructor but leaves the view null otherwise, so a
  // subclass shadows the prototype getter with an own property.
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
  // jsdom has no DragEvent; a plain MouseEvent drops the dataTransfer init
  // member, so the drop/drag-over handlers would read undefined.
  vi.stubGlobal('DragEvent', class extends window.MouseEvent {
    dataTransfer: DataTransfer | null
    constructor(type: string, init: DragEventInit = {}) {
      super(type, init)
      this.dataTransfer = init.dataTransfer ?? null
    }
  })
  // React Flow parses the viewport's inline transform to learn the current
  // zoom; jsdom lacks the DOMMatrixReadOnly constructor.
  vi.stubGlobal('DOMMatrixReadOnly', class {
    m22 = 1
    constructor(init = '') {
      const scale = /scale\(([-\d.]+)/.exec(init)
      if (scale) this.m22 = Number(scale[1])
    }
  })
  Object.defineProperty(Element.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true })
  Object.defineProperty(Element.prototype, 'releasePointerCapture', { value: vi.fn(), configurable: true })
  stubRects({ width: 900, height: 500 })
})

beforeEach(async () => {
  stubRects({ width: 900, height: 500 })
  document.elementFromPoint = () => null
  // A prior gesture test may have left d3's ghost-click suppressor pending.
  await settle()
})

afterEach(() => {
  cleanup()
})

describe('FlowCanvas', () => {
  it('browser apply mounts nothing', () => {
    apply()
    expect(typeof apply).toBe('function')
  })

  it('renders nodes, edges, and the corner hint', () => {
    const spies = makeSpies()
    const { container } = render(
      <Harness graph={graph} spies={spies} flowProps={{ canvasHint: 'drag to pan' }} />,
    )
    expect(container.querySelector('[data-node-id="start"]')).not.toBeNull()
    expect(container.querySelector('[data-node-id="agent-a"]')).not.toBeNull()
    expect(container.querySelector('[data-node-id="end"]')).not.toBeNull()
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(2)
    expect(container.querySelector('.react-flow__edge-path')).not.toBeNull()
    expect(container.textContent).toContain('drag to pan')
    // A node card renders the caller's content.
    expect(container.querySelector('[data-card="agent-a"]')).not.toBeNull()
  })

  it('renders nothing while no graph is loaded', () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={null} spies={spies} />)
    expect(container.querySelector('.react-flow')).toBeNull()
  })

  it('hides the hint when the caller omits it', () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    expect(container.textContent).not.toContain('drag to pan')
  })

  it('selects nodes and edges by click and clears on pane click', async () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    const agentA = container.querySelector('[data-node-id="agent-a"]') as HTMLElement
    fireEvent.click(agentA)
    await vi.waitFor(() => { expect(spies.selectNode).toHaveBeenCalledWith('agent-a') })
    expect(spies.selectEdge).not.toHaveBeenCalled()

    const edge = container.querySelector('.react-flow__edge') as HTMLElement
    fireEvent.click(edge)
    await vi.waitFor(() => { expect(spies.selectEdge).toHaveBeenCalled() })
    expect(spies.selectEdge).toHaveBeenCalledWith('e-start-agent')

    fireEvent.click(container.querySelector('.react-flow__pane') as HTMLElement)
    await vi.waitFor(() => { expect(spies.selectNode).toHaveBeenLastCalledWith(null) })
    expect(spies.selectEdge).toHaveBeenLastCalledWith(null)
  })

  it('clears a node-only selection on pane click', async () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    fireEvent.click(container.querySelector('[data-node-id="agent-a"]') as HTMLElement)
    await vi.waitFor(() => { expect(spies.selectNode).toHaveBeenCalledWith('agent-a') })
    // No edge is selected, so the pane click clears the node without touching edges.
    fireEvent.click(container.querySelector('.react-flow__pane') as HTMLElement)
    await vi.waitFor(() => { expect(spies.selectNode).toHaveBeenLastCalledWith(null) })
    expect(spies.selectEdge).not.toHaveBeenCalled()
  })

  it('routes the Delete key to node or edge removal, guarded by inputs and read-only', async () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    // Node removal.
    fireEvent.click(container.querySelector('[data-node-id="agent-a"]') as HTMLElement)
    await vi.waitFor(() => { expect(spies.selectNode).toHaveBeenCalledWith('agent-a') })
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(spies.removeNode).toHaveBeenCalledWith('agent-a')

    // Edge removal.
    fireEvent.click(container.querySelector('.react-flow__edge') as HTMLElement)
    await vi.waitFor(() => { expect(spies.selectEdge).toHaveBeenCalled() })
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(spies.removeEdge).toHaveBeenCalled()

    // Non-delete keys do nothing.
    fireEvent.keyDown(window, { key: 'a' })
    expect(spies.removeNode).toHaveBeenCalledTimes(1)
    expect(spies.removeEdge).toHaveBeenCalledTimes(1)

    // A keydown inside an input never removes.
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'Delete' })
    expect(spies.removeNode).toHaveBeenCalledTimes(1)
    document.body.removeChild(input)

    // A Delete with no selection removes nothing.
    fireEvent.click(container.querySelector('.react-flow__pane') as HTMLElement)
    await vi.waitFor(() => { expect(spies.selectEdge).toHaveBeenLastCalledWith(null) })
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(spies.removeNode).toHaveBeenCalledTimes(1)
    expect(spies.removeEdge).toHaveBeenCalledTimes(1)
  })

  it('refuses removal keys in read-only', () => {
    const spies = makeSpies()
    render(<Harness graph={graph} readOnly spies={spies} />)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(spies.removeNode).not.toHaveBeenCalled()
  })

  it('commits a drag to the surface only at drag stop', async () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    // fitView resolves asynchronously after measurement; the drag math assumes a
    // stable transform, so settle the fit before the first gesture.
    await vi.waitFor(() => {
      expect(viewportTransform(container)).not.toContain('translate(0px,0px) scale(1)')
    })
    const agentA = container.querySelector('[data-node-id="agent-a"]') as HTMLElement
    fireEvent.mouseDown(agentA, { button: 0, clientX: 260, clientY: 60 })
    // React Flow's nodeDragThreshold (default 1) makes the first mousemove only
    // start the drag; a second mousemove is what actually moves the node.
    fireEvent.mouseMove(window, { clientX: 320, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 380, clientY: 140 })
    fireEvent.mouseUp(window, { clientX: 380, clientY: 140 })
    await vi.waitFor(() => { expect(spies.moveNode).toHaveBeenCalledTimes(1) })
    const [id, position] = spies.moveNode.mock.calls[0] as [string, { x: number; y: number }]
    expect(id).toBe('agent-a')
    expect(position.x).toBeGreaterThan(220)
    expect(position.y).toBeGreaterThan(40)
  })

  it('routes a completed connection to the surface', async () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    stubElementFromPoint('[data-node-id="agent-a"] .react-flow__handle-left')
    const source = container.querySelector('[data-node-id="start"] .react-flow__handle-right') as HTMLElement
    fireEvent.mouseDown(source, { button: 0, clientX: 180, clientY: 32 })
    fireEvent.mouseMove(document, { clientX: 260, clientY: 64 })
    fireEvent.mouseUp(document, { clientX: 260, clientY: 64 })
    await vi.waitFor(() => { expect(spies.addEdge).toHaveBeenCalledWith('start', 'agent-a') })
  })

  it('adds a palette drop only when editable and the payload matches', async () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    const flow = container.querySelector('.react-flow') as HTMLElement

    // An empty payload is ignored.
    fireEvent.drop(flow, { dataTransfer: mockDataTransfer('application/x-flow-node', '') })
    expect(spies.addNodeAt).not.toHaveBeenCalled()

    // A matching payload lands at the flow position.
    fireEvent.drop(flow, { dataTransfer: mockDataTransfer('application/x-flow-node', 'agent-x') })
    await vi.waitFor(() => { expect(spies.addNodeAt).toHaveBeenCalled() })
    const [data, position] = spies.addNodeAt.mock.calls[0] as [string, { x: number; y: number }]
    expect(data).toBe('agent-x')
    expect(position.x).toBeGreaterThanOrEqual(0)
    expect(position.y).toBeGreaterThanOrEqual(0)
  })

  it('ignores drops in read-only', () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} readOnly spies={spies} />)
    fireEvent.drop(container.querySelector('.react-flow') as HTMLElement, {
      dataTransfer: mockDataTransfer('application/x-flow-node', 'agent-x'),
    })
    expect(spies.addNodeAt).not.toHaveBeenCalled()
  })

  it('allows the drop only when the payload mime matches', () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    const flow = container.querySelector('.react-flow') as HTMLElement
    // fireEvent returns dispatchEvent's boolean: false means the handler called
    // preventDefault (a matching, editable drop is accepted).
    const matching = fireEvent.dragOver(flow, { dataTransfer: mockDataTransfer('application/x-flow-node', 'x') })
    expect(matching).toBe(false)
    const other = fireEvent.dragOver(flow, { dataTransfer: mockDataTransfer('text/plain', 'x') })
    expect(other).toBe(true)
  })

  it('does not allow drops over a read-only canvas', () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} readOnly spies={spies} />)
    const event = fireEvent.dragOver(container.querySelector('.react-flow') as HTMLElement, {
      dataTransfer: mockDataTransfer('application/x-flow-node', 'x'),
    })
    expect(event).toBe(true)
  })

  it('centers the graph once on first layout and pans and zooms from there', async () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    // fitView must run after measurement: the viewport leaves the identity.
    await vi.waitFor(() => {
      expect(viewportTransform(container)).not.toContain('translate(0px,0px) scale(1)')
    })
    const afterFit = viewportTransform(container)!
    expect(afterFit).toContain('translate(')

    // Panning from the fitted view moves the viewport again.
    const beforePan = viewportTransform(container)
    fireEvent.mouseDown(container.querySelector('.react-flow__pane') as HTMLElement, {
      button: 0, clientX: 400, clientY: 300,
    })
    fireEvent.mouseMove(window, { clientX: 460, clientY: 340 })
    fireEvent.mouseUp(window, { clientX: 460, clientY: 340 })
    await vi.waitFor(() => { expect(viewportTransform(container)).not.toBe(beforePan) })

    // Wheel zoom from the fitted view changes the zoom factor.
    const beforeZoom = viewportTransform(container)
    fireEvent.wheel(container.querySelector('.react-flow__pane') as HTMLElement, { deltaY: -120 })
    await vi.waitFor(() => { expect(viewportTransform(container)).not.toBe(beforeZoom) })
  })

  it('skips the initial fit until the wrapper has a real size', () => {
    const spies = makeSpies()
    stubRects({ width: 0, height: 0 })
    const { container } = render(<Harness graph={graph} spies={spies} />)
    expect(viewportTransform(container)).toContain('translate(0px,0px) scale(1)')
  })

  it('never fits nor crashes when the graph empties before measurement settles', async () => {
    const spies = makeSpies()
    stubRects({ width: 0, height: 0 })
    const { container, rerender } = render(<Harness graph={graph} spies={spies} />)
    // Node measurement lands even under a 0-size wrapper, so `initialized` flips
    // true while the fit guard still holds on the 0-size rect; rerendering with
    // no graph then reaches the empty-graph guard before the wrapper is
    // dereferenced, and the canvas unmounts cleanly.
    await new Promise(resolve => setTimeout(resolve, 50))
    rerender(<Harness graph={null} spies={spies} />)
    expect(container.querySelector('.react-flow')).toBeNull()
  })

  it('does not re-fit after the graph changes', async () => {
    const spies = makeSpies()
    const { rerender } = render(<Harness graph={graph} spies={spies} />)
    await vi.waitFor(() => {
      expect(viewportTransform(document.body.firstElementChild as HTMLElement)).not.toBeNull()
    })
    const grown: FlowGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: 'agent-b', type: 'agent', prompt: '', position: { x: 640, y: 0 } }],
    }
    rerender(<Harness graph={grown} spies={spies} />)
    expect(containerQuery('#app')).toBeNull()
  })

  it('keeps edge-anchor handles in read-only but disables connect and drag', () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} readOnly spies={spies} />)
    // Handles must stay mounted so edges still render for shipped samples.
    expect(container.querySelectorAll('.react-flow__handle').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(2)
    expect(container.querySelector('.react-flow__edge-path')).not.toBeNull()
    expect(container.textContent).not.toContain('Add a node after')
    expect(container.textContent).not.toContain('Insert a node between')
    const agentA = container.querySelector('[data-node-id="agent-a"]') as HTMLElement
    fireEvent.mouseDown(agentA, { button: 0, clientX: 260, clientY: 60 })
    fireEvent.mouseMove(window, { clientX: 320, clientY: 100 })
    fireEvent.mouseUp(window, { clientX: 320, clientY: 100 })
    expect(spies.moveNode).not.toHaveBeenCalled()
  })

  it('opens the add picker from the floating node button', () => {
    const onAddNode = vi.fn()
    const spies = makeSpies()
    const { container } = render(
      <Harness graph={graph} spies={spies} flowProps={{ onAddNode, addNodeAriaLabel: 'Add after {id}' }} />,
    )
    // The first matching button belongs to the first node (`start`); scope the
    // query to agent-a so the assertion targets that node's picker.
    const button = container.querySelector('[data-node-id="agent-a"] [class*="nodeAdd"]') as HTMLElement
    expect(button).not.toBeNull()
    // Pointer-down stops propagation so the gesture never counts as a node
    // drag target; the click that follows opens the picker without selecting.
    fireEvent.pointerDown(button)
    fireEvent.click(button)
    expect(onAddNode).toHaveBeenCalledWith('agent-a')
    expect(spies.selectNode).not.toHaveBeenCalled()
  })

  it('falls back to the default add-button label', () => {
    const spies = makeSpies()
    const { container } = render(
      <Harness graph={graph} spies={spies} flowProps={{ onAddNode: vi.fn() }} />,
    )
    const button = container.querySelector('[data-node-id="agent-a"] [class*="nodeAdd"]') as HTMLElement
    expect(button?.getAttribute('aria-label')).toBe('Add a node after agent-a')
    expect(button?.getAttribute('title')).toBe('Add a node after agent-a')
  })

  it('omits the add button when no picker is wired', () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} />)
    expect(container.querySelector('[class*="nodeAdd"]')).toBeNull()
  })

  it('opens the insert picker from the edge midpoint button', () => {
    const onInsertBetween = vi.fn()
    const spies = makeSpies()
    const { container } = render(
      <Harness graph={graph} spies={spies} flowProps={{ onInsertBetween, insertBetweenAriaLabel: 'Insert between' }} />,
    )
    const button = container.querySelector('[class*="edgeInsert"]') as HTMLElement
    expect(button).not.toBeNull()
    // Pointer-down stops propagation so the click never counts as an edge
    // selection; the click that follows opens the picker.
    fireEvent.pointerDown(button)
    fireEvent.click(button)
    expect(onInsertBetween).toHaveBeenCalledWith('start', 'agent-a')
    expect(spies.selectEdge).not.toHaveBeenCalled()
  })

  it('keeps edge paths and branch labels in read-only (shipped sample path)', () => {
    const spies = makeSpies()
    // Shipped modes: readOnly, no onInsertBetween — still must paint edges.
    const { container } = render(<Harness graph={graph} readOnly spies={spies} />)
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(2)
    const paths = container.querySelectorAll('.react-flow__edge-path')
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      const d = path.getAttribute('d')
      expect(d === null || d.length === 0).toBe(false)
    }
    expect(container.textContent).toContain('true')
  })

  it('labels the branch on an insertable edge', () => {
    const spies = makeSpies()
    const { container } = render(<Harness graph={graph} spies={spies} flowProps={{ onInsertBetween: vi.fn() }} />)
    expect(container.textContent).toContain('true')
  })

  it('applies the caller node class only when it returns one', () => {
    const spies = makeSpies()
    const { container, rerender } = render(
      <Harness graph={graph} spies={spies} flowProps={{ nodeClass: () => 'run-accent' }} />,
    )
    expect(container.querySelector('[data-node-id="agent-a"]')?.className).toContain('run-accent')
    rerender(
      <Harness graph={graph} spies={spies} flowProps={{ nodeClass: () => undefined }} />,
    )
    expect(container.querySelector('[data-node-id="agent-a"]')?.className).not.toContain('run-accent')
  })

  it('renders a data-less edge as a plain path without a midpoint button', () => {
    // A data-less edge (React Flow edges carry no `data` by default) must fall
    // back to a bare path: no branch label, no insert button. Rendered as the
    // component directly because React Flow's own edge pipeline needs measured
    // nodes, which jsdom cannot provide.
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <InsertableEdge
            id="ab"
            source="a"
            target="b"
            sourceX={0}
            sourceY={0}
            targetX={200}
            targetY={0}
            sourcePosition={Position.Right}
            targetPosition={Position.Left}
            selected={false}
          />
        </svg>
      </ReactFlowProvider>,
    )
    const path = container.querySelector('svg path')
    expect(path).not.toBeNull()
    expect((path?.getAttribute('d') ?? '').length).toBeGreaterThan(0)
    expect(container.querySelector('[class*="edgeInsert"]')).toBeNull()
    expect(container.querySelector('[class*="edgeBranch"]')).toBeNull()
  })
})

function containerQuery(selector: string): Element | null {
  return document.querySelector(selector)
}
