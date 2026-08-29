# Agent Note：WorkBuddy 项目包

Status: implemented

[English](2026-08-30-project-bundle.md) | 中文

## 问题

「项目」入口只列出宿主工作区。WorkBuddy 项目是共享包：名称、全局指令、连接器 id、专家预设、技能路径，以及作为工作区的 `sharedRoot`。把工作区行当成那个包会藏起额外字段，并编造产品并不运行的多人托管。

## 决定

1. **`@deepseek-ai/dsh-project-bundle`**（`ctx.projectBundles`）把卡片持久化到 `$DSH_HOME/projects/<id>.json`。Remote：`list` / `create` / `update` / `remove` / `prepareStart`。
2. **`prepareStart(id)`** 在存在 `ctx.connectors` 时启用列出的连接器并返回该包。客户端用 `cwd = sharedRoot` 创建会话，并在存在时把第一个 `expertPresetIds` 条目当作 `agentPreset`。
3. **项目页** 创建并启动包，同时仍把本机工作区列为 `sharedRoot` 选择器。这不是托管多人云端。

## 考虑过的替代方案

- **工作区行就是项目** — 已拒绝：工作区没有指令、连接器名单或专家名单。
- **自动挂载每条技能路径与额外专家** — 暂缓：v1 启用连接器并返回第一个专家 id；其余路径留在卡片上。

## 后果

- 技能与额外专家只列出，本包不挂载。
- 启动包不会把会话挂到工作区实体上，除非 `sharedRoot` 已经是一个工作区。

## 测试

无密钥：`packages/preset/project-bundle/tests/service.spec.ts`（创建/更新/准备/删除、磁盘重载）。`packages/client/ui-workspace/tests/projects-page.client.spec.tsx` 在工作区旁渲染包表单。
