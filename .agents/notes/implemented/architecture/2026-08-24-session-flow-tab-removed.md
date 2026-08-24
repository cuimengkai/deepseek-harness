# Agent Note: Session flow tab removed; the canvas becomes a component provider

Status: implemented

English | [中文](2026-08-24-session-flow-tab-removed.zh.md)

## Problem

The session conversation carried a "Flow" tab (`conversation.view` entry at ring order 15) that authored, persisted, ran, and watched branching agent flows through the host flow engine. That placement was wrong: the user confirmed flow orchestration belongs to 新建Agent's agent-preset composer, where the same `FlowCanvas` drives the graph-backed composition rows. The tab was also un-gated — it registered for every session regardless of preset, so a session that never intended to run a flow still showed a canvas tab. Removing it left the package's job unclear: the canvas is now a shared component library consumed by the composer, not a conversation surface.

## Decision

Remove the session-level flow surface and make the package a component provider.

- The `conversation.view` registration (order 15) is gone, along with the session-level `FlowEditorController`, its store, view, and locales (`FlowEditorView.tsx`, `flow-store.ts`, `locales.ts`). The package registers no view.
- `@deepseek-ai/dsh-client-ui-flow-editor` becomes a component library: `src/client/index.ts` exports `FlowCanvas` and the `view.ts` geometry (`clientToGraph`, `panView`, `zoomAt`, `fitView`). The agent-preset composer requires `@deepseek-ai/dsh-client-ui-flow-editor/client` as a module-table row.
- The web composition keeps the `ui-flow-editor` row mounted as a component provider: the modules node half scans loader entries for `dsh.client` packages and serves their `lib/client.js` to the module table, which is exactly the bytes the composer's external require resolves. The row keeps an empty `apply` because the boot kernel mounts every roster entry through `registry.plugin`, which throws for a module without an `apply` (vendor/cordis/src/registry.ts).
- The host flow engine (the `flow` host row) and its eight `flow.*` RPCs stay mounted — a host-plane capability for automation and future saved-subflow reuse. Only the session-level run surface is removed; the README records it under Known Limitations.

## Alternatives considered

- **Keep the tab gated to develop mode** — rejected: the user stated flow orchestration belongs to 新建Agent, so a session tab is wrong regardless of preset gating.
- **Strip the plugin contract entirely, drop the row, and inline the canvas into the composer bundle** — rejected: the composer's `dsh.client.external` requires `…/client` from the module table, so the row must stay mounted to serve those bytes; removing it would leave the composer's require unresolved at startup. Inlining instead would require a shared `INLINE_SAFE` change in `tsdown.client.ts`, a repo-wide client-infrastructure edit the surface removal does not justify.

## Consequences

- A session conversation has no "Flow" tab; interactive flow orchestration lives only in the agent-preset composer. The `flow-editor` slot-catalog occupant is gone.
- The package is a component library with a `dsh.client` block declaring `platform: web` and no inject list; its peer dependencies narrow to `cordis`, `dsh-flow`, and `dsh-invariants`.
- The canvas is geometry-only: it renders nodes and routes gestures; per-node affordances (agent prompt, model routes, run controls) belong to the consumer's `renderNode` and inspector. The [canvas affordances](2026-08-24-flow-editor-canvas-affordances.md) and [preset composition flow graph](2026-08-24-preset-composition-flow-graph.md) decisions stay current.
- The host `flow.*` RPC surface remains for automation; a future saved-subflow editor would re-introduce a UI consumer of that engine without restoring the session tab.
