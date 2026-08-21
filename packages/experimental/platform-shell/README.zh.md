# @deepseek-ai/dsh-experimental-platform-shell

[English](README.md) | 中文

一个自建的平台控制面:租户/RBAC、带血缘的业务对象资产存储、业务审批流程、审计日志、能力市场与计费账本,全部落在同一个 SQLite 数据库上。服务以 `ctx.platformShell` 注入;`registerPlatformShellTools` 挂载模型可见工具。工作区是隔离单元,控制面持有每个工作区的物理隔离记录,[engine-isolation 包](../../../packages/experimental/engine-isolation/README.zh.md) 据此路由。持久化记录类型见 [platform-shell 子系统目录](../../../docs/subsystems/platform-shell.zh.md),[无密钥 demo](../../../examples/platform-shell-demo/README.zh.md) 驱动控制面表面,[能力市场 demo](../../../examples/capability-market-demo/README.zh.md) 无密钥证明市场与账本,[Agent Note](../../../.agents/notes/implemented/architecture/2026-08-21-platform-shell-control-plane.zh.md) 记录放置与预设决策。

## 配置

```yaml
# cordis.yml
- id: platform-shell
  name: '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts'
  config:
    path: './.platform-shell.sqlite'   # or ':memory:'
    journalMode: wal                  # wal | delete | truncate | persist
    busyTimeoutMs: 5000
```

`path` 是 SQLite 数据库文件,`:memory:` 表示临时存储。`journalMode` 选择 SQLite 日志模式;`busyTimeoutMs` 限定并发写入方在单连接上等待的时间。

## 身份与租户

`UserId`、`WorkspaceId`、`RoleId`、`AssetId`、`TicketId` 与 `AuditEventId` 是 branded id。工作区是隔离单元:用户全局注册,角色与成员关系按工作区隔离。`assignRole` 幂等——重复分配角色会覆盖成员关系。默认角色向新数据库播种 `product`、`dev`、`qa` 与 `platform-admin`。

强制发生在服务边界:每个带 actor 的方法都会先解析调用者的工作区成员关系,在任一变更或读取提交前以 `PERMISSION_DENIED` 拒绝。非工作区成员无法读取、注册或审批。

## 引擎隔离

工作区是隔离单元,物理隔离按工作区可选:`createWorkspace(name, {isolated})` 在创建时接受该标志,`setWorkspaceIsolation(actor, workspaceId, isolated)` 在 `platform.isolation` 权限下翻转(`platform-admin` 默认角色携带该权限),`workspaceIsolation(workspaceId)` 探读记录。隔离翻转写入一行审计,运行了隔离驱动的那台引擎发出持久化的 `platform/workspace/isolated` 会话事件。引擎接缝据此记录路由每个工作区的运行——见 [隔离机制规格](../../../docs/platform-engine-isolation.zh.md) 与 [engine-isolation 包](../../../packages/experimental/engine-isolation/README.zh.md)。

## 资产存储

每个资产是一个带类别、产出角色、内容与工作区的持久业务对象。`registerAsset` 在同一事务中提交记录并写入一行审计,否则抛错;存储从不半提交。`AssetId` 按 `<kind>-<seq>` 分配,因此 id 会在角色间形成可见链条(`requirement-1 → code-2 → test-case-3`)。

## 血缘

`linkAsset` 记录一个资产由另一资产派生;`ancestors`/`descendants`/`parents`/`children` 追踪派生 DAG。血缘桥还按每次读取与注册各发出一个 session 引用事件,让 session 日志与存储互锁。

## 业务审批

工单把受审资产带过状态机 `draft → review → approved → released`(rejected 回到 `draft`)。`approved` 迁移要求 `ReviewScope` 指明审批授予的角色与工作区;release 迁移清除该 scope。每次迁移都被记录,首行在创建时记录 `from: null → draft`,保证历史始终包含链条起点。

## 能力市场

市场让能力可发布、可组合、可计费。`publishCapability` 校验 id 唯一、依赖存在与依赖 semver 范围,并记录能力管辖的工具名;`publishScenario` 注册一个工作台捆绑——每个客户群一份能力集加一个预设绑定。`assemble_capabilities` 依依赖优先顺序解析请求的能力集,校验版本范围与冲突对,并应用执行门禁:禁用能力拒绝任何到达它的装配,灰度 0 的能力拒绝每个工作区。注册 `registerCapabilityExecutionGate` 把同一个门禁变成运行期拦截:每次 `tools/execute` 调用都按工作区重新检查归属能力的实时门禁状态,门禁关闭即拒绝 `CAPABILITY_DISABLED`。市场工具挂载在消费该 seam 的每个 agent 上。见 [能力市场元模型](../../../docs/platform-capability-market.zh.md)。

