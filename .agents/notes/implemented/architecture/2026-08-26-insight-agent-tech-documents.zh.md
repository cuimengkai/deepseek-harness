# Agent Note：agent 相关技术清单把每个列出文件的内容嵌入为 documents 集合

Status: implemented

[English](2026-08-26-insight-agent-tech-documents.md) | 中文

## 问题

树形浏览器改造（[[2026-08-26-insight-tabs-pinned-tree-focus]]）之后，agent 相关技术的清单二级标签在右窗格仍渲染所选文件的 `{ path, kind }` 元数据 JSON，而技能/MCP/提示词二级标签渲染其文档内容。用户对这一差异的回答是清单应展示文件的内容。三个 markdown 集合只为自己的行携带内容；清单的其余文件（工作流、编辑器与工具配置、被上限丢弃的笔记）只有元数据，工具叶子显示工具行而非其引用的文件。

## 决策

- **文档新增第四个内嵌集合**——后来被提升出 `agentTech`，成为服务所有标签的共享顶层 `documents` 区段（[[2026-08-26-insight-shared-documents-pool]]）。以 v4 落地的形态，`AgentTechSection.documents` 复用 `AgentTechMarkdownRow`（`{ name, path, markdown }`）；`PROJECT_INSIGHT_FORMAT_VERSION` 从 3 升到 4，已有项目提交的文档读取为 `stale` 并经既有的去抖后台重建自愈。行数与总字节上限是 schema 常量；单文件读取复用 `MAX_AGENT_TECH_MARKDOWN_BYTES`。
- **扫描器为三个集合尚未携带的每个清单文件嵌入内容。** `buildAgentTechDocuments` 跳过 skills/mcp/prompts 中已有的路径（因此 MCP 配置绝不会绕过其集合的 env 脱敏），对其余已输出文件做有界读取，超出单文件上限或专属字节预算的文件被丢弃——它保持纯元数据，绝不阻塞后续更小的文件，且预算不与 markdown 集合共享，配置文件不会挤占技能/提示词的嵌入。行按路径排序。
- **线上协议镜像 schema。** `agentTechSectionSchema` 增加 `documents`；文档字面量移到 `z.literal(4)`。
- **清单叶子渲染内容而非元数据。** `AgentTechInventory` 按路径索引全部四个集合并传入 `renderLeafDetail`，把选中的行——文件或工具——经该索引解析：markdown 扩展名经 `MarkdownText` 渲染；yml/yaml/json/jsonc/toml/ini 经 `CodeBlock` 以对应语法提示渲染；其他扩展名经 `CodeBlock` 纯文本渲染；无内嵌内容的行回退为其元数据 JSON。组行保持 JSON 载荷。

## 备选方案

- **共享 markdown 集合的字节预算**——拒绝：工作流与配置文件会与技能/提示词争夺同一上限；documents 专属预算保持 v3 嵌入不变。
- **重新嵌入包括三个集合在内的每个文件**——拒绝：存储重复，且逐字重嵌 MCP 配置会绕过其集合应用的 `env` 脱敏。
- **经 RPC 按需读取文件内容**——拒绝：为离线文档已有界携带的内容引入新的权限面与逐次选择往返；内嵌集合的先例已经回答了查看问题。
- **完整的扩展名→语法映射**——拒绝：清单的非 markdown 文件是一小组封闭的配置格式；未知扩展名降级为 `CodeBlock` 纯文本渲染。

## 后果

- `formatVersion` 4 使每个已提交文档失效一次；首次开发模式读取在后台重建它，e2e 的持久化文档断言钉住新集合。
- 文档增长所嵌入的清单内容，总量有界于 100 行与 256 KiB；超出上限的文件在清单渲染元数据 JSON（客户端 README 的已知局限）。
- 三个集合之外的文件逐字嵌入——只有 MCP 配置保持 `env` 脱敏，与 v3 相同，因为脱敏住在 mcp 集合里而 `documents` 排除那些路径。
- 覆盖：`scanner.spec.ts`（嵌入、三集合排除、上限回退）、`fingerprint.spec.ts`/`service.spec.ts`/`tool.spec.ts`（版本 4 与自愈）、`agent-tech-tabs.client.spec.tsx`（markdown 渲染、语法提示源码、工具叶子解析、元数据回退）、apiproxy spec fixture，以及 project-insight-demo e2e 的 documents 断言；connection fixture 提供一行样例。
