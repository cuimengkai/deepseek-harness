# Agent Note: 洞察标签删除提示词标签、固定 agent 相关技术二级标签行，全部清单面改为树形浏览器

Status: implemented

[English](2026-08-26-insight-tabs-pinned-tree-focus.md) | 中文

## 问题

画布加悬浮列表重构（[[2026-08-24-insight-tab-layout-redesign]]、[[2026-08-24-xyflow-canvas-and-topology]]）之后，开发模式洞察标签仍有五个可用性问题：独立的提示词标签与 agent 相关技术标签的提示词二级标签内容重复；agent 相关技术的二级标签行（清单/技能/MCP，再到文档标签栏）随内容一起滚走，因为该区段依赖页面级滚动；技术栈与组件标签是被用户称为体验差劲的扁平排序列表，诉求是左树右内容布局加第三方语法高亮；agent 相关技术的清单二级标签是扁平角色表，技能/MCP/提示词二级标签是文档标签栏加单个 markdown 面板，用户要求同样改为左树右内容布局、支持查看内容并高亮语法；点击依赖画布上悬浮列表的行只给节点加环、从不动视口，选中的节点在屏外就留在屏外——正是 xyflow 笔记录下的已知局限。

## 决策

五处改动，全部位于 `@deepseek-ai/dsh-client-ui-project-insight`；扫描器、schema、线上协议与磁盘文档均未触动（`formatVersion` 保持 3，六个区段文件照常提交）。

- **删除提示词标签。** `prompts` 区段照常扫描与提交，但不再注册 `conversation.view`；agent 相关技术标签的提示词二级标签是它唯一的呈现。五个标签注册（order 20–60）。提示词标签的 locale 键、注册条目与测试一并删除；包 README、bundle patch 注释与 develop-mode 笔记改为五个标签。
- **agent 相关技术区段固定其二级标签行。** 区段根节点是从不滚动的 flex 列，每个二级标签的主体都是根节点携带 `data-conversation-composer-overlay` 的树形浏览器；清单/技能/MCP 行保持原位，窗格内容在其下滚动，且每个滚动区预留悬浮输入框座位的高度。
- **技术栈、组件与 agent 相关技术清单面渲染左树右详情的浏览器。** `tree.ts` 承载纯派生（技术栈：运行时、清单、按清单类别的依赖、按语言的源文件；组件：按父目录逐组；agent 相关技术清单：按 schema 固定 kind 顺序逐文件角色成组，附加承载引用工具名的工具根）；`TreeExplorer.tsx` 渲染树与选中节点经 `ui-primitives` 的 shiki 高亮 `CodeBlock` 呈现的 JSON 载荷。默认选中第一个叶子并展开其祖先，点击行即选中（组行同时展开子树），点击箭头只切换展开，重扫描削掉的选中回退到第一个叶子。
- **agent 相关技术的 markdown 集合渲染同一浏览器。** `deriveMarkdownRowsTree` 把每个集合的文档（技能、MCP、提示词）按目录分组、以行名作叶子标签；`TreeExplorer` 新增的 `renderLeafDetail` 接缝把右窗格换成选中文档的路径与 markdown（经 `MarkdownText`，围栏代码块带 shiki 高亮），组行保持 JSON 载荷。文档标签栏不复存在：目录树就是集合的导航。
- **列表选中聚焦画布。** `TopologyGraph` 渲染选中节点的高亮，并经 React Flow 的 `setCenter` 在 320 ms 过渡里把视口居中到选中节点的布局位置、缩放取 `max(当前缩放, 1)`；触及选中节点的每条边取品牌色描边与动画虚线（`flow-overrides.css` 的 `.topologyEdgeSelected`）。清除选中重新适配整个图。聚焦位于 `TopologyGraph` 内部，因为只有它持有视口 API；`GraphBody` 只是继续传递 `selectedNodeId`。
- **非内容框架态与应用其它加载呈现一致地居中。** 不渲染区段的四个线上状态（loading、stale、none、error）共享一个 `Frame` 组件：铺满标签区域的居中块，忙碌状态（host 仍在扫描）带共享的描边弧旋转指示与礼貌的 live region，未扫描与不可读为纯居中文案。此前的框架态渲染为左上角纯文本。

## 备选方案

- **删除 agent 相关技术的提示词二级标签、保留提示词标签**——否决：用户要求删除独立的提示词标签，理由是 agent 相关技术标签已展示该信息；二级标签是更丰富的分组呈现。
- **给二级标签行用 `position: sticky`**——否决：该区段位于悬浮输入框之下的页面级滚动区里；composer overlay 属性是既定机制，让区段持有自己的滚动区并预留输入框净空，一次固定两级标签。
- **保留扁平清单列表、只改排版**——否决：既不回应明确的左树右内容诉求，层级（类别、语言、目录、文件角色）本就隐含在数据里。
- **markdown 集合保留文档标签栏**——否决：标签栏在文档超过几个后不可扩展且无分组；目录树复用清单面已在渲染的浏览器，选中文档的 markdown 保留围栏代码块高亮。
- **用 React Flow 的 `fitView({ nodes: [id] })` 聚焦**——否决：对节点布局中心 `setCenter` 且取 `max(当前缩放, 1)` 保留用户选择的阅读缩放并确定性居中；单节点 `fitView` 的重缩放与 padding 语义与「提升到聚焦缩放」的意图相悖。
- **由 `GraphBody` 派发聚焦**——否决：`GraphBody` 将同时需要布局位置与 React Flow 实例；`TopologyGraph` 已持有两者，selection prop 是唯一新增接缝。

## 结果

- 五个 conversation-view 注册；提示词数据照常扫描、提交并在 agent 相关技术标签内渲染——无 schema、线上协议或磁盘变更，既有项目无需重扫。
- xyflow 笔记的「列表选中从不平移」已知局限解除；选中现在居中、缩放并高亮关联边，清除选中恢复整图适配。
- 清单与组的详情窗格此时把已提交行渲染为高亮 JSON——后来 documents 集合使文件与工具叶子获得内容渲染（[[2026-08-26-insight-agent-tech-documents]]）；组行保持 JSON 载荷。
- 技术栈与组件标签、agent 相关技术二级标签、依赖画布全部加入 composer overlay，因此每个洞察标签都持有自己的滚动，不依赖页面级滚动区。
- 覆盖：`tree.client.spec.ts`（派生，含 agent 相关技术清单与 markdown 集合树）、`tree-explorer.client.spec.tsx`（选中、展开、回退、overlay、叶子主体）、`frame.client.spec.tsx`（忙碌/静态框架态拆分）、`TopologyGraph` 聚焦与边高亮测试，以及更新的 `graph-body`/`agent-tech-tabs` 测试；提示词标签的测试随标签删除。
