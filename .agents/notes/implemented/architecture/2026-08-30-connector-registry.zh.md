# Agent Note：通用 MCP 连接器登记表

Status: implemented

[English](2026-08-30-connector-registry.md) | 中文

## 问题

WorkBuddy 的「集成」与「连接器」入口需要一份宿主侧 MCP 服务器名单，供人按 URL 添加。组合里已有作为「一行一台服务器」配置的 `dsh-mcp-client`。没有持久化卡片名单、没有启用/停用，也没有按 URL 添加的 Remote。厂商市场卡片会编造 harness 并不拥有的 OAuth 应用。

## 决定

1. **`@deepseek-ai/dsh-connector-registry`**（`ctx.connectors`）把通用 MCP 服务器卡片持久化到 `$DSH_HOME/connectors/<id>.json`（格式版本 1，权限 0600）。传输是 Streamable HTTP URL 或 stdio 命令。`list` / `addHttp` / `addStdio` / `setEnabled` / `remove` 是 Remote 面。
2. **挂载走 `dsh-mcp-client`。** `mountClients` 为 true（默认）时，每张已启用卡片挂载一个实例，且 `failOnStartupError` 为 false，因此失效 URL 不会让宿主加载失败。`authorizationRef` 是挂载时解析进 `Authorization: Bearer <value>` 的 `ctx.credentials` 名称；文档只存引用，不存密钥。
3. **Web UI 是通用的。** `/connectors` 按 MCP URL 添加。Agent 中枢的「集成」页列出同一份名单并链到该页。没有腾讯（或其他厂商）OAuth 商店。

## 考虑过的替代方案

- **厂商市场卡片** — 已拒绝：harness 不实现那些 OAuth 应用；假目录会谎报能力。
- **每人手改一行 `cordis.yml`** — 已拒绝：连接器页需要 CRUD，而不能改写组合文件。

## 后果

- 状态是进程内的（`disabled` / `mounted` / `error`）。之后的传输断开由 `dsh-mcp-client` 重连，登记表不会重扫。
- stdio 额外环境不是字段；HTTP 密钥走 `authorizationRef`。

## 测试

无密钥：`packages/mcp/connector-registry/tests/service.spec.ts`（持久化、按 URL 添加、stdio、重启后启用、`mountClients: false`）。`packages/client/ui-agent-preset/tests/integrations.client.spec.tsx` 列出连接器卡片并导航到 `/connectors`。
