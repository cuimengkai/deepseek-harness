# Agent Note: 把隔离工作区的驱动路由到专用子引擎进程

Status: implemented

[English](2026-08-22-engine-isolation.md) | 中文

## 问题

平台架构文档把工作区定为隔离单元、物理隔离可选(D2),并在接口处预留引擎进程外接缝——`DriveAgentRun` / `ListSessions` / `ReadLog` 作为驱动缝(D3)。该接缝预留但从未实现:今天所有 agent 运行都通过 `AgentFactory` 进程内进行,没有任何包拥有"工作区隔离诉求 → 运行其驱动的引擎"之间的路由。platform-shell 控制面拥有工作区记录,因此缺的是适配层引擎接缝。

## 决策

`packages/experimental/engine-isolation` 是私有仅源码实验性包,拥有 D3 驱动缝:`EngineDriver`(`drive` / `listSessions` / `readLog`)、进程内引擎(调用方提供的 runner)、进程外引擎(经 `ctx.subprocess` 派生的子引擎进程,store 与 JSONL 日志根按工作区)、以及读取 `ctx.platformShell.workspaceIsolation(workspaceId)` 的路由器。隔离记录本身在 platform-shell 控制面(schema v3 的 `workspaces.isolated`,由 `createWorkspace(name, {isolated})` 与 `setWorkspaceIsolation` 在 `platform.isolation` 权限下翻转);engine-isolation 是读取它的引擎接缝。`examples/engine-isolation-demo` 无密钥证明了按隔离记录路由、物理进程边界、store 分离与日志可重建性。

进程外子引擎在其按工作区 store 路径上引导 platform-shell 装配,播种隔离世界,运行一轮 mock 驱动的驱动,持久化会话日志,然后在退出前在 stdout 上打印一行 JSON 结果。会话持久化基于文件、与进程无关,所以父进程的 `readLog` 与 `listSessions` 直接读子进程的持久 JSONL。运行了隔离驱动的那台引擎发出仅日志的 `platform/workspace/isolated` 会话事件,作为控制面隔离翻转的按会话投影;该事件不携带模型 token。

进程外是进程级委托,不是安全边界:子引擎与宿主机共享机器、内核与文件系统访问策略。容器或虚拟机隔离是同一接缝上的后端替换(e2b 家族是远程 VM 后端),暂缓实现。隔离按工作区、不按请求:标志位于工作区记录上,经服务翻转,没有模型面工具能中途翻转它。

## 备选方案

**让所有工作区都走进程外。** 进程内让数据面可达、权限直插强制点,这正是 D3 的 MVP 理由;进程外成本更高、是升级形态,因此只作为隔离工作区的路径。

**按请求标志路由。** 隔离单元是工作区(D2);按请求标志会把一个工作区的 store 与审计故事拆散到多个进程。

**现在就上 e2b 远程 VM 后端的物理隔离。** 它需要 `E2B_API_KEY`(违反无密钥约束)且组合静态、不按工作区;进程外接缝把它留作后续的后端替换。

## Consequences

引擎接缝由宿主机供料:进程内 runner 闭包与进程外 worker 脚本是挂载宿主机的义务,而接缝只拥有驱动与路由,不拥有装配。进程外协议要求 worker 持久化并打印一行结果;非零退出或缺行会以 `ENGINE_SPAWN_FAILED` 响亮地失败这次驱动,绝不静默。两个包都是私有仅源码实验包,无发布包依赖,因此接缝类型与会话事件不属于发布的 SDK。
