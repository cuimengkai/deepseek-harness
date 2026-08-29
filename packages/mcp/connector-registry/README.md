---
description: "File-backed registry of generic MCP-server connectors; mounts dsh-mcp-client for each enabled card."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-registry

English | [中文](README.zh.md)

`ctx.connectors` persists generic MCP-server cards (Streamable HTTP URL or stdio command) under `$DSH_HOME/connectors/<id>.json` and, when `mountClients` is true, mounts one `dsh-mcp-client` instance per enabled card. There is no vendor OAuth store and no Tencent-specific integration cards.

## Service

`list()`, `addHttp({ name, url, serverName?, authorizationRef?, enabled? })`, `addStdio({ name, command, args?, serverName?, enabled? })`, `setEnabled(id, enabled)`, and `remove(id)` are the Remote surface. `authorizationRef` is a `ctx.credentials` reference resolved at mount into `Authorization: Bearer <value>`; the document stores the reference, never the secret. `failOnStartupError` is false on every mount so a dead URL does not fail Host load.

## Config

`root` (default `$DSH_HOME/connectors`) is the document directory. `mountClients` (default true) mounts `dsh-mcp-client` for enabled cards; a persist-only composition sets it false.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-mcp-client`: enabled cards publish that server's tools under `mcp__<serverName>__<rawName>`. This registry exposes no model-facing tool of its own.

#### KV Cache effect

None of its own; adding or removing a mounted server changes the tool list the next request sees.

## Known Limitations and Deferred Work

- **No wake of a closed MCP server marketplace** — cards are user-added MCP URLs or stdio commands, not a catalog of vendor OAuth apps.
- **Mount is process-local** — status is `mounted` after `ctx.plugin` returns; a later transport drop is `dsh-mcp-client`'s reconnect, not a registry rescan.
- **Stdio env is empty** — extra child env stays a later field; pass secrets through `authorizationRef` on HTTP or the ambient process env for stdio.
