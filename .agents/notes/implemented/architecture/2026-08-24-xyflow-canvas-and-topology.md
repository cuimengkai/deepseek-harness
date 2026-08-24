# Agent Note: xyflow canvas and topology graph

Status: implemented

English | [中文](2026-08-24-xyflow-canvas-and-topology.zh.md)

## Problem

Every graph surface in the product used an engine that was not xyflow: the flow canvas (`ui-flow-editor`'s `FlowCanvas`) hand-implemented pan/zoom, edge geometry, and view math (`view.ts`), and the develop-mode project-insight topology used Cytoscape.js. The requirement was to use `@xyflow/react` (React Flow) for both surfaces and to restore the Dify orchestration interactions for Agent composition — palette drag and click add, Dify-style node cards, smoothstep edges, selection highlight with a right inspector, a node-hover floating "+" that opens a node picker, edge-midpoint "+" insertion, a minimap, and zoom controls.

## Decision

Both graph engines move to React Flow (`@xyflow/react@^12.11.3`), which is inlined into the client bundles rather than added to the frozen module table; its `react`/`react-dom` imports externalize to the shell's platform modules. The React Flow base stylesheet is vendored per package as `xyflow-base.css` (pinned version header) because the existing global-inline virtual loader cannot resolve the bare package import, and each package adds its own `flow-overrides.css` design-token layer.

- **Shared flow canvas (`ui-flow-editor`)** — `FlowCanvas` is now a React Flow viewport. `rf-map.ts` (pure; no DOM or store) projects a `FlowGraph` onto `Node[]`/`Edge[]` and reduces gesture events to `FlowCanvasSurface` calls; `CanvasNode` renders the caller's `renderNode` card inside a positioned wrapper with target/source handles plus a floating "+"; `InsertableEdge` renders a smoothstep path with a branch-label chip and a midpoint "+". Gestures route `onNodeDragStop`→`moveNode`, `onConnect`→`addEdge`, `onSelectionChange`→single-selection route, `onDrop`→`addNodeAt` (clamped to the origin), window Delete/Backspace→`removeNode`/`removeEdge` (React Flow's `deleteKeyCode` stays `null` so chain semantics and start/end refusal survive), and a one-time `fitView`. `view.ts` is deleted; `FlowCanvasProps` gains `onAddNode`/`onInsertBetween` hooks.
- **Project-insight topology (`ui-project-insight`)** — `CytoscapeGraph` is replaced by `TopologyGraph`: a `@dagrejs/dagre` LR layout (`layout.ts`) positions nodes, a custom `TopologyNode` renders the path with cycle/hover/selected accents and hidden left/right handles (React Flow v12 pins every edge to a handle, and the topology is not connectable, so the handles are `opacity: 0`), node tap selects, pane tap clears, and hover reports from the node itself (React Flow v12 removed canvas-level mouse-enter/leave). A minimap and zoom controls ship; the view fits the layout once and re-fits on container resize.
- **Agent composer (`ui-agent-preset`)** — the composer drives the shared canvas (`@deepseek-ai/dsh-client-ui-flow-editor/client`) through a `presetFlowSurface`, with the Dify interactions restored: the palette adds by click or drop, a node's hover shows a floating "+" that opens `NodePickerModal` for a successor, and an edge's midpoint "+" inserts between endpoints through the same picker. `insertSlot(after, agents)` keeps chain semantics (start→first, agent→follows it, end→stays at the tail), and the picked module's node is selected so its inspector opens. `PipelineCanvas.tsx` is deleted; `palette-group.ts` and `NodePickerModal.tsx` are new.

The gesture↔surface mapping is pure (`rf-map.ts`) and unit-tested without a DOM; the jsdom specs drive the real React Flow canvas only for the gestures that are reliable under jsdom (select, drag, drop, pane, key, hover). The composer tests mock the canvas and assert composer actions against the recorded surface instead of exercising React Flow's gestures.

## Alternatives considered

- **Keep the hand-rolled canvas and Cytoscape** — rejected: the requirement names xyflow for both, and the hand-rolled view math and edge geometry were a maintenance surface React Flow removes.
- **A second graph library for the topology** — rejected: keeping Cytoscape alongside React Flow splits the graph stack and the design-token restyling across two engines.
- **Topology with React Flow's default nodes and no custom handles** — rejected: React Flow v12 will not draw an edge whose endpoints carry no `<Handle>`, so the static topology needs hidden handles for the edge pipeline to run.
- **A separate canvas for the composer instead of sharing the flow canvas** — rejected: the shared `FlowCanvasSurface` seam keeps one canvas implementation and one gesture contract across the flow editor and the composer.

## Consequences

- `cytoscape` leaves `ui-project-insight`'s dependencies; `view.ts`, `CytoscapeGraph.tsx`, and `PipelineCanvas.tsx` are deleted.
- React Flow is inlined into the three client bundles (~30 KB gzip) and is not in the frozen module table, so the shell seed and platform table are untouched.
- Touch pan and pinch zoom are React Flow-native (the vendored base CSS sets `touch-action: none`); the earlier "touch pan deferred" canvas limitation is removed.
- The topology canvas fits the whole graph and does not pan to a list-selected node — the previous cytoscape "rings and centers" behavior narrows to ringing and highlighting, recorded as a Known Limitation.
- The vendored base stylesheet must be re-vendored when the pinned React Flow version upgrades.
