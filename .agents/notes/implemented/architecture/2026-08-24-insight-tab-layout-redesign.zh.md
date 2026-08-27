# Agent Note: 开发模式洞察标签改为画布加悬浮列表与文档标签布局

Status: implemented

[English](2026-08-24-insight-tab-layout-redesign.md) | 中文

## 问题

六个开发模式洞察标签把各自内容渲染在局促、不友好的布局里。两个依赖标签把 cytoscape 图放在固定高度的框架里，完整模块或组件列表作为画布下方可折叠的 `details`——列表与画布之间毫无交互。提示词标签只是纯元数据表格（路径/标题/字节），从不展示提示词的 markdown。agent 相关技术的技能/MCP/提示词二级标签把所有文档卡片竖排堆叠，没有一个文档突出。用户诉求——「模块依赖拓扑图和组件依赖两个tab的展示还是太丑陋不友好，这里可以使用画布铺满容器，完整列表可以悬浮在画布上面，支持列表和画布的交互；提示词也按照tab形式展示，需要将md内容展示出来」——要求画布铺满容器、完整列表悬浮于其上、列表与画布交互，提示词以标签形式展示并呈现其 markdown。

## 决策

三个表面共享同一套布局语言，沿用轨迹标签的铺满先例（区段根节点 `flex:1 1 0%; min-height:0; overflow:hidden`）。

- **两个依赖标签共享一个 `GraphBody`。** 满铺的 cytoscape 画布填满剩余高度，完整模块或组件列表以半透明面板悬浮在画布右侧（`backdrop-filter` 模糊、absolute 定位、`z-index` 盖在画布之上）。列表与画布双向同步：悬停或点击列表行即设置节点的 `hover`/`selected` props，悬停或点按画布节点即高亮并滚动对应列表行到视内。未进入有界节点集的行仍列出但置灰标注「未在图中」且不可交互；工具栏开关收起面板，让画布独占全部宽度。无边的回退保留纯完整列表。
- **提示词标签曾渲染文档标签栏加单个可滚动 markdown 面板**，经 `MarkdownText` 展示。其 markdown 取自 agent 相关技术区段的内嵌提示词集合（`doc.sections.agentTech.prompts`）——扫描器对两者都用同一 `isPromptFile` 判定，因此两个标签是同一逻辑集合投影到不同呈现。提示词标签后来作为 agent 相关技术提示词二级标签的重复被删除（[[2026-08-26-insight-tabs-pinned-tree-focus]]）；文档标签加 markdown 面板的呈现保留为 agent 相关技术二级标签共享的 `MarkdownViewer`。
- **agent 相关技术的技能/MCP/提示词二级标签从堆叠卡片改为同样的文档标签加单 markdown 面板**，经共享的 `MarkdownViewer`（行数 0 → 空态文案；1 → 直接渲染；>1 → 标签栏）。
- **`CytoscapeGraph` 变为受控组件**，带 `hoverNodeId`/`selectedNodeId` props 与 `onSelectNode`/`onHoverNode`/`onTapBackground` 回调（经 ref 持有最新闭包）、容器尺寸变化时重新 fit 的 `ResizeObserver`，以及 `node.hover`/`node.selected` 样式表条目；选中时还会重新居中视图。无 schema 变更：线上文档保持 `formatVersion` 3，六个区段文件不变。

## 备选方案

- **升级文档格式，让顶层 `prompts` 区段自带 markdown**——被否决：agent 相关技术内嵌已通过同一 `isPromptFile` 判定持有同一逻辑集合，再次内嵌会重复数据、迫使格式升级，并为没有新增能力而改动扫描器、夹具与 e2e。
- **保留画布下方可折叠 `details` 的完整列表**——被否决：没有列表与画布的交互，且固定高度画布浪费容器空间。
- **agent 相关技术二级标签仍把所有文档渲染成卡片堆叠**——被否决：不能突出任一文档，且大集合下滚动体验差。

## 后果

- 提示词渲染耦合到 agent 相关技术内嵌的界（前几行、逐行与总量字节上限）：提示词文件多而大的项目只显示渲染子集，计数行标注展示了什么。该耦合写入包 README 的已知局限。本笔记新增的独立提示词标签后来被删除；agent 相关技术的提示词二级标签是提示词的唯一呈现（[[2026-08-26-insight-tabs-pinned-tree-focus]]）。
- 悬浮列表是封顶依赖图的完整性兜底：每个模块或组件都保留在列表中，有界节点集省略的节点置灰。
- 双向同步只在一处——`GraphBody` 状态驱动受控画布 props——因此模块与组件标签按构造行为一致。
- 共享 `MarkdownViewer` 让提示词与 agent 相关技术二级标签的 markdown 渲染一致，两个表面不会漂移。
- 画布发布时是真实 cytoscape 实例，平移/缩放/滚轮与循环高亮保留；同日的 xyflow 迁移把它替换为 React Flow 的 `TopologyGraph`（[[2026-08-24-xyflow-canvas-and-topology]]），本框架保持不变。
