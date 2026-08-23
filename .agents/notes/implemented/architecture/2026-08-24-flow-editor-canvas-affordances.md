# Agent Note: Flow canvas palette, pan/zoom, and delete-key affordances

Status: implemented

English | [中文](2026-08-24-flow-editor-canvas-affordances.zh.md)

## Problem

The flow canvas could only drag nodes; the Dify-style editing model was absent. There was no way to add a node by dragging one in, no pan or zoom (a fixed scrollable grid), and no keyboard delete. The wheel was unusable on top of that: React registers `wheel` as a passive listener at the root, where `preventDefault` is ignored, so a wheel handler could not stop the page from scrolling over the canvas.

## Decision

The canvas gains three affordances, each a thin gesture over a pure, unit-tested geometry helper in `src/client/view.ts` (`ViewState`, `clientToGraph`, `panView`, `zoomAt`, `clampScale`):

- **Palette drag-drop** — a left strip of draggable Agent/Condition/Loop chips (the toolbar buttons remain as an accessibility fallback). A chip's `dragStart` writes the node type under `application/x-flow-node` into the data transfer; the canvas `drop` reads it, converts the client point to graph coordinates via `clientToGraph`, and calls `controller.addNodeAt(type, position)`, which clamps to the origin and selects the new node. The graph point under the cursor is preserved through the view transform.
- **Pan/zoom** — the `.content` layer carries `translate(x, y) scale(s)`. A background `pointerdown` begins a pan gesture; the view only tracks once the pointer passes a 3 px movement threshold (`PAN_THRESHOLD`), so a stationary press remains a click that deselects instead of jiggling the canvas. Wheel zoom is pointer-anchored (`zoomAt`) and clamped to 0.2×–2× (`MIN_SCALE`/`MAX_SCALE`), and it uses a native non-passive `wheel` listener because React's passive wheel never lets `preventDefault` run. `.canvas` switches to `overflow: hidden`; the view transform replaces the scrollbars.
- **Delete/Backspace** — a window `keydown` listener removes the selected node (`removeNode`) or edge (`removeEdge`), guarded to ignore focus inside `input`, `textarea`, `select`, or `[contenteditable]`, so typing in the inspector or run input is safe.

The geometry is factored out of the component so every gesture is testable without a DOM (`view.client.spec.ts`), and the DOM wiring is pinned in `editor-dom.client.spec.tsx`. jsdom has no constructible `DragEvent` — testing-library builds drop events from a plain `Event`, which drops the client coordinates (so the drop point became `NaN`) — so the DOM tests polyfill `window.DragEvent = window.MouseEvent` in `beforeEach`. That polyfill is test-only, not product code.

## Alternatives considered

- **Keep the scrollable grid without pan/zoom** — rejected: the 画布拖不动 fix and the Dify-like editing model both require a pannable, zoomable canvas.
- **Attach the wheel listener through React `onWheel` with `preventDefault`** — rejected: React registers wheel passively at the root, so the `preventDefault` is ignored and the page scrolls under the canvas.
- **Treat any background drag as a pan immediately** — rejected: the movement threshold separates a pan from a click-to-deselect, keeping a slightly-dragged click from moving the view or failing to deselect.
- **Compute the view changes inline in the component** — rejected: factoring the geometry into `view.ts` keeps the gesture math unit-testable without a DOM and reusable by the B1b preset canvas.

## Consequences

- The canvas is a pan/zoom dot grid with a draggable palette; node drag, connect, pan, zoom, and delete coexist (a pan starts only on the background, where node `pointerdown` stops propagation).
- `.canvas` `touch-action: none` from B0.3 stays; pointer pan and wheel zoom ship, while touch pan and pinch zoom remain deferred and noted in the README.
- New `palette.title`, `palette.hint`, and `canvas.hint` locale keys in en and zh.
- B1b's preset canvas reuses `view.ts` and the same gesture pattern for the module palette.
