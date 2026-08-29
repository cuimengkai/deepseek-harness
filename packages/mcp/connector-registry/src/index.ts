/**
 * Connector registry: persists generic MCP-server cards and mounts
 * `dsh-mcp-client` for each enabled entry. No vendor OAuth store.
 * @module @deepseek-ai/dsh-connector-registry
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { default as Credentials } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { toMcpClientConfig } from './mcp-config.ts'
import {
  deleteConnectorFile,
  idFromName,
  listConnectorFiles,
  serverNameFromName,
  writeConnectorFile,
} from './persist.ts'
import type {
  AddHttpConnectorRequest,
  AddStdioConnectorRequest,
  ConnectorEntry,
  ConnectorId,
  ConnectorSnapshot,
  ConnectorStatus,
} from './types.ts'

export type {
  AddHttpConnectorRequest,
  AddStdioConnectorRequest,
  ConnectorEntry,
  ConnectorSnapshot,
  ConnectorStatus,
  ConnectorTransport,
} from './types.ts'
export { CONNECTOR_FORMAT_VERSION, ConnectorId } from './types.ts'
export { CONNECTOR_ID_PATTERN, SERVER_NAME_PATTERN, idFromName, serverNameFromName } from './persist.ts'
export { toMcpClientConfig } from './mcp-config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    connectors: ConnectorRegistry
  }
}

/** Deployment-tunable registry root and whether enabled cards mount mcp-client. */
export interface Config {
  /** Directory that holds `<id>.json` documents. */
  readonly root: string
  /**
   * When true, each enabled card mounts a `dsh-mcp-client` instance. A
   * persist-only composition (tests, a Host that does not expose tools)
   * sets this false.
   */
  readonly mountClients: boolean
}

/** Live mount bookkeeping for one enabled card. */
interface MountState {
  dispose?: () => void
  status: ConnectorStatus
  error?: string
}

/**
 * File-backed MCP connector roster. `list` / `addHttp` / `addStdio` /
 * `setEnabled` / `remove` are the Remote surface.
 */
export class ConnectorRegistry extends TypertRemoteService {
  static inject = []

  static Config = z.object({
    root: z.string().default(dshHomePath('connectors')),
    mountClients: z.boolean().default(true),
  }) as unknown as z<Config>

