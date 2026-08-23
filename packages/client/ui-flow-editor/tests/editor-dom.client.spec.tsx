// @vitest-environment jsdom
/**
 * The flow-editor canvas's DOM behavior: a pointer drag moves the node's store
 * position and repaints its transform, a drag clamps at the canvas origin, and
 * a background click deselects. jsdom has no pointer capture, so
 * `setPointerCapture` is stubbed (in a real browser capture retargets the
 * pointermove to the node, which the test mirrors by firing it directly on the
 * node element). The `.canvas` touch-gesture contract is pinned separately in
 * styles.client.spec.ts: jsdom applies no stylesheet, so `touch-action: none`
 * is asserted against the module source rather than computed style.
 */

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SessionId, type SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { FlowEditorView } from '../src/client/FlowEditorView.tsx'
import { FlowEditorController } from '../src/client/flow-store.ts'
import { en } from '../src/client/locales.ts'
import css from '../src/client/FlowCanvas.module.css'

afterEach(cleanup)

// jsdom has no pointer capture; the view's capture call must be a no-op so the
// drag handlers run. Overwriting whatever jsdom ships keeps the stub stable.
beforeEach(() => {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  // jsdom's DragEvent is not constructible, so testing-library builds drop
  // events from plain Event and drops the client coordinates (undefined − 0 =
  // NaN). MouseEvent is the browser's DragEvent base and carries clientX/Y.
  Object.defineProperty(window, 'DragEvent', { configurable: true, value: window.MouseEvent })
})

type ViewProps = Parameters<typeof FlowEditorView>[0]

/** A session feed whose only session has no workspace, so the controller stays local. */
function noWorkspaceSessions(): ViewProps['useSessions'] {
  const store = createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  return bindSnapshotSelector(store) as unknown as ViewProps['useSessions']
}

/** Mount the canvas over a fresh starter draft on a session with no workspace. */
function mountCanvas(): { controller: FlowEditorController; view: RenderResult } {
  const controller = new FlowEditorController({} as unknown as IApiClient, 's1' as SessionId, () => undefined)
  controller.newFlow()
  const props = {
    controller,
    sessionId: 's1' as SessionId,
    useSessions: noWorkspaceSessions(),
    t: (key: keyof typeof en) => en[key],
  } as unknown as ViewProps
  return { controller, view: render(createElement(FlowEditorView, props)) }
}

/** One node card by its canvas id. */
function nodeOf(view: RenderResult, id: string): HTMLElement {
  const element = view.container.querySelector(`[data-node-id="${id}"]`)
  if (element === null) throw new Error(`no node ${id}`)
  return element as HTMLElement
}

/** The canvas background, by the module's own class name. */
function canvasOf(view: RenderResult): HTMLElement {
  const element = view.container.querySelector(`.${css.canvas}`)
  if (element === null) throw new Error('no canvas')
  return element as HTMLElement
}

/** The graph content layer whose transform carries the pan/zoom view. */
function contentOf(view: RenderResult): HTMLElement {
  const element = view.container.querySelector(`.${css.content}`)
  if (element === null) throw new Error('no content')
  return element as HTMLElement
}

/** A minimal DataTransfer the palette drag/drop hands off through. */
function mockDataTransfer(): { setData: (type: string, value: string) => void; getData: (type: string) => string; effectAllowed: string } {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'copy',
    setData(type, value) { data.set(type, value) },
    getData(type) { return data.get(type) ?? '' },
  }
}

