# Agent Note: Complete the capability market with billing and a pluggable workbench

Status: implemented

[English](2026-08-21-capability-market.md) | 中文

## Problem

[平台架构文档](../../../../docs/platform-architecture.zh.md)(§7、D1、D4、D5、D8)在 B 端控制面之后规划 C 端能力市场:显式依赖/冲突校验、分级版本、计费/结算、让用户自由组装的 C 端工作台,以及按能力灰度门控的受限执行。一期控制面(`@deepseek-ai/dsh-experimental-platform-shell`)拥有租户/RBAC、资产、血缘、审批与审计,但没有任何目录、解析、门禁或计费。规划中的二期要求在同一个存储中完成市场并做无密钥证明。

## Decision

`packages/experimental/platform-shell` 新增 `capability-market` 模块:纯数据库函数加纯解析,接入既有的 mutate/审计/RBAC/session 事件机制。目录与计费是同一个 SQLite 存储中的新表(`SCHEMA_VERSION` → 2):`capabilities`、`capability_dependencies`、`capability_conflicts`、`scenario_bundles`、`scenario_capabilities`、`accounts`、`usage_records`、`settlements`。服务表面增加 `publishCapability`、`unpublishCapability`、`listCapabilities`、`getCapability`、`setCapabilityGate`、`publishScenario`、`unpublishScenario`、`listScenarios`、`getScenario`、`resolveCapabilities`、`consumeCapability`、`accountBalance`、`listUsage` 与 `settleAccount`,外加九个模型可见工具。

解析(`resolveCapabilities`)是纯函数:依依赖优先顺序遍历依赖图,校验每个访问到的能力的 semver 范围,检查完整冲突对矩阵,并断言每个能力的执行门禁(禁用或灰度 0 的能力以 `CAPABILITY_DISABLED` 响亮拒绝)。解析出的集合依依赖优先排序,这正是工作台挂载的顺序。

计费是模拟的整数信用点账本:每条目录条目带一个 `rate`,`consumeCapability` 扣减 `rate × qty` 并拒绝 `INSUFFICIENT_BALANCE`(扣款与审计一起回滚),`settleAccount` 把工作区某个 `YYYY-MM` 账期的 `open` 结算关闭为 `settled`。

工作台是一个场景捆绑:每个客户群一份能力集加一个预设绑定,通过 harness 插件机制注册并由市场提供。在这个 harness 仓库里,被证明的产物是机制——捆绑描述符及其服务——而非渲染页面,后者属于 Web 应用层。

`examples/capability-market-demo/` 无密钥证明市场:操作者发布目录并关闭计费账期,产品工程客户装配并计量消费,短视频创作客户装配自己的工作台;两个场景捆绑提供互不相交的能力集,roster 把每个 agent 绑定到其工作台的预设。

两处超出计划的事实塑造了实现:

- **`unpublishScenario` 加入了服务表面。** 卸载能力会级联其工作台成员关系(`scenario_capabilities` 是 ON DELETE CASCADE),因此 demo 的目录修复——卸载并重新发布一个修正后的能力——需要重新发布其场景才能恢复工作台。计划中的工具表面缺场景卸载,于是它与 `publishScenario` 一起加入。
- **`CAPABILITY_DEPENDENCY_MISSING` 无法经由服务到达。** `publishCapability` 校验每条依赖边,外键链 RESTRICT 卸载被引用的能力(`capability_dependencies.depends_on`),因此依赖边永远不会悬空。demo 改为证明最近的可达情形:被门禁关掉的依赖以 `CAPABILITY_DISABLED` 响亮地拒绝装配,孤儿证明探针则显示原始外键拒绝。

## Alternatives considered

**把市场拆成独立包。** 模块自包含(纯 db 函数 + 纯解析),后期可以提升为包,但留在 platform-shell 里能复用 mutate/审计/不变量/session 事件机制与同一个存储,在市场仍属实验期时这是正确的地基。

**用真实支付计费。** 用户指示采用带每能力费率卡的模拟整数信用点账本——无密钥、无真实货币、无外部结算——因此账本持久且可审计,但不是真钱。

**把工作台渲染成页面。** 工作台是 Web 端可插拔表面;不同客户群得到不同工作台。在这个 harness 仓库里,被证明的产物是机制(场景捆绑 + 能力集 + 预设绑定),页面渲染推迟到 Web 应用层并记为已知限制。

**从 session 事件读取 roster 绑定。** `roster.mount` 绑定 agent 的作用域链,但不追加 `agent-preset/selected` session 事件(只有 apiproxy 宿主层写它)。demo 改读 `roster.composedPreset` 的实时绑定。

**按用户消息总数键控脚本化 mock。** 工具技能插件在每个轮次开始、上一轮工具结果之后,把技能目录作为用户消息(`source.kind === 'skill-catalog'`)注入,这会破坏朴素的轮次计数与轮次边界上的末消息工具结果访问。mock 按 `source.kind === 'user'` 过滤指令,并把末消息不带工具结果块的轮次边界(上一轮的文本回复或注入的目录)视为新轮次的第一步。

## Consequences

市场、门禁与计费与控制面同处一个持久、可重放的存储,因此 session 日志与不变量伴生像覆盖其他记录一样覆盖它们;代价是市场属于没有发布包依赖的实验包。模拟账本与仅描述符的工作台是刻意的范围边界——真实支付与页面渲染仍在本仓库之外。外键受限的依赖边使一个计划中的错误码无法经由服务到达;demo 记录最近的可达拒绝,证据 JSON 注明该缺口。
