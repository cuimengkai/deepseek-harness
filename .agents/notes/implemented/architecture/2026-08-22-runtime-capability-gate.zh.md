# Agent Note: 在执行期强制能力门禁

Status: implemented

[English](2026-08-22-runtime-capability-gate.md) | 中文

## 问题

路线图二期"受限执行(按能力灰度开放)"只落地了一半:执行门禁(`enabled` / `rollout`)只在装配期被强制——`resolveCapabilities` 与 `consumeCapability` 响亮地拒绝禁用或灰度排除的能力,强制方式是受限能力不出现在挂载的装配中。一个归属能力在装配后被翻转禁用的工具仍然会运行,因为没有任何东西在调用时重新检查门禁。platform-shell README 的已知限制点明了这个缺口:"门禁是装配期而非运行期。"

## 决策

platform-shell 包拥有运行时执行门禁:`registerCapabilityExecutionGate(ctx, { resolveWorkspace })` 注册一个 `tools/execute` 瀑布监听,每次调用都通过新 `capability_tools` 表(schema v4)上的实时存储读取 `runtimeCapabilityOwningTool(toolName)` 解析工具的归属能力,当调用会话所属工作区的门禁关闭时抛 `CAPABILITY_DISABLED`。`tools/execute` 运行时把抛出的错误变成携带该错误码的错误结果,因此拦截落在调度处。该读取连接实时门禁行——绝不缓存,所以操作者的门禁翻转在下次调用即生效。无归属工具与非 agent 执行原样委托;宿主提供 session→工作区绑定,并负责无工作区会话的响亮 `UNKNOWN_WORKSPACE` 失败。

`publishCapability` 现在记录每个能力管辖的工具名(`tools`,校验非空);`capability_tools` 行随能力级联删除。`examples/capability-market-demo` 无密钥证明该拦截:同一个 `analyze_code` 调用在 `code-analysis` 启用时被放行,操作者在回合之间禁用它后以 `CAPABILITY_DISABLED` 被拒——从持久化的 `tool/call` ↔ `tool/result` 配对重建。

## 备选方案

**在每个工具体内检查门禁。** 每个平台工具都要知道自己的归属能力并重复门禁逻辑;瀑布把它收拢到一处,并覆盖 demo 自有与发布到市场的第三方工具。

**把门禁工具从模型工具面中过滤掉。** 那正是已交付的装配期行为;它拦不住"挂载时开放、之后被禁用"的工具,而这恰恰是灰度发布的场景。

**在调用时复用装配期解析器。** 解析回答的是"该工作区能否装配这个能力",而不是"该工具现在能否运行";反查直接回答按工具的问题,只读一行。

## Consequences

运行期拦截是可选注册,不是默认:想要它的宿主必须注册门禁并提供自己的 session→工作区解析器;否则受限工具仍只靠不出现在挂载的装配中来强制。门禁语义是共享的——同一个 `assertGateOpen`(enabled 加确定性灰度分位)在装配与调用两处都拒绝,因此灰度持有同样约束执行。被管辖的工具面是能力属性,市场目录携带它,强制读取是单次 join;执行门禁规范与包 README 记录了这个可选注册与新服务方法。
