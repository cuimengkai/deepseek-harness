# 平台引擎隔离

[English](platform-engine-isolation.md) | 中文

> 伴随 [platform-architecture.zh.md](platform-architecture.zh.md)（D2、D3）：按需物理隔离与引擎进程外接缝。决策 D2 把工作区定为隔离单元，物理隔离可选；D3 预留了适配层驱动接口 `DriveAgentRun` / `ListSessions` / `ReadLog` 作为进程外实现。本规格定义驱动接缝、把每个工作区路由到其引擎的隔离记录、以及进程外协议，以 `examples/engine-isolation-demo/` 为基准。

## 1. 驱动接缝

`EngineDriver` 是预留的适配层接口。一次 `drive` 调用在某个工作区的引擎里运行一次 agent 运行；`listSessions` 枚举该引擎持久持有的会话；`readLog` 读回某会话的持久事件日志。

```ts
interface EngineDriver {
  readonly kind: 'in-process' | 'process-out'
  drive(request: AgentRunRequest): Promise<RunHandle>
  listSessions(workspaceId: WorkspaceId): Promise<readonly SessionId[]>
  readLog(sessionId: SessionId): Promise<readonly SessionEvent[]>
}
```

`RunHandle` 报告是哪台引擎进程跑了这次驱动（`pid`）、数据提交到了哪里（`storePath`、`logRoot`），因此调用方无需知道是哪台引擎跑的，就能定位这次运行的持久世界。

## 2. 隔离记录

工作区是隔离单元（D2）；物理隔离按工作区可选。平台控制面把该决策保存在工作区的隔离记录（`workspaces.isolated`）里：

- `createWorkspace(name, {isolated})` 在创建时接受该标志。
- `setWorkspaceIsolation(actor, workspaceId, isolated)` 在 `platform.isolation` 权限下翻转；翻转在控制面审计。
- `workspaceIsolation(workspaceId)` 为引擎接缝与不变量探读该记录。

运行了隔离驱动的那台引擎把持久化的 `platform/workspace/isolated` 会话事件作为翻转的按会话投影发出；控制面审计日志是权威记录。模型可见输入在会话日志中保持可重建（`Model-visible ⟺ logged`）。

## 3. 引擎类型

- **进程内（in-process）** —— 当前进程通过调用方提供的 runner 运行驱动。共享工作区使用这台引擎；handle 的 pid 是当前进程，数据提交到调用方自己的 store 与日志根目录。
- **进程外（process-out）** —— 一个专用子引擎进程运行驱动。隔离工作区使用这台引擎；子进程的 store 与 JSONL 日志位于配置的 scratch 根目录下各自的按工作区目录，因此隔离在进程与数据层面都是物理的。

## 4. 路由

`resolveEngineDriver` 读取隔离记录：隔离工作区路由到进程外引擎，共享工作区路由到进程内引擎。未知工作区响亮失败（`PlatformShellError` 的 `UNKNOWN_WORKSPACE`）——路由永不静默，因此工作区不可能在引擎间悄然漂移。

## 5. 进程外协议

进程外驱动通过 `ctx.subprocess`（清洗环境、进程树托管）派生子引擎进程，把驱动 JSON 写在 stdin 上，把 store/日志根目录放在命令行参数里：

```
node <workerScript> --store <storePath> --logroot <logRoot> --session <sessionId> --workspace <workspaceId>
```

子进程在它的按工作区 store 路径上引导 platform-shell 装配，播种隔离世界，运行驱动，持久化会话日志，然后在退出前在 stdout 上打印一行 JSON 结果：

| 字段 | 含义 |
|---|---|
| `ok` | 驱动是否完成 |
| `sessionId` | 子进程驱动的会话 |
| `pid` | 子引擎进程 id |
| `storePath` | 子进程提交到的按工作区 store |
| `logRoot` | 子进程追加到的按工作区 JSONL 根目录 |

会话持久化是基于文件且与进程无关的，因此父进程的 `readLog` 与 `listSessions` 直接读子进程的持久 JSONL 日志——用现有原语实现了 `DriveAgentRun` / `ListSessions` / `ReadLog` 接缝。子进程非零退出或缺少结果行都会让这次驱动响亮失败。

## 6. 验证

`examples/engine-isolation-demo/` 无密钥地证明该机制：demo 创建共享与隔离两个工作区，运行一次进程内驱动（共享）与一次进程外驱动（隔离），并断言按隔离记录路由、子进程 pid 与父进程不同、隔离 store 只含隔离工作区的行而共享 store 不含这些行、子进程会话日志可通过 `readLog` 重建——最后清理 scratch 根目录。
