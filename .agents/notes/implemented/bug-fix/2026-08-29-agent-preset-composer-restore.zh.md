# Agent Note: 合并 master 后恢复 Agent 预设画布组装器

Status: implemented

[English](2026-08-29-agent-preset-composer-restore.md) | 中文

## 问题

合并 master 的和解删除了 Agent 预设组装管线：宿主包的 `AgentPresets` 服务失去 `readGraph`/`saveGraph`，`conversion.ts`（图↔行投影）被整体删除，`FlowAgentComposition` 失去图字段，九个客户端文件（画布组装器、节点检查器、模型类型选择器、面板、preset-graph 辅助）被删，而 section 保留的精简 state 不再携带 `composer`、`view.graph`、`palette`、`modelCatalog`。页面只剩花名册卡片，没有任何创建预设的入口；`packages/bundle/web-app/cordis.patch.yml` 仍挂着 `ui-flow-editor` 行——它唯一的存在目的就是为组装器供模块字节，如今空转。

## 决策

按合并后的架构恢复整条管线，而非移植旧实现。宿主端：`readGraph(agentPreset)` 与 `saveGraph(agentPreset, graph, name?, description?, overwrite?)` 走 Typert `@Remote` 面返回；`conversion.ts` 投影 `graphToRows`/`rowsToGraph`；`ComposeRow` 与 `FlowAgentComposition` 携带 `JsonValue`（非 `unknown`），Typert 生成器才接受跨线数据。客户端：`AgentPresetSectionController` 基于位置参数的 `ClientRemote` 组合（`remote.agentPresets.readGraph`、选择器目录走 `remote.session.modelCatalog`、面板走 `remote.pluginInventory`），section 重新拥有组装器与只读设计页分支，`AgentPresetComposer` 通过 `dsh.client.external` 请求 `@deepseek-ai/dsh-client-ui-flow-editor/client`——即分支 bundle 行存在的目的所在的模块表请求。

## 验证

`packages/preset/agent-presets`：170 个测试通过；`packages/client/ui-agent-preset`：223 个测试通过（恢复的 section spec 以 mock 的 `FlowCanvas` 断言设计页、组装器手势、模型类型路由）；`tsc -b`、`oxlint`、客户端 bundle 构建通过。`verify-client-packages`、`verify-cordis-config`、`verify-optional-dependency-imports` 与改动前的树一样红（11 个基线违规都在本次改动未触碰的包里）；本次新增的唯一违规是组装器的模块表请求，2026-08-23 的跨包值依赖政策对 feature 包禁止它——见后果。

## 后果

- 拖拽组装、带模型类型路由的节点检查器、内置预设只读设计页、Creator 模式交接，在 设置 → Agent 重新可用。
- 组装器是 feature 包中仅存的 `dsh.client.external` 请求。master 的政策要求这类共享走 Cordis 服务；分支的设计是把共享画布作为组件供应行走模块表。解决该冲突（为 `FlowCanvas` 建服务面，或为组件供应行开政策豁免）是本次恢复刻意留待后续的开口。
- `dsh-flow` 现在为 `JsonValue` 依赖 `dsh-session`；跨线的图类型数据是 JSON，不再是 `unknown`。
