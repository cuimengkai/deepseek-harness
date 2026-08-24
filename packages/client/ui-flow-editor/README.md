# @deepseek-ai/dsh-client-ui-flow-editor

English | [中文](README.zh.md)

The shared flow-canvas component library: a React Flow ([`@xyflow/react`](https://reactflow.dev)) viewport over a [`FlowGraph`](../../workflow/flow/README.md) — pan, zoom, node drag, edge drawing, palette drop, and delete-key gestures, with a minimap and zoom controls. It is a component library, not an interactive plugin — the only consumer is the agent-preset composer in 新建Agent, which drives the same gestures over its graph-backed composition rows through the [`FlowCanvasSurface`](src/client/FlowCanvas.tsx) face. The browser roster mounts this package only to serve those module bytes to the module table (the composer requires `@deepseek-ai/dsh-client-ui-flow-editor/client`); the former session conversation-view entry ("Flow") was removed, so the package registers no view.

The canvas owns geometry only. A caller-provided `renderNode` renders each node card, and a caller-owned palette feeds the drop payload (`dropMime`, default `application/x-flow-node`). Pan, zoom, and node drag are React Flow's own — the viewport clamps zoom to 0.2×–2×, node positions to the canvas origin, and a fresh graph fits the view once on first layout; node drags live-follow the pointer and commit to the surface only on drag stop. Delete/Backspace removes the selected node or edge (guarded against editable content inside a node), and dragging a node's port onto another node draws an edge. When the caller wires a node picker, a floating "+" on each node opens it for a successor and a floating "+" at each edge midpoint inserts a node between the endpoints; both buttons hide in read-only, where drag, connect, and drop are disabled too.

`src/client/index.ts` exports an `apply()` that mounts nothing — the empty plugin entry keeps the mounted row valid for the boot kernel's activation audit while its only effect is supplying the bundle.

## Model Experience

Indirectly, through the graphs the canvas authors and runs, which compile into the sub-agent prompts [`@deepseek-ai/dsh-flow`](../../workflow/flow/README.md) assembles; the canvas itself contributes no prompt content.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The session-level flow run surface is gone** — a session conversation no longer has a "Flow" tab to author, persist, run, or watch branching agent flows. The host flow engine (`@deepseek-ai/dsh-flow`, the `flow` host row) and its eight `flow.*` RPCs stay mounted for automation and future saved-subflow reuse; the agent-preset composer owns the interactive orchestration surface instead.
- **The canvas is geometry-only, not a full editor** — it renders and routes gestures; per-node affordances (agent prompt, model routes, run controls) belong to the consumer's `renderNode` and its inspector, not this package.
- **No auto-layout** — a palette drop lands the node where it is dropped and the node picker inserts right after the anchor node, but nothing auto-arranges the graph; hand-placed layouts stay as authored.
- **No push channel** — this package renders settled geometry only; live run-status painting is the consumer's concern.