## 计费账本

一个模拟的整数信用点账本。`creditAccount` 开户或充值工作区账户;`consume_capability` 按能力费率计量用量(`cost = rate × qty`),余额不足时以 `INSUFFICIENT_BALANCE` 拒绝并回滚扣款;`settle_account` 把工作区某个 `YYYY-MM` 账期的 `open` 结算关闭为 `settled`。见 [计费账本规范](../../../docs/platform-billing-ledger.zh.md)。

## 审计

每次变更都在与存储提交相同的同一事务中写入一行持久审计;被拒的读取不写入。`listAudit` 按工作区与动作过滤,无工作区的 actor 解析为其唯一成员关系。

## 持久化与重放

存储是一个带单调 `SCHEMA_VERSION` 与 `application_id 0x504c5348`(`'PLSH'`)的 SQLite 数据库。引用事件(`asset/read`、`asset/register`、`platform/approval/transition`)仅在存储调用成功后提交到 session 日志。包不变量伴生在重放时对每个已提交的引用事件做存储校验,因此重放的 session 不能指向存储不存在的资产或状态。

## Model Experience

### 工具结果即持久记录

#### 模型看到什么

十九个工具(十个控制面工具 `register_asset`、`get_asset`、`link_asset`、`asset_ancestors`、`asset_descendants`、`submit_ticket`、`get_ticket`、`list_tickets`、`approve_ticket`、`audit_query`,加九个市场工具 `publish_capability`、`list_capabilities`、`assemble_capabilities`、`set_capability_gate`、`publish_scenario`、`list_scenarios`、`consume_capability`、`account_balance`、`settle_account`)把控制面记录——资产、血缘边、工单、审计事件、能力、场景、用量记录与结算——作为结果内容返回。这些就是存储已提交的记录;模型读到的是权威持久形态,而非派生视图。被 RBAC 拒绝的读取返回 `PERMISSION_DENIED` 工具错误而非记录。

#### Token 影响

每个工具结果把返回的记录追加到会话历史。被拒的调用追加错误文本而非记录。血缘、工单、审计、能力与结算引用事件仅进日志,不增加模型 token。

#### KV Cache 影响

工具结果追加在可复用历史前缀之后。控制面服务不修改系统提示词,也不修改更早的请求 token,因此已可复用的前缀在轮次内保持可复用;持久记录只出现在新的结果内容中。

## 已知限制与待办

- **单进程单文件存储** —— 一个进程内一个 SQLite 文件;包不提供网络或多进程控制面,因此多个 harness 进程共享一个存储不受支持。
- **隔离是按工作区的记录,不是强制墙** —— 控制面记录并据此路由物理隔离,但记录路由到的进程外引擎是进程级委托(见 [engine-isolation 包](../../../packages/experimental/engine-isolation/README.zh.md)),不是安全边界;容器或虚拟机隔离暂缓到该接缝的 e2b 家族后端。
- **actor 解析是消费方义务** —— 工具需要消费方提供 session→平台用户映射(`ResolveActor`);缺失时工具以 `UNKNOWN_ACTOR` 响亮失败。包提供解析器类型,而非内置绑定。
- **审批是记录型状态机,不是执行闸** —— 服务强制允许的迁移边,但不阻止持有直接存储访问的调用者行动;服务边界是唯一被强制的那道墙。
- **审计不可防篡改** —— 审计行与存储提交在同一事务,但文件没有签名或只追加式强制来对抗外部写入方。
- **计费是模拟账本** —— 整数信用点加每能力费率卡;没有真实支付、货币或存储之外的结算。
- **工作台是场景捆绑,不是页面** —— 被证明的产物是捆绑描述符(能力集 + 预设绑定),通过 harness 插件机制按客户群提供;实际页面渲染属于 Web 应用层。
- **运行期门禁是可选注册,不是默认** —— `resolveCapabilities` 与 `consumeCapability` 始终响亮地拒绝禁用或灰度排除的能力;把该门禁变成运行期拦截需要注册 `registerCapabilityExecutionGate`(还要带上消费方的 session→工作区绑定),否则受限能力只靠不出现在挂载的装配中来强制。
- **悬空依赖边不可能存在** —— 发布校验每条依赖,外键链拒绝卸载被引用的能力,因此 `CAPABILITY_DEPENDENCY_MISSING` 无法经由服务到达。
