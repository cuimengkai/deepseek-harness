---
description: "持久化的项目包：名称、指令、连接器、专家预设、技能路径与 sharedRoot 工作区。"
kind: "package-reference"
---

# @deepseek-ai/dsh-project-bundle

[English](README.md) | 中文

`ctx.projectBundles` 把 WorkBuddy 式项目卡片——名称、全局指令、连接器 id、专家预设 id、技能路径与 `sharedRoot`——持久化到 `$DSH_HOME/projects/<id>.json`。`prepareStart(id)` 会启用列出的连接器（当存在 `ctx.connectors` 时）并返回该包，以便客户端用 `cwd = sharedRoot` 和第一个专家预设创建会话。

## 服务

`list()`、`create(draft)`、`update(id, draft)`、`remove(id)` 与 `prepareStart(id)` 是 Remote 面。`sharedRoot` 是工作区目录，不是整个产品概念。

## 配置

`root`（默认 `$DSH_HOME/projects`）是文档目录。

## 模型体验

间接实现：在项目中启动的会话使用该项目的 `sharedRoot`，并可能挂载其第一个专家预设。指令返回给客户端；它们不是面向模型的工具。

#### KV Cache 影响

自身没有。

## 已知限制与暂缓事项

- **技能与额外专家预设只列出，不自动挂载** — v1 启用连接器并返回第一个专家预设 id；其余技能路径留在卡片上由操作者绑定。
- **没有多人云端** — 该包是本地文档，不是托管项目空间。
