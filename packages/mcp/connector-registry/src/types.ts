/**
 * Connector-registry vocabulary: one persisted MCP-server card the Host
 * mounts through `dsh-mcp-client`. Types only — Client pages and the Host
 * service share this document.
 * @module @deepseek-ai/dsh-connector-registry/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one saved connector. Also the persisted file name (kebab-case). */
export type ConnectorId = Branded<'ConnectorId'>

/** Brand a string as a {@link ConnectorId}.
 * @param id - the raw id string.
 * @returns the same string, branded.
 */
export function ConnectorId(id: string): ConnectorId {
  return id as ConnectorId
}

/** On-disk document version; readers refuse any other. */
export const CONNECTOR_FORMAT_VERSION = 1

/** Transport the card records. */
export type ConnectorTransport = 'streamable-http' | 'stdio'

/** Live mount status the list surface shows. */
export type ConnectorStatus = 'disabled' | 'mounted' | 'error'

/** One persisted MCP-server connector. */
export interface ConnectorEntry {
  readonly id: ConnectorId
  readonly name: string
  readonly enabled: boolean
  readonly serverName: string
  readonly transport: ConnectorTransport
  /** Streamable HTTP endpoint. Required when `transport` is `streamable-http`. */
  readonly url?: string
  /** Stdio executable. Required when `transport` is `stdio`. */
  readonly command?: string
  readonly args?: readonly string[]
  /**
   * Optional credential-reference name resolved at mount into
   * `Authorization: Bearer <value>`. The document stores the reference, never
   * the secret.
   */
  readonly authorizationRef?: string
  readonly updatedAt: number
}

/** List row plus the live mount status. */
export interface ConnectorSnapshot extends ConnectorEntry {
  readonly status: ConnectorStatus
  readonly error?: string
}

/** What `addHttp` accepts. */
export interface AddHttpConnectorRequest {
  readonly name: string
  readonly url: string
  readonly serverName?: string
  readonly authorizationRef?: string
  readonly enabled?: boolean
}

/** What `addStdio` accepts. */
export interface AddStdioConnectorRequest {
  readonly name: string
  readonly command: string
  readonly args?: readonly string[]
  readonly serverName?: string
  readonly enabled?: boolean
}
