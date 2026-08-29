# Agent Note: Generic MCP connector registry

Status: implemented

English | [中文](2026-08-30-connector-registry.zh.md)

## Problem

WorkBuddy's Integrations and Connectors destinations needed a Host roster of MCP servers a person can add by URL. The composition already had `dsh-mcp-client` as one-server-per-row config. There was no persisted card list, no enable/disable, and no add-by-URL Remote. Vendor marketplace cards would have invented OAuth apps the harness does not own.

## Decision

1. **`@deepseek-ai/dsh-connector-registry`** (`ctx.connectors`) persists generic MCP-server cards under `$DSH_HOME/connectors/<id>.json` (format version 1, mode 0600). Transport is Streamable HTTP URL or stdio command. `list` / `addHttp` / `addStdio` / `setEnabled` / `remove` are the Remote surface.
2. **Mount is `dsh-mcp-client`.** When `mountClients` is true (default), each enabled card mounts one instance with `failOnStartupError: false`, so a dead URL does not fail Host load. `authorizationRef` is a `ctx.credentials` name resolved at mount into `Authorization: Bearer <value>`; the document stores the reference, never the secret.
3. **Web UI is generic.** `/connectors` adds by MCP URL. The Agent hub Integrations tab lists the same roster and links to that page. There is no Tencent (or other vendor) OAuth store.

## Alternatives considered

- **Vendor marketplace cards** — rejected: the harness does not implement those OAuth apps; a fake catalog would lie about capability.
- **One `cordis.yml` row per server, edited by hand** — rejected: the Connectors page needs CRUD without rewriting the composition file.

## Consequences

- Status is process-local (`disabled` / `mounted` / `error`). A later transport drop is `dsh-mcp-client` reconnect, not a registry rescan.
- Stdio extra env is not a field; HTTP secrets go through `authorizationRef`.

## Testing

Keyless: `packages/mcp/connector-registry/tests/service.spec.ts` (persist, add-by-URL, stdio, enable after restart, `mountClients: false`). `packages/client/ui-agent-preset/tests/integrations.client.spec.tsx` lists a connector card and navigates to `/connectors`.
