# @deepseek-ai/dsh-experimental-engine-isolation

[English](README.md) | 中文

D3 引擎驱动接缝:当某个工作区的隔离记录要求物理隔离时,把该工作区的 agent 运行交给一个专用子引擎进程;否则在当前进程内运行。服务以 `ctx.engineIsolation` 注入,依据 [platform-shell 控制面](../../../packages/experimental/platform-shell/README.zh.md) 持有的隔离记录路由。[engine-isolation 子系统目录](../../../docs/subsystems/engine-isolation.zh.md)、[隔离机制规格](../../../docs/platform-engine-isolation.zh.md) 与 [无密钥 demo](../../../examples/engine-isolation-demo/README.zh.md) 记录该接缝、协议与证明。

## 配置

服务以编程方式挂载(绝不由 `cordis.yml` 挂载):进程内 runner 闭包与进程外子进程事实都由宿主机提供。

```ts
import { EngineIsolationService, type AgentRunRequest } from '@deepseek-ai/dsh-experimental-engine-isolation'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare const runInProcess: (request: AgentRunRequest) => Promise<void>
declare const readInProcessLog: (sessionId: SessionId) => Promise<readonly SessionEvent[]>
declare const listInProcessSessions: () => Promise<readonly SessionId[]>

ctx.plugin(EngineIsolationService, {
  inProcess: {
    run: (request) => runInProcess(request),
    storePath: './.platform-shell.sqlite',
    logRoot: './logs',
    readLog: readInProcessLog,
    listSessions: listInProcessSessions,
  },
  processOut: {
    workerScript: './src/worker.ts',
    storeRoot: './.storages/isolated',
    logRoot: './logs/isolated',
    cwd: process.cwd(),
    graceMs: 5000,
    nodeArgs: ['--import', 'tsx/esm'],
  },
})
```

`inProcess` 携带共享工作区的 runner 与其 store/日志事实;`processOut` 携带子 worker 脚本、按工作区 scratch 根目录与派生事实。`nodeArgs` 位于 worker 脚本之前,因此 TypeScript 源码 worker 传 `['--import', 'tsx/esm']`。

## 驱动接缝

`EngineDriver` 是预留的适配层接口(`drive`、`listSessions`、`readLog`)。`drive` 在某个工作区的引擎里运行一次 agent 运行,返回一个 `RunHandle`,指明是哪台进程跑的、数据提交到了哪里;`listSessions` 与 `readLog` 读回持久会话世界,因此调用方无需知道是哪台引擎跑的就能定位这次运行。

## 引擎类型

- **进程内(in-process)** —— 当前进程通过调用方提供的 runner 运行驱动。共享工作区使用这台引擎;handle 的 pid 是当前进程。
- **进程外(process-out)** —— 一个专用子引擎进程运行驱动。隔离工作区使用这台引擎;子进程的 store 与 JSONL 日志位于配置的 scratch 根目录下各自的按工作区目录。

## 路由

`ctx.engineIsolation.driver(workspaceId)` 读取 `ctx.platformShell.workspaceIsolation(workspaceId)`:隔离工作区路由到进程外引擎,共享工作区路由到进程内引擎。未知工作区响亮失败——路由永不静默。

## 进程外协议

进程外驱动通过 `ctx.subprocess` 派生子进程,把驱动 JSON 写在 stdin 上,把 store/日志根目录放在命令行参数里。子进程在它的按工作区 store 路径上引导 platform-shell 装配,播种隔离世界,运行驱动,持久化会话日志,然后在退出前在 stdout 上打印一行 JSON 结果。父进程读取结果行;非零退出或缺行都会以 `ENGINE_SPAWN_FAILED` 响亮地失败这次驱动。会话持久化是基于文件且与进程无关的,因此父进程的 `readLog` 与 `listSessions` 直接读子进程的持久 JSONL 日志。

## 会话事件

运行了隔离驱动的那台引擎发出持久化的 `platform/workspace/isolated` 会话事件,作为控制面隔离翻转的按会话投影。该事件仅进日志,不携带模型 token。

## Model Experience

间接地,经由被驱动的 agent:进程内 runner 与进程外子引擎拥有这次驱动暴露出的所有模型面注册。

#### KV Cache 影响

引擎接缝不追加任何提示词或请求 token;被驱动的 agent 的插件拥有全部模型可见新增,而驱动追加的会话日志让已可复用的前缀在轮次内保持可复用。

## 已知限制与待办

- **进程外是进程级委托,不是安全边界** —— 子引擎与宿主机共享机器、内核与文件系统访问策略;容器或虚拟机隔离是在同一接缝上的后端替换(e2b 家族是远程 VM 后端),暂缓实现。
- **隔离按工作区,不按请求** —— 标志位于工作区记录上,通过服务翻转;没有模型面工具能在会话中途翻转它。
- **进程内 runner 是宿主机义务** —— 接缝拥有驱动与路由,不拥有装配;runner 闭包与子 worker 由挂载宿主机提供。
- **进程外需要 scratch 根目录与 worker 已配置** —— 配置错误的 `workerScript` 或 scratch 根目录会响亮地失败这次驱动(`ENGINE_SPAWN_FAILED`),绝不静默。
