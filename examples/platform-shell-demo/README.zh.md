# platform-shell-demo

[English](README.md) | 中文

[docs/platform-architecture.md](../../docs/platform-architecture.zh.md) 中平台控制面的一个无密钥可运行原型:租户/RBAC、带血缘的业务对象资产存储、业务审批流程与审计日志——全部落在同一个文件型 SQLite 数据库上,完全由角色 agent 驱动。五个 agent 共享同一个 harness 进程:`product`、`dev`、`qa` 与 `platform-admin` 角色 agent 驱动存储,裸 `mallory` agent 证明 RBAC 拒绝。无需 `DEEPSEEK_API_KEY`,无需网络:`platform-demo` 模型 provider 是进程内脚本化 adapter,demo 退出时清理自己的临时存储与 session 日志。

## 运行

```sh
node --import tsx/esm examples/platform-shell-demo/src/demo.ts
```

驱动脚本启动宿主装配,创建一个带四名成员与一名非成员的工作区,为每个角色 agent 各驱动一轮,然后打印一份证明各机制的 JSON 摘要。

## 它证明了什么

- **引擎进程内嵌。** 驱动脚本从 `cordis.yml` 把完整 harness 作为进程内库启动:宿主装配把引擎插件、控制面服务与 demo 插件装在同一个进程树里——没有独立的引擎进程,没有网络跳数。即 `docs/platform-architecture.md` 中的 T1。
- **一个 SQLite 文件上的控制面。** `platform-shell` 服务是持久业务对象存储(租户/RBAC + 资产存储 + 血缘 + 业务审批 + 审计),全部在一个文件型数据库上。demo 把 `path` 覆盖为临时文件,因此存储在运行期间持久、运行后删除。
- **跨角色资产血缘。** 产品 agent 注册 `requirement` 资产,开发 agent 用 `get_asset` 读取它,注册产出的 `code` 资产并建立链接,qa agent 读取代码,注册 `test-case` 资产并链接。id 依次为 `requirement-1 → code-2 → test-case-3`——即持久 `lineage.chainComplete` 所校验的链条。
- **由 agent 驱动的业务审批。** 产品 agent 提交需求工单并驱动 `draft → review → approved`,持有 `product` 审批范围;platform-admin agent 列出工单并 release 到 `approved → released`。每一步同时落进存储与 `platform/approval/transition` session 事件——`approval.chain` 校验精确的 `null→draft → draft→review → review→approved → approved→released` 链条。
- **RBAC 在服务边界强制。** `mallory` 是已注册用户,但刻意不是工作区成员。她的 `get_asset` 读取在任何存储访问前就返回 `PERMISSION_DENIED`,且该拒绝是持久的——她的持久化 JSONL session 日志记录了 `PERMISSION_DENIED` 工具错误。JSON 中的 `rbacDenial.deniedPersisted` 显示该错误码。
- **每次变更都配一行审计。** 每次提交在同一事务中写入一行审计;`asset.register` 达到 3、`asset.read` 2、`lineage.link` 2——而 mallory 被拒的读取不写入任何一行。JSON 中的 `audit.byAction` 显示各计数。
- **模型可见 ⟺ 已记录。** 每个平台工具的 `presentationMeta` code 落在持久化的 `tool/result` 事件里,而不只是内存中的那个——`traceability.metaCodes` 证明每个工具调用与结果都能从持久化 JSONL session 日志重建。
- **不变量伴生校验重放。** 每个已提交的 `asset/read`、`asset/register` 与 `platform/approval/transition` 事件都会对照控制面存储校验,因此重放的 session 不能指向存储不存在的资产或状态。
- **控制面表面跨角色一致。** 全部五个 agent——包括裸的 mallory——都看到同样的十个平台工具(`controlPlaneSurface.uniformlyVisible`),因为访问边界是 RBAC 而非工具挂载。兄弟 `platform-agent-demo` 已证明的 fs/shell 隔离在此刻意不重复。

## 结构

各文件职责:`cordis.yml` 是宿主装配,`presets/product/`、`presets/dev/`、`presets/qa/` 与 `presets/platform-admin/` 是纯人设角色预设,`src/demo.ts` 驱动五个 agent,`src/mock-llm.ts` 是脚本化无密钥模型 adapter,`src/platform-shell-demo.ts` 用 demo 的 session→用户绑定注册平台工具。

```
cordis.yml
presets/product/
presets/dev/
presets/qa/
presets/platform-admin/
src/demo.ts
src/mock-llm.ts
src/platform-shell-demo.ts
```

## 真实运行

把 agent `provider` 从 `platform-demo` 换成 `deepseek-official`,挂载 `dsh-llm-deepseek`(在 `cordis.yml` 里禁用),并提供 `DEEPSEEK_API_KEY`,即可用真实模型运行同一装配。
