---
description: "通用 MCP 服务器连接器的文件登记表；为每张已启用卡片挂载 dsh-mcp-client。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-registry

[English](README.md) | 中文

`ctx.connectors` 把通用 MCP 服务器卡片（Streamable HTTP URL 或 stdio 命令）持久化到 `$DSH_HOME/connectors/<id>.json`，并在 `mountClients` 为 true 时为每张已启用卡片挂载一个 `dsh-mcp-client` 实例。没有厂商 OAuth 商店，也没有腾讯专用集成卡片。

## 服务

`list()`、`addHttp({ name, url, serverName?, authorizationRef?, enabled? })`、`addStdio({ name, command, args?, serverName?, enabled? })`、`setEnabled(id, enabled)` 与 `remove(id)` 是 Remote 面。`authorizationRef` 是在挂载时解析进 `Authorization: Bearer <value>` 的 `ctx.credentials` 引用；文档只存引用，不存密钥。每次挂载的 `failOnStartupError` 都为 false，因此失效 URL 不会让宿主加载失败。

## 配置

`root`（默认 `$DSH_HOME/connectors`）是文档目录。`mountClients`（默认 true）为已启用卡片挂载 `dsh-mcp-client`；仅持久化的组合把它设为 false。

## 模型体验

经由 `@deepseek-ai/dsh-mcp-client` 间接实现：已启用卡片以 `mcp__<serverName>__<rawName>` 发布该服务器的工具。本登记表自身不暴露面向模型的工具。

#### KV Cache 影响

自身没有；增加或移除已挂载服务器会改变下一次请求看到的工具列表。

## 已知限制与暂缓事项

- **不会唤醒已关闭的 MCP 服务器市场** — 卡片是用户添加的 MCP URL 或 stdio 命令，不是厂商 OAuth 应用目录。
- **挂载是进程内的** — `ctx.plugin` 返回后状态为 `mounted`；之后的传输断开由 `dsh-mcp-client` 重连，登记表不会重扫。
- **stdio 环境为空** — 额外子进程环境是后续字段；HTTP 密钥走 `authorizationRef`，stdio 密钥走环境进程环境。
