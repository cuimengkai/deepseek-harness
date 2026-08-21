# engine-isolation-demo

[English](README.md) | 中文

[docs/platform-engine-isolation.zh.md](../../docs/platform-engine-isolation.zh.md) 中按需物理隔离与引擎进程外接缝的无密钥可运行原型:被标记隔离的工作区,其 agent 驱动在一个专用子引擎进程里运行,store 与会话日志位于按工作区根目录;共享工作区继续在当前进程内运行。无需 `DEEPSEEK_API_KEY`,无需网络:`engine-isolation-demo` 模型提供方是脚本化进程内适配器,子引擎跑一轮 mock 驱动的驱动,demo 在退出后删除 scratch store 与会话日志。

## 运行

```sh
node --import tsx/esm examples/engine-isolation-demo/src/demo.ts
```

驱动引导宿主装配,创建共享与隔离两个工作区,运行一次进程内驱动(共享)与一次进程外驱动(隔离),然后打印演示机制的 JSON 摘要。

## 它证明了什么

- **按隔离记录路由。** `ctx.engineIsolation.driver` 读取 `workspaceIsolation`:共享工作区路由到进程内引擎,隔离工作区路由到进程外引擎,未知工作区响亮失败。JSON 里的 `routing` 显示映射,`unknownFailsLoud` 证明响亮拒绝。
- **物理进程边界。** 隔离驱动在一个经 `ctx.subprocess` 派生的子进程里运行;子进程报告的 pid 与父进程不同,运行 handle 携带子进程的按工作区 store 与日志根目录。JSON 里的 `processBoundary` 显示两个 pid。
- **store 分离。** 隔离引擎播种自己的世界,并把隔离驱动提交到它的按工作区 store:隔离 store 只含隔离工作区及其角色,共享 store 只含共享工作区的行。JSON 里的 `storeSeparation` 显示每个 store 持有哪个工作区。
- **驱动持久且可重建。** 子进程持久化会话日志并打印一行 JSON 结果;父进程的 `listSessions` 与 `readLog` 读回它,包括持久化的 `register_asset` 工具调用与隔离引擎发出的 `platform/workspace/isolated` 事件。JSON 里的 `persisted` 显示可重建的会话。
- **干净清理。** demo 在退出时删除 scratch store 与日志根目录,重复运行从干净状态开始。

## 布局

各文件角色:`cordis.yml` 是宿主装配(agent-spine + platform-shell + persistence-jsonl + mock-llm + engine-isolation),`src/demo.ts` 驱动共享与隔离两次运行并断言证据,`src/worker.ts` 是进程外驱动派生的子引擎,`src/mock-llm.ts` 是脚本化无密钥模型适配器,`src/engine-isolation-demo.ts` 注册会话→用户绑定。

```
cordis.yml
src/demo.ts
src/worker.ts
src/mock-llm.ts
src/engine-isolation-demo.ts
```

## 上线

把 `processOut.workerScript` 指向真实引擎装配,把 agent `provider` 从 `engine-isolation-demo` 换成 `deepseek-official`,挂载 `dsh-llm-deepseek` 并提供 `DEEPSEEK_API_KEY`,即可驱动真实的隔离工作区。注意进程外是进程级委托,不是安全边界——容器或虚拟机隔离是在同一接缝上的后端替换。
