# Agent Note: Flow canvas touch drag via pointer-capture discipline

Status: implemented

English | [中文](2026-08-23-flow-editor-touch-drag.zh.md)

## Problem

Node drag on the flow canvas is pointer-event based: `pointerdown` on a node calls `setPointerCapture`, and the drag follows `pointermove`. On a touchscreen the browser converts a pointer drag into a `pointercancel` and reclaims the gesture unless the element declares it will handle panning and scrolling itself. The canvas set no `touch-action`, so on touch devices a drag aborted the moment the browser claimed the gesture — the 画布拖不动 report reproduced on touch while desktop pointer drags worked.

## Decision

`.canvas` sets `touch-action: none`, which tells the browser the element owns its panning and scrolling, so a touch drag keeps firing `pointermove` instead of turning into a `pointercancel`. Node drag now tracks the finger on touch exactly as it tracks a pointer. The canvas's own pan and zoom stay deferred, so the rule is a prerequisite, not a feature: it buys correct drag semantics now and leaves the element free of the browser's gesture handling when pan work lands.

A new `editor-dom.client.spec.tsx` pins the DOM-level behavior jsdom can observe: a node drag moves the node's position by the pointer delta and repaints its DOM `transform`, a drag clamps at the canvas origin, and a background click deselects. jsdom has no `setPointerCapture`, so the test stubs it on `Element.prototype` (a real browser retargets the captured `pointermove` to the node, which the test mirrors by firing the move directly on it). The computed `touch-action: none` is asserted in `styles.client.spec.ts`, because jsdom applies no stylesheet.

## Alternatives considered

- **Keep the pointer-event drag without `touch-action`** — the observed defect: the browser turns the touch drag into a `pointercancel` and the node stops following the finger.
- **Finalize a partial drag on `pointercancel`** — treats the symptom; the drag still aborts mid-gesture instead of tracking the finger to the drop point.
- **Limit `touch-action: none` to a `(pointer: coarse)` media query** — the gesture takeover is a property of the element's interaction and the rule is harmless for precision pointers; a media query only re-adds the same rule later when pan work lands, with no benefit now.

## Consequences

- Node drag works on touch; desktop pointer drag is unchanged.
- `.canvas` `touch-action: none` is the prerequisite the deferred pan/zoom work builds on.
- The ui-flow-editor Known Limitations section records that touch pan and zoom are deferred alongside the pointer work.
