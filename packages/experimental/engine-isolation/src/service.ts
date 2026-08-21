/**
 * Engine-isolation service: the D3 engine-driver facade mounted as
 * `ctx.engineIsolation`. It owns both candidate drivers (in-process for shared
 * workspaces, process-out for isolated ones) and routes every drive through the
 * isolation record the platform control-plane holds. Config is validated at
 * plugin load; the in-process closures are host-supplied, so this service is
 * always mounted programmatically (never from cordis.yml).
 * @module @deepseek-ai/dsh-experimental-engine-isolation/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell'
import { InProcessEngineDriver, type InProcessConfig } from './in-process.ts'
import { ProcessOutEngineDriver, type ProcessOutConfig } from './process-out.ts'
import { resolveEngineDriver, type DriverSet } from './router.ts'
import type { AgentRunRequest, EngineDriver, RunHandle } from './types.ts'

/** Configuration for the engine-isolation service. */
export interface EngineIsolationConfig {
  /** The in-process engine driver's runner and store/log facts. */
  readonly inProcess: InProcessConfig
  /** The process-out engine driver's child spawn and scratch-root facts. */
  readonly processOut: ProcessOutConfig
}

/**
 * The engine-isolation service.
 * Register via `ctx.plugin(EngineIsolationService, config)`; the service is
 * injected as `ctx.engineIsolation`. Requires the platformShell control-plane
 * service, whose isolation record routes each workspace to its engine.
 */
export class EngineIsolationService extends Service {
  static Config: z<EngineIsolationConfig> = z.object({
    inProcess: z.object({
      run: z.function(),
      storePath: z.string(),
      logRoot: z.string(),
      readLog: z.function(),
      listSessions: z.function(),
    }),
    processOut: z.object({
      workerScript: z.string(),
      storeRoot: z.string(),
      logRoot: z.string(),
      cwd: z.string(),
      graceMs: z.number().step(1).min(1),
      nodeArgs: z.array(z.string()),
    }),
  })

  /** The control-plane and subprocess services whose seams the drivers use. */
  static readonly inject = ['platformShell', 'subprocess']

  private readonly inProcessDriver: InProcessEngineDriver
  private readonly processOutDriver: ProcessOutEngineDriver

  /**
   * @param ctx - context carrying the platformShell control-plane service.
   * @param config - both candidate engine drivers' configuration.
   */
  constructor(
    ctx: Context,
    config: EngineIsolationConfig,
  ) {
    super(ctx, 'engineIsolation')
    this.inProcessDriver = new InProcessEngineDriver(config.inProcess)
    this.processOutDriver = new ProcessOutEngineDriver(ctx, config.processOut)
  }

  /** The candidate drivers, keyed for the isolation router. */
  private drivers(): DriverSet {
    return { inProcess: this.inProcessDriver, processOut: this.processOutDriver }
  }

  /**
   * Resolve the engine driver one workspace's runs use.
   * @param workspaceId - the workspace to route.
   * @returns the process-out driver for an isolated workspace, the in-process
   * driver for a shared one.
   * @throws the platform store's UNKNOWN_WORKSPACE when the workspace does not exist.
   */
  driver(workspaceId: WorkspaceId): EngineDriver {
    return resolveEngineDriver(this.ctx, this.drivers(), workspaceId)
  }

  /**
   * Drive one agent run in the workspace's engine (routed by isolation).
   * @param request - the run to execute.
   * @returns the durable outcome handle.
   */
  async drive(request: AgentRunRequest): Promise<RunHandle> {
    return this.driver(request.workspaceId).drive(request)
  }

  /**
   * List the sessions one workspace's engine holds durably.
   * @param workspaceId - the workspace whose engine to ask.
   * @returns the engine's durable session ids for that workspace.
   */
  async listSessions(workspaceId: WorkspaceId): Promise<readonly SessionId[]> {
    return this.driver(workspaceId).listSessions(workspaceId)
  }

  /**
   * Read one session's durable log from the workspace engine that owns it.
   * A session id alone does not name its workspace, so the process-out engine
   * is asked first (isolated sessions live in its per-workspace roots) and the
   * in-process engine only when the process-out roots hold no such session.
   * @param sessionId - the session to read.
   * @returns the committed events, or an empty list when the session is absent
   * from both engines.
   */
  async readLog(sessionId: SessionId): Promise<readonly SessionEvent[]> {
    const isolated = await this.processOutDriver.readLog(sessionId)
    return isolated.length > 0 ? isolated : this.inProcessDriver.readLog(sessionId)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    engineIsolation: EngineIsolationService
  }
}