  private readonly entries = new Map<string, ConnectorEntry>()
  private readonly mounts = new Map<string, MountState>()
  private credentials: Credentials | undefined
  private ready: Promise<void>

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'connectors')
    ctx.inject(['credentials'], (scope) => {
      this.credentials = scope.credentials
      scope.effect(() => () => {
        this.credentials = undefined
      }, 'connectors.credentials()')
    })
    this.ready = this.hydrate()
    ctx.effect(() => () => {
      for (const state of this.mounts.values()) state.dispose?.()
      this.mounts.clear()
    }, 'connectors.mounts')
  }

  /**
   * List every persisted card with its live mount status.
   * @returns snapshots, id order.
   */
  @Remote('list')
  async list(): Promise<readonly ConnectorSnapshot[]> {
    await this.ready
    return [...this.entries.values()].map(entry => this.snapshot(entry))
  }

  /**
   * Persist a Streamable HTTP connector (add-by-MCP-URL).
   * @param request - display name, URL, optional serverName / credential ref.
   * @returns the new snapshot.
   */
  @Remote('addHttp')
  async addHttp(request: AddHttpConnectorRequest): Promise<ConnectorSnapshot> {
    await this.ready
    if (request.name.trim() === '') throw new Error('connector name is required')
    if (request.url.trim() === '') throw new Error('connector url is required')
    const taken = new Set(this.entries.keys())
    const serverNames = new Set([...this.entries.values()].map(entry => entry.serverName))
    const entry: ConnectorEntry = {
      id: idFromName(request.name, taken),
      name: request.name.trim(),
      enabled: request.enabled ?? true,
      serverName: request.serverName === undefined || request.serverName === ''
        ? serverNameFromName(request.name, serverNames)
        : request.serverName,
      transport: 'streamable-http',
      url: request.url.trim(),
      ...request.authorizationRef === undefined || request.authorizationRef === ''
        ? {}
        : { authorizationRef: request.authorizationRef },
      updatedAt: Date.now(),
    }
    return this.put(entry)
  }

  /**
   * Persist a stdio MCP connector.
   * @param request - display name, command, optional args / serverName.
   * @returns the new snapshot.
   */
  @Remote('addStdio')
  async addStdio(request: AddStdioConnectorRequest): Promise<ConnectorSnapshot> {
    await this.ready
    if (request.name.trim() === '') throw new Error('connector name is required')
    if (request.command.trim() === '') throw new Error('connector command is required')
    const taken = new Set(this.entries.keys())
    const serverNames = new Set([...this.entries.values()].map(entry => entry.serverName))
    const entry: ConnectorEntry = {
      id: idFromName(request.name, taken),
      name: request.name.trim(),
      enabled: request.enabled ?? true,
      serverName: request.serverName === undefined || request.serverName === ''
        ? serverNameFromName(request.name, serverNames)
        : request.serverName,
      transport: 'stdio',
      command: request.command.trim(),
      ...request.args === undefined ? {} : { args: request.args },
      updatedAt: Date.now(),
    }
    return this.put(entry)
  }

  /**
   * Enable or disable one card and remount when `mountClients` is on.
   * @param id - connector id.
   * @param enabled - the new flag.
   * @returns the updated snapshot.
   */
  @Remote('setEnabled')
  async setEnabled(id: ConnectorId, enabled: boolean): Promise<ConnectorSnapshot> {
    await this.ready
    const current = this.entries.get(id)
    if (current === undefined) throw new Error(`connector "${id}" is not saved`)
    return this.put({ ...current, enabled, updatedAt: Date.now() })
  }

  /**
   * Delete one card and dispose its mount.
   * @param id - connector id.
   */
  @Remote('remove')
  async remove(id: ConnectorId): Promise<void> {
    await this.ready
    this.unmount(id)
    this.entries.delete(id)
    await deleteConnectorFile(this.config.root, id)
  }

  private snapshot(entry: ConnectorEntry): ConnectorSnapshot {
    const mount = this.mounts.get(entry.id)
    if (!entry.enabled) return { ...entry, status: 'disabled' }
    /* v8 ignore next -- put/hydrate always syncMount an enabled card when mountClients is on */
    if (mount === undefined) return { ...entry, status: this.config.mountClients ? 'error' : 'disabled' }
    return {
      ...entry,
      status: mount.status,
      ...mount.error === undefined ? {} : { error: mount.error },
    }
  }

  private async put(entry: ConnectorEntry): Promise<ConnectorSnapshot> {
    await writeConnectorFile(this.config.root, entry)
    this.entries.set(entry.id, entry)
    await this.syncMount(entry)
    return this.snapshot(entry)
  }

  private async hydrate(): Promise<void> {
    const loaded = await listConnectorFiles(this.config.root)
    for (const entry of loaded) this.entries.set(entry.id, entry)
    for (const entry of loaded) await this.syncMount(entry)
  }

  private async syncMount(entry: ConnectorEntry): Promise<void> {
    this.unmount(entry.id)
    if (!entry.enabled || !this.config.mountClients) return
    let authorization: string | undefined
    if (entry.authorizationRef !== undefined) {
      if (this.credentials === undefined) {
        this.mounts.set(entry.id, {
          status: 'error',
          error: `connector "${entry.id}" needs ctx.credentials to resolve authorizationRef`,
        })
        return
      }
      const resolved = await this.credentials.resolve(credentialRef(entry.authorizationRef))
      if (resolved === undefined || resolved.value === '') {
        this.mounts.set(entry.id, {
          status: 'error',
          error: `connector "${entry.id}" authorizationRef "${entry.authorizationRef}" is unset`,
        })
        return
      }
      authorization = resolved.value
    }
    try {
      const fork = this.ctx.plugin(mcpClient, toMcpClientConfig(entry, authorization))
      this.mounts.set(entry.id, {
        dispose: () => { void fork.dispose() },
        status: 'mounted',
      })
    } catch (error) {
      /* v8 ignore start -- ctx.plugin throws only when Config validation fails; persist already validated the card */
      this.mounts.set(entry.id, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      /* v8 ignore stop */
    }
  }

  private unmount(id: string): void {
    const current = this.mounts.get(id)
    current?.dispose?.()
    this.mounts.delete(id)
  }
}

export default ConnectorRegistry
