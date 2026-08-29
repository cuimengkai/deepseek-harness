/**
 * Project a persisted connector onto `dsh-mcp-client` Config.
 * @module @deepseek-ai/dsh-connector-registry/mcp-config
 */

import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type { ConnectorEntry } from './types.ts'

/**
 * Build the mcp-client config for one enabled connector.
 * @param entry - the persisted card.
 * @param authorization - resolved Bearer token, when `authorizationRef` was set.
 * @returns mcp-client Config.
 */
export function toMcpClientConfig(entry: ConnectorEntry, authorization?: string): McpClientConfig {
  const headers: Record<string, string> = {}
  if (authorization !== undefined && authorization !== '') {
    headers.Authorization = authorization.startsWith('Bearer ') ? authorization : `Bearer ${authorization}`
  }
  if (entry.transport === 'streamable-http') {
    /* v8 ignore next -- persist already requires url for this transport */
    if (entry.url === undefined) throw new Error(`connector "${entry.id}" is missing url`)
    return {
      transport: 'streamable-http',
      serverName: entry.serverName,
      url: entry.url,
      headers,
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
  }
  /* v8 ignore next -- persist already requires command for stdio */
  if (entry.command === undefined) throw new Error(`connector "${entry.id}" is missing command`)
  return {
    transport: 'stdio',
    serverName: entry.serverName,
    command: entry.command,
    args: entry.args === undefined ? [] : [...entry.args],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}
