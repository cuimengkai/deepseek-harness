# Agent Note: xyflow canvas and topology graph

Status: implemented

[English](2026-08-24-xyflow-canvas-and-topology.md) | 中文

## Problem

产品中的每块图形面用的都不是 xyflow 的引擎：流程画布（`ui-flow-editor` 的 `FlowCanvas`）手写实现了平移/缩放、边几何与视图数学（`view.ts`），开发模式的项目洞察拓扑图用的是 Cytoscape.js。要求是两块图形面都改用 `@xyflow/react`（React Flow），并还原 Agent 编排的 Dify 交互——调色板拖拽与点击新增、Dify 式节点卡片、smoothstep 边、选中高亮加右侧检查器、节点悬浮「+」打开节点选择器、边中点「+」插入、minimap 与缩放控件。

## Decision

两块图形引擎都迁移到 React Flow（`@xyflow/react@^12.11.3`），它被内联进 client bundle，而非加入冻结的模块表；其 `react`/`react-dom` 导入外部化为 shell 的 platform 模块。React Flow 基础样式表以 `xyflow-base.css` 形式逐包 vendored（带固定版本头注释），因为现有的 global-inline 虚拟加载器无法解析裸包名导入；每个包再叠加自己的 `flow-overrides.css` 设计 token 层。

- **共享流程画布（`ui-flow-editor`）**——`FlowCanvas` 现在是一个 React Flow 视口。`rf-map.ts`（纯函数；不触碰 DOM 或 store）把 `FlowGraph` 投影为 `Node[]`/`Edge[]`，并把手势事件规约为 `FlowCanvasSurface` 调用；`CanvasNode` 在带定位的包裹内渲染调用方的 `renderNode` 卡片，附带 target/source 端口与悬浮「+」；`InsertableEdge` 渲染带分支标签芯片与中点「+」的 smoothstep 路径。手势把 `onNodeDragStop`→`moveNode`、`onConnect`→`addEdge`、`onSelectionChange`→单点路由、`onDrop`→`addNodeAt`（钳制到原点）、窗口 Delete/Backspace→`removeNode`/`removeEdge`（React Flow 的 `deleteKeyCode` 保持 `null`，链语义与 start/end 拒删得以保留）、一次性 `fitView` 一一接好。`view.ts` 被删除；`FlowCanvasProps` 新增 `onAddNode`/`onInsertBetween` 钩子。
- **项目洞察拓扑图（`ui-project-insight`）**——`CytoscapeGraph` 被 `TopologyGraph` 取代：`@dagrejs/dagre` 的 LR 布局（`layout.ts`）确定节点位置，自定义 `TopologyNode` 以循环/悬停/选中高亮渲染路径，并带隐藏的左/右端口（React Flow v12 把每条边钉在端口上，而拓扑图不可连线，因此端口为 `opacity: 0`）；点按节点选中、点按画布清空，悬停由节点自身上报（React Flow v12 移除了画布级 mouse-enter/leave）。minimap 与缩放控件随附；视图在首次布局时适配一次，容器变化时重新适配。
- **Agent 编排器（`ui-agent-preset`）**——编排器通过 `presetFlowSurface` 驱动共享画布（`@deepseek-ai/dsh-client-ui-flow-editor/client`），Dify 交互得以还原：调色板可点击或拖放新增，节点悬停显示悬浮「+」为后继打开 `NodePickerModal`，边中点的「+」经同一选择器在两端点之间插入。`insertSlot(after, agents)` 保持链语义（start→首位、agent→紧随其后、end→保持链尾），被选模块的节点会被选中，其检查器随即打开。`PipelineCanvas.tsx` 被删除；`palette-group.ts` 与 `NodePickerModal.tsx` 为新增。

手势↔surface 的映射是纯函数（`rf-map.ts`），无需 DOM 即可单测；jsdom spec 只在 jsdom 下可靠的手势（选择、拖拽、拖放、画布、按键、悬停）上驱动真实 React Flow 画布。编排器测试 mock 画布，针对记录下来的 surface 断言编排器动作，而不去驱动 React Flow 的手势。

## Alternatives considered

- **保留手写画布与 Cytoscape**——否决：要求点名两处都用 xyflow，而且手写的视图数学与边几何是 React Flow 能去掉的维护面。
- **拓扑图用另一个图库**——否决：让 Cytoscape 与 React Flow 并存会把图栈与设计 token 重制拆到两套引擎上。
- **拓扑图用 React Flow 默认节点、不加自定义端口**——否决：React Flow v12 不会为端点没有 `<Handle>` 的边画线，因此静态拓扑图需要隐藏端口才能跑通边管线。
- **编排器另起画布而非共享流程画布**——否决：共享的 `FlowCanvasSurface` 接缝让流程编辑器与编排器共用同一套画布实现与手势契约。

## Consequences

- `cytoscape` 离开 `ui-project-insight` 的依赖；`view.ts`、`CytoscapeGraph.tsx` 与 `PipelineCanvas.tsx` 被删除。
- React Flow 被内联进三个 client bundle（约 30 KB gzip），不在冻结的模块表中，因此 shell seed 与 platform 表保持不变。
- 触屏平移与捏合缩放现在是 React Flow 原生能力（vendored 基础 CSS 设置 `touch-action: none`）；此前的「触屏平移延后」画布局限移除。
- 拓扑画布适配整个图；列表选中的节点只加环与高亮、不平移——旧 cytoscape「加环并居中」的行为收窄为加环与高亮，记录为 Known Limitation。列表选中后来获得居中、聚焦缩放与关联边高亮（[[2026-08-26-insight-tabs-pinned-tree-focus]]），该局限解除。
- 升级固定版本的 React Flow 时，vendored 基础样式表必须重新 vendor。