describe('flow-editor canvas DOM', () => {
  it('moves a dragged node by the pointer delta and repaints its transform', () => {
    const { controller, view } = mountCanvas()
    const node = nodeOf(view, 'agent-1')
    // The starter draft's agent sits at (220, 0).
    expect(node.style.transform).toBe('translate(220px, 0px)')

    fireEvent.pointerDown(node, { pointerId: 1, clientX: 250, clientY: 30 })
    fireEvent.pointerMove(node, { pointerId: 1, clientX: 290, clientY: 70 })
    fireEvent.pointerUp(node, { pointerId: 1 })

    expect(controller.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-1')?.position)
      .toEqual({ x: 260, y: 40 })
    expect(node.style.transform).toBe('translate(260px, 40px)')
  })

  it('clamps a dragged node at the canvas origin', () => {
    const { controller, view } = mountCanvas()
    const node = nodeOf(view, 'agent-1')

    // A drag up-left from (220, 0) would take the position negative.
    fireEvent.pointerDown(node, { pointerId: 1, clientX: 250, clientY: 30 })
    fireEvent.pointerMove(node, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(node, { pointerId: 1 })

    expect(controller.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-1')?.position)
      .toEqual({ x: 0, y: 0 })
  })

  it('deselects the node on a background click', () => {
    const { controller, view } = mountCanvas()
    const canvas = canvasOf(view)
    const node = nodeOf(view, 'agent-1')

    fireEvent.pointerDown(node, { pointerId: 1, clientX: 250, clientY: 30 })
    fireEvent.pointerUp(node, { pointerId: 1 })
    expect(controller.store.getSnapshot().selectedNodeId).toBe('agent-1')

    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 10, clientY: 10 })

    expect(controller.store.getSnapshot().selectedNodeId).toBeNull()
    expect(controller.store.getSnapshot().selectedEdgeId).toBeNull()
  })

  it('drops a palette node at the graph point and selects it', () => {
    const { controller, view } = mountCanvas()
    const canvas = canvasOf(view)
    const dt = mockDataTransfer()
    const item = view.container.querySelector('[data-node-type="agent"]')
    expect(item).not.toBeNull()
    fireEvent.dragStart(item as HTMLElement, { dataTransfer: dt })
    fireEvent.drop(canvas, { dataTransfer: dt, clientX: 280, clientY: 40 })
    const added = controller.store.getSnapshot().graph?.nodes.find(node => node.id === 'agent-2')
    expect(added?.position).toEqual({ x: 280, y: 40 })
    expect(controller.store.getSnapshot().selectedNodeId).toBe('agent-2')
  })

  it('clamps a drop outside the canvas origin to 0', () => {
    const { controller, view } = mountCanvas()
    const canvas = canvasOf(view)
    const dt = mockDataTransfer()
    const item = view.container.querySelector('[data-node-type="condition"]')
    expect(item).not.toBeNull()
    fireEvent.dragStart(item as HTMLElement, { dataTransfer: dt })
    fireEvent.drop(canvas, { dataTransfer: dt, clientX: -30, clientY: -50 })
    const added = controller.store.getSnapshot().graph?.nodes.find(node => node.id === 'condition-1')
    expect(added?.position).toEqual({ x: 0, y: 0 })
  })

  it('pans the canvas on a background drag past the threshold', () => {
    const { view } = mountCanvas()
    const canvas = canvasOf(view)
    const content = contentOf(view)
    expect(content.style.transform).toBe('translate(0px, 0px) scale(1)')

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 130, clientY: 80 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 130, clientY: 80 })

    expect(content.style.transform).toBe('translate(30px, -20px) scale(1)')
  })

  it('keeps a sub-threshold drag a click, not a pan', () => {
    const { view } = mountCanvas()
    const canvas = canvasOf(view)
    const content = contentOf(view)

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 101, clientY: 100 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 101, clientY: 100 })

    expect(content.style.transform).toBe('translate(0px, 0px) scale(1)')
  })

  it('zooms the canvas at the pointer anchor on wheel', () => {
    const { view } = mountCanvas()
    const canvas = canvasOf(view)
    const content = contentOf(view)

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 90, clientY: 0 })

    expect(content.style.transform).toBe('translate(-18px, 0px) scale(1.2)')
  })

  it('removes the selected node and its edges on Delete', () => {
    const { controller, view } = mountCanvas()
    const node = nodeOf(view, 'agent-1')
    fireEvent.pointerDown(node, { pointerId: 1, clientX: 250, clientY: 30 })
    fireEvent.pointerUp(node, { pointerId: 1 })
    expect(controller.store.getSnapshot().selectedNodeId).toBe('agent-1')

    fireEvent.keyDown(window, { key: 'Delete' })

    const state = controller.store.getSnapshot()
    expect(state.graph?.nodes.find(node => node.id === 'agent-1')).toBeUndefined()
    expect(state.graph?.edges).toHaveLength(0)
    expect(state.selectedNodeId).toBeNull()
  })

  it('removes the selected edge on Backspace', () => {
    const { controller, view } = mountCanvas()
    const edge = view.container.querySelector(`.${css.edgeGroup}`) as HTMLElement
    fireEvent.click(edge)
    expect(controller.store.getSnapshot().selectedEdgeId).toBe('e1')

    fireEvent.keyDown(window, { key: 'Backspace' })

    const graph = controller.store.getSnapshot().graph
    expect(graph?.edges.find(edge => edge.id === 'e1')).toBeUndefined()
    expect(graph?.edges.find(edge => edge.id === 'e2')).toBeDefined()
  })

  it('does not delete while typing in an input', () => {
    const { controller, view } = mountCanvas()
    const node = nodeOf(view, 'agent-1')
    fireEvent.pointerDown(node, { pointerId: 1, clientX: 250, clientY: 30 })
    fireEvent.pointerUp(node, { pointerId: 1 })
    expect(controller.store.getSnapshot().selectedNodeId).toBe('agent-1')

    const input = view.container.querySelector('input') as HTMLElement
    fireEvent.keyDown(input, { key: 'Backspace' })

    expect(controller.store.getSnapshot().graph?.nodes.find(candidate => candidate.id === 'agent-1')).toBeDefined()
  })
})
