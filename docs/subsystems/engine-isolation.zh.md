# 引擎隔离

[English](engine-isolation.md) | 中文

引擎驱动接缝：当工作区的隔离记录要求物理隔离时，把该工作区的 agent 运行交给一个专用子引擎进程；否则在当前进程内运行。该接缝实现了[产品架构](../platform-architecture.zh.md)决策 D3 预留的适配层接口 `DriveAgentRun` / `ListSessions` / `ReadLog`；[隔离机制规格](../platform-engine-isolation.zh.md)负责进程外协议。持久接缝契约在 [`packages/experimental/engine-isolation/src/types.ts`](../../packages/experimental/engine-isolation/src/types.ts)；控制面隔离记录在 [platform-shell](platform-shell.zh.md)。

## 隔离记录

工作区是隔离单元（架构 D2）；物理隔离按工作区可选。平台控制面把该决策保存在工作区的隔离记录（`workspaces.isolated`）里，由 `platformShell.setWorkspaceIsolation` 在 `platform.isolation` 权限下翻转，由 `platformShell.workspaceIsolation` 探读。隔离翻转在控制面审计；运行了隔离驱动的那台引擎把持久化的 `platform/workspace/isolated` 会话事件作为该翻转的按会话投影发出。

## 驱动接缝

`EngineDriver` 是预留的适配层接口：`drive` 在某个工作区的引擎里运行一次 agent 运行，`listSessions` 枚举该引擎持久持有的会话，`readLog` 读回某会话的持久事件日志。`RunHandle` 报告是哪台引擎进程跑了这次驱动、数据提交到了哪里。

```ts
import type { AgentRunRequest, RunHandle } from '@deepseek-ai/dsh-experimental-engine-isolation'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell'

interface EngineDriver {
  readonly kind: 'in-process' | 'process-out'
  drive(request: AgentRunRequest): Promise<RunHandle>
  listSessions(workspaceId: WorkspaceId): Promise<readonly SessionId[]>
  readLog(sessionId: SessionId): Promise<readonly SessionEvent[]>
}
```

## 引擎类型

- **进程内（in-process）** —— 当前进程通过调用方提供的 runner 运行驱动。共享工作区使用这台引擎；handle 的 pid 是当前进程。
- **进程外（process-out）** —— 一个专用子引擎进程运行驱动。隔离工作区使用这台引擎；子进程的 store 与 JSONL 日志位于配置的 scratch 根目录下各自的按工作区目录，因此隔离在进程与数据层面都是物理的。

## 路由

`ctx.engineIsolation.driver(workspaceId)` 读取 `ctx.platformShell.workspaceIsolation(workspaceId)`：隔离工作区路由到进程外引擎，共享工作区路由到进程内引擎。未知工作区响亮失败——路由永不静默。

## 进程外协议

进程外驱动通过 `ctx.subprocess` 派生子引擎进程，把驱动 JSON 写在 stdin 上，把 store/日志根目录放在命令行参数里。子进程在它的按工作区 store 路径上引导 platform-shell 装配，播种隔离世界，运行驱动，持久化会话日志，然后在退出前在 stdout 上打印一行 JSON 结果（`ok`、`sessionId`、`pid`、`storePath`、`logRoot`）。会话持久化是基于文件且与进程无关的，因此父进程的 `readLog` 与 `listSessions` 直接读子进程的持久 JSONL 日志——用现有原语实现了 `DriveAgentRun` / `ListSessions` / `ReadLog` 接缝。

## 已知限制

进程外是进程级委托，不是安全边界：子进程与宿主机共享机器、内核与文件系统访问策略。容器或虚拟机隔离是在同一接缝上的后端替换（e2b 家族是远程 VM 后端），暂缓实现。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxengineisolation--engineisolationservice"></a>

### `ctx.engineIsolation` — `EngineIsolationService`

The engine-isolation service. Register via `ctx.plugin(EngineIsolationService, config)`; the service is injected as `ctx.engineIsolation`. Requires the platformShell control-plane service, whose isolation record routes each workspace to its engine.

```ts cordis-catalog
/**
 * Resolve the engine driver one workspace's runs use.
 * @param workspaceId - the workspace to route.
 * @returns the process-out driver for an isolated workspace, the in-process
 * driver for a shared one.
 * @throws the platform store's UNKNOWN_WORKSPACE when the workspace does not exist.
 */
driver(workspaceId: WorkspaceId): EngineDriver

/**
 * Drive one agent run in the workspace's engine (routed by isolation).
 * @param request - the run to execute.
 * @returns the durable outcome handle.
 */
async drive(request: AgentRunRequest): Promise<RunHandle>

/**
 * List the sessions one workspace's engine holds durably.
 * @param workspaceId - the workspace whose engine to ask.
 * @returns the engine's durable session ids for that workspace.
 */
async listSessions(workspaceId: WorkspaceId): Promise<readonly SessionId[]>

/**
 * Read one session's durable log from the workspace engine that owns it.
 * A session id alone does not name its workspace, so the process-out engine
 * is asked first (isolated sessions live in its per-workspace roots) and the
 * in-process engine only when the process-out roots hold no such session.
 * @param sessionId - the session to read.
 * @returns the committed events, or an empty list when the session is absent
 * from both engines.
 */
async readLog(sessionId: SessionId): Promise<readonly SessionEvent[]>
```

Types: [SessionEvent](session.zh.md) · [SessionId](core.zh.md) · [WorkspaceId](workspace.zh.md)

Source: [`packages/experimental/engine-isolation/src/service.ts`](../../packages/experimental/engine-isolation/src/service.ts)
<!-- END GENERATED cordis-surface -->
