# Agent Note: The develop-mode insight tabs move to a canvas-plus-floating-list and document-tab layout

Status: implemented

English | [中文](2026-08-24-insight-tab-layout-redesign.zh.md)

## Problem

The six develop-mode insight tabs rendered their content in cramped, unhelpful layouts. The two dependency tabs put the cytoscape graph in a fixed-height frame with the complete module or component list below it as a collapsible `details` — no interplay between the list and the canvas. The prompts tab was a metadata-only table (path/title/bytes) that never showed a prompt's markdown. The agent-tech skills/MCP/prompts sub-tabs stacked every document's card vertically, so no single document was prominent. The user's request — "模块依赖拓扑图和组件依赖两个tab的展示还是太丑陋不友好，这里可以使用画布铺满容器，完整列表可以悬浮在画布上面，支持列表和画布的交互；提示词也按照tab形式展示，需要将md内容展示出来" — asks for the canvas to fill the container with the complete list floating over it, list-to-canvas interplay, and prompts shown as tabs with their markdown.

## Decision

Three surfaces share one layout language, following the trajectory tab's fill precedent (`flex:1 1 0%; min-height:0; overflow:hidden` on the section root).

- **Dependency tabs share one `GraphBody`.** A full-bleed cytoscape canvas fills the remaining height, and the complete module or component list floats over it as a translucent right-side panel (`backdrop-filter` blur, absolute inset, `z-index` above the canvas). The list and canvas stay in sync in both directions: hovering or clicking a list row sets the node's `hover`/`selected` props, and hovering or tapping a canvas node highlights and scrolls the corresponding row into view. Rows outside the bounded node set stay listed but dimmed as "not in graph" and inert; a toolbar toggle collapses the panel so the canvas owns the full width. The no-edge fallback keeps the plain full list.
- **The prompts tab rendered a document tab bar over a single scrollable markdown pane** through `MarkdownText`. Its markdown came from the agent-tech section's embedded prompt collection (`doc.sections.agentTech.prompts`) — the scanner fills both through the same `isPromptFile` judgement, so the two tabs were the same logical set projected onto different presentations. The prompts tab itself was later removed as a duplicate of the agent-tech prompts subtab ([[2026-08-26-insight-tabs-pinned-tree-focus]]); the document-tab-plus-markdown-pane presentation survives as the shared `MarkdownViewer` over the agent-tech subtabs.
- **The agent-tech skills/MCP/prompts sub-tabs switch from stacked cards to the same document-tab plus single markdown pane** via a shared `MarkdownViewer` (rows length 0 → empty copy; 1 → direct render; >1 → tab bar).
- **`CytoscapeGraph` becomes controlled** with `hoverNodeId`/`selectedNodeId` props and `onSelectNode`/`onHoverNode`/`onTapBackground` callbacks (latest closures through a ref), a `ResizeObserver` that re-fits on container resize, and `node.hover`/`node.selected` stylesheet entries; selection also re-centers the view. No schema change: the wire document keeps `formatVersion` 3 and the six section files untouched.

## Alternatives considered

- **Bump the document format so the top-level `prompts` section carries markdown** — rejected: the agent-tech embed already holds the same logical set through the same `isPromptFile` judgement, so embedding again would duplicate data, force a format bump, and touch the scanner, fixtures, and e2e for no new capability.
- **Keep the complete list below the canvas as a collapsible `details`** — rejected: it gives no list-to-canvas interplay, and a fixed-height canvas wastes the container.
- **Render every document in the agent-tech sub-tabs as a card stack** — rejected: it does not make any single document prominent and scrolls poorly for large collections.

## Consequences

- The prompts rendering is coupled to the agent-tech embed's bounds (first rows, per-row and total byte caps): a project with many or large prompt files shows only the rendered subset, and the count line names what is shown. The coupling is documented in the package README's Known Limitations. The standalone prompts tab this note added was later removed; the agent-tech prompts subtab is the prompts' only presentation ([[2026-08-26-insight-tabs-pinned-tree-focus]]).
- The floating list is the completeness fallback for the capped dependency graph: every module or component stays listed, dimmed for nodes the bounded node set omits.
- The two-way sync lives in one place — `GraphBody` state driving the controlled canvas props — so the module and component tabs behave identically by construction.
- The shared `MarkdownViewer` renders prompts and agent-tech sub-tabs identically, so the two surfaces cannot drift apart.
- The canvas shipped as a real cytoscape instance with pan/zoom/wheel and cycle highlighting preserved; the same day's xyflow migration replaced it with the React Flow `TopologyGraph` ([[2026-08-24-xyflow-canvas-and-topology]]), keeping this frame unchanged.
