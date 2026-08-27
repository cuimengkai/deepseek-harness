# Agent Note: 共享 documents 内容池服务所有洞察标签的文件视图，图节点卡片携带类型颜色

Status: implemented

[English](2026-08-26-insight-shared-documents-pool.md) | 中文

## Problem

v4 的 documents 集合（[[2026-08-26-insight-agent-tech-documents]]）只为 agent 相关技术清单提供内容视图。其余标签仍渲染选中行的元数据 JSON，两个依赖图完全没有内容视图——画布与悬浮列表只显示路径。用户要求 组件、技术栈、组件依赖、模块拓扑 以同样方式查看文件内容，并为画布增加两项表达：按文件类型区分节点样式，以及选中文件的清晰高亮。

## Decision

- **一个共享内容池，而非四个按标签的集合。** `ProjectInsightDoc.sections.documents`（`{ files, count }`）承载 `FileContentRow`（`{ name, path, content }`——原 `AgentTechMarkdownRow`，重命名后由 agent 相关技术集合复用）。`PROJECT_INSIGHT_FORMAT_VERSION` 从 4 升到 5；既有的 stale 读取自愈路径重建已提交文档，机制不变。上限是 schema 常量：`MAX_FILE_CONTENT_BYTES`（单文件 64 KiB）、`MAX_DOCUMENT_ROWS`（600 行）、`MAX_DOCUMENT_TOTAL`（总量 4 MiB），`MAX_DOC_BYTES` 升到 16 MiB 使存储的 documents 区段文件（总预算加 JSON 转义开销）始终通过逐文件读取守卫。纯路径排序加预算的选择在实践中太小：512 KiB 约一百个文件后耗尽，标签列出的文件退回元数据 JSON——提高预算并配合下述优先级恢复了文件视图。
- **内容池按标签的列出优先级嵌入。** `buildDocuments` 按各标签的列表排序候选——技术栈文件、清单、组件、agent 相关技术清单文件，再到其余模块拓扑源文件——并减去三个 markdown 集合已嵌入的路径（MCP 配置的脱敏渲染绝不被其原始源码遮蔽）。选择按该优先级在上限内进行（某个标签仍在列出的文件优先于路径序更早的未列出源文件）；输出行保持按路径排序。优先复用扫描已读过的内容，否则按上限有界读取。超过上限的文件被跳过并保持纯元数据；`count` 报告全部候选数，含未嵌入的。
- **所有标签经一对共享辅助函数解析文件内容。** `renderRowDetail` 在内容池携带该叶子的 `path` 时渲染其内容，否则渲染行元数据 JSON；`fileContentNode` 将 markdown 经 `MarkdownText` 渲染，其他文件经带语法提示的 `CodeBlock` 渲染。agent 相关技术清单把自身三个集合叠放在内容池之上解析，在客户端同样保持脱敏优先级。
- **图标签增加内容抽屉。** 悬浮完整列表移到画布左缘，选中文件的内容抽屉悬浮在右缘：选中列表行或画布节点即打开（内嵌内容，行 JSON 兜底）；关闭抽屉或点按背景即清除选中。边集为空的区段回退为完整行列表上的浏览器树，取代纯列表。
- **节点卡片携带文件类型颜色，而非徽章。** `TopologyNode` 以类别色（ts、js、组件、样式、其他——`fileType.ts`）给整张卡片着色——边框、文字与背景，选中节点获得最强呈现：品牌色边框、填充与 3px 高亮环。CSS 源序（类型、循环、悬停、选中）编码该优先级，无需选择器互相争抢。
- **语法覆盖随内容池扩展。** `dsh-client-ui-primitives` 的 shiki 惰性语法表加入 vue 与 svelte；扩展名→语言映射覆盖内容池现在嵌入的源码扩展名。

## Alternatives considered

- **把内容池留在 `agentTech` 内并按标签复制**——否决：四个集合、各自上限、四条解析路径；一个池即可用一份预算服务所有标签。
- **按需经 RPC 读取文件内容**——否决：为离线文档可有界承载的内容引入新的权限面与每次选择的往返（与 v4 note 同一结论）。
- **每个精确扩展名一个徽章或颜色**——否决：开放的颜色集合无法学习；五个封闭类别保持图例稳定，路径标签本身携带精确扩展名。
- **抽屉作为常驻右窗格**——否决：分栏布局缩小满铺画布并与平移/缩放冲突；悬浮覆盖层保留画布且点按背景即消失。
- **无边图回退沿用旧的纯列表**——否决：浏览器树是其他标签已建立的心智；第二套列表呈现不能回答树未回答的任何问题。

## Consequences

- `formatVersion` 5 使每个已提交文档失效一次；首次开发模式读取在后台重建它，read/stale 自愈测试固定该版本号。
- 文档与线上载荷随嵌入的源码与清单增长，上限为 600 行、总量 4 MiB；超出上限的行回退为元数据 JSON（客户端 README 的已知局限）。一次全新读取在本地线上移动数 MB 的 JSON——这是离线内容视图接受的成本；轮询仅在文档 stale 时进行。
- v4 note 的 `AgentTechSection.documents` 集合不复存在；其理由迁移到本 note，旧 note 交叉链接到这里。按类型布局（[[2026-08-24-insight-per-type-layout]]）增加了 `documents` 文件夹。
- 语法映射刻意比 agent 相关技术的配置集合更宽：内容池嵌入的任何缺少语法的源码扩展名都退化为纯 `CodeBlock` 渲染，而非错误。
- 覆盖：`scanner.spec.ts`（池内容、集合去重、上限回退、候选计数，以及字节预算受限时按列出优先级的胜出者）、`fingerprint.spec.ts`/`service.spec.ts`/`tool.spec.ts`（版本 5）、`graph-body.client.spec.tsx`（抽屉开关、内容池与 JSON 回退、树回退）、`agent-tech-tabs.client.spec.tsx`（内容池叠放）、`inventory-tabs.client.spec.tsx`（技术栈与组件的内容渲染及回退）、`topology-graph.client.spec.tsx`（类型着色卡片）、apiproxy spec fixture、connection fixture 的样例行、demo e2e 的 documents 断言。
