# Agent Note: 开发模式洞察标签渲染 cytoscape 依赖图并增强卡片/表格

Status: implemented

[English](2026-08-24-insight-visualization-cytoscape.md) | 中文

## 问题

开发模式的洞察标签把每个已扫描区段渲染成排序行构成的扁平列表——可用，但用户诉求——「页面的布局和信息展示太简洁丑陋了，不能借助一些第三方可视化展示么」——要求第三方可视化与更丰富的布局。六个标签同样扁平，依赖结构一眼无法读懂，盘点区段也没有视觉层次。

## 决策

把两个依赖区段（模块依赖拓扑、组件依赖）渲染成交互式 cytoscape 有向图，并把其余四个盘点区段增强为卡片、徽章与两列表格。可视化是对已提交文档的纯客户端推导；schema、`projectInsight.read` 线上接口与 host 服务均不变（[[2026-08-24-insight-per-type-layout]]）。

- `graph.ts` 持有纯推导。`deriveModuleGraph(section, caps)` 返回 `{ nodes, edges, cycleNodeIds, capped }`：仅当导入目标在被发出的文件集合内、不以 `external:` 开头且不是自环时才计为一条边；每个文件的度是该集合内的入度加出度，因此共享库排最前。节点按度最高的路径封顶（`maxNodes: 120`），并列按路径升序打破，边在确定性排序后按数量封顶（`maxEdges: 500`）；标签来自最长匹配的路径别名前缀。`deriveComponentGraph` 渲染每个组件，把 `section.cycles` 互引对折入 `cycleNodeIds` 高亮集合，并共享边封顶。`capped` 标明每个封顶省略了什么。
- `CytoscapeGraph.tsx` 终生拥有一个 cytoscape 实例：平移、缩放、滚轮与点击免费获得。有界元素集变化时重建实例（cytoscape 把 elements 数组当作实例的完整内容，因此重建新核心比做 diff 更简单），卸载时销毁。cycle 效果对当前实例的元素重新分类。主题颜色在挂载时从容器的计算设计 token 解析，因为 cytoscape 的 canvas 渲染器不解析 CSS 自定义属性；每个 token 都有具体回退值。
- `InsightTab.tsx` 在 `useMemo` 中推导图，渲染在可折叠 `<details>` 完整列表之上，因此封顶或空图绝不隐藏底层数据。当封顶省略了任何内容时，一行说明文字报告封顶情况。其余四个盘点区段重构为 `.card` / `.cardHead` / `.table` / `.tableRow` 标记与 `.badge` 徽章。
- cytoscape `3.34.0` 是 devDependency，由 tsdown 的 `alwaysBundle` 规则内联进客户端 bundle；它不是 `@deepseek-ai/*` 值导入，因此 `dsh-client-bundle-purity` 不反对。cytoscape 自带捆绑的 TypeScript 类型定义，因此不存在 `@types/cytoscape`。

## 备选方案

- **保留扁平列表**——被否决：不满足用户对第三方可视化的明确诉求，依赖结构仍不可读。
- **手写 SVG 或 D3 力导向布局**——被否决：平移、缩放、滚轮与点击高亮都需要重写并重新测试，却无收益；cytoscape 免费提供它们，且是用户选定的库。
- **不封顶渲染每个节点与边**——被否决：大型项目会不可读；封顶保持可视化可用，可折叠完整列表兜底完整性。

## 后果

- 模块与组件标签现在是带可折叠列表的交互式依赖图；其余四个盘点标签拥有卡片、徽章与表格。完整列表始终一次点击可达。
- 客户端 bundle 因 cytoscape 增加约 0.97 MB（CJS）/ 约 210 KB（gzip）。
- 单元测试不覆盖真实 cytoscape 渲染——jsdom 没有 canvas——因此覆盖率瞄准纯推导（节点顺序、封顶、cycle 集合、别名标签）与 mock 化 cytoscape 的挂载（元素、布局、样式表选择器、cycle 类、销毁）。
