# platform-agent-demo

[English](README.md) | 中文

`product` agent 是产品经理,编写需求并注册为资产;`dev` agent 读取该需求并注册产出的代码;`qa` agent 验证代码并注册测试用例。`platform-agent-demo` 宿主插件与 `platform-service` 提供共享的资产/凭据工具与注册表;`mock-llm` 是无需密钥的模型路由。

[docs/platform-architecture.zh.md](../../docs/platform-architecture.zh.md) 中多角色平台概念的一个无需密钥的可运行原型。三个角色 agent 共享同一个 harness 进程,但暴露不同的模型可见工具面,跨角色交换已注册资产,并把每一轮都写进持久化 session 日志。无需 `DEEPSEEK_API_KEY`,无需网络:`platform-demo` 模型 provider 是进程内脚本化 adapter。

## 运行

```sh
node --import tsx/esm examples/platform-agent-demo/src/demo.ts
```

驱动脚本启动宿主装配,创建一个 `product` agent(产品预设)、一个 `dev` agent(开发预设)、一个 `qa` agent(qa 预设)、一个裸的 `assembler` agent(由能力市场重组装到开发预设)和两个在不同令牌预算下运行同一任务的配额 agent,各驱动一轮,然后打印一份证明各机制的 JSON 摘要。

## 它证明了什么

- **引擎进程内嵌。** 驱动脚本从 `cordis.yml` 把完整 harness 作为进程内库启动(D3):宿主装配把引擎插件与 demo 插件装在同一个进程树里——没有独立的引擎进程,没有网络跳数。即 `docs/platform-architecture.md` 中的 T1。
- **角色预设隔离工具面。** 产品预设不挂载任何编码工具;开发预设挂载 `tool-fs` 和 `tool-bash`;qa 预设只挂载只读检查工具(`tool-fs-search` 的 `glob`/`grep`)。JSON 中的 `roleIsolation.devOnlyTools` 显示 dev 的差异,`roleIsolation.qaReadOnlyTools` 列出 QA 缺失的变更工具(`write`、`edit`、`bash`)。
- **跨角色资产血缘。** 产品 agent 注册 `requirement` 资产,开发 agent 用 `get_asset` 读取它,再注册产出的 `code` 资产,qa agent 读取代码并注册 `test-case` 资产。工具调用历史里 id 依次为 `requirement-1 → code-2 → test-case-3`——即 `lineage.chainComplete` 所校验的持久血缘。
- **全程 session 可追溯。** 每个 agent 的每一轮都追加进 JSONL session 日志,持久化到磁盘,并以 `traceability.persistedLogLines` 读回。
- **ACL 在 provider 边界强制。** dev agent 被限制在自己的工作区(`workspace-write` 沙箱模式,由 `applyRolePolicy` 按会话注入)。当它试图 `write` 到相邻 product 工作区时,沙箱化文件系统栅栏会在工具执行前以 `FS_SANDBOX_DENIED` 拒绝该调用,模型可见结果携带 `[sandbox: …]` 标记。该拒绝是持久的:持久化的 dev 会话 JSONL 记录了 `FS_SANDBOX_DENIED` 错误与 `pii-leak` 写入尝试。JSON 中的 `aclEnforcement.deniedBy` 显示该错误码。
- **AI 执行审批缝。** 模型携带 `sandbox_permissions` + `justification` 重试被拒的写入;`approveEscalation` 通过 `ctx.approval`(`dsh-user-approval` 缝)路由,脚本化 answerer 返回 `allowed-once`,然后写入才真正执行。`approval/asked` + `approval/decided` 审计对进入 session 日志(持久化、可重放)——即 `approvalEnforcement` 中的 T6 证据。
- **能力市场装配。** `agent-presets` roster 把预设目录当作市场目录扫描,并按 id 组装 agent。一个裸 `assembler` agent 以无预设创建,然后在空白期被重组装到 `dev` 预设:它的工具面恰好获得 dev 目录(`bash`、`edit`、`glob`、`grep`、`read`、`write`),持久的 `agent-preset/selected` 事件记录这次切换——即 `marketAssembly` 中的 T7 证据。
- **共享运行时下的每工作区令牌配额。** 两个配额 agent 以不同 `maxTokens` 上限运行同一任务,共享同一个 harness 进程。tight 会话(24)命中上限并以 `max-tokens` 结束;loose 会话(120)在其上限内正常完成。上限随 session header 进入 provider 边界(`requestHeader().config.maxTokens`),因此是逐会话的记录——即 `quotaEnforcement` 中的 T5 证据。

## 结构

英文版结构列出了装配;各文件职责:`cordis.yml` 是宿主装配,`presets/product/`、`presets/dev/` 与 `presets/qa/` 是角色预设,`src/demo.ts` 驱动三个角色 agent 与裸 assembler,`src/mock-llm.ts` 是脚本化 adapter,`src/platform-agent-demo.ts` 与 `src/platform-service.ts` 提供资产工具与注册表。

```
cordis.yml
presets/product/
presets/dev/
presets/qa/
src/demo.ts
src/mock-llm.ts
src/platform-agent-demo.ts
src/platform-service.ts
```

## 真实运行

把 agent `provider` 从 `platform-demo` 换成 `deepseek-official`,挂载 `dsh-llm-deepseek`(在 `cordis.yml` 里禁用),并提供 `DEEPSEEK_API_KEY`,即可用真实模型运行同一装配。
