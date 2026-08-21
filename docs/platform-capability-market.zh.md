# 能力市场元模型

[English](platform-capability-market.md) | 中文

> [platform-architecture.zh.md](platform-architecture.zh.md)(D5、D4)的配套文档:能力市场是目录与装配层,使平台能力(插件 + 预设 + 资产 schema)可发现、可组合、可追溯。本规范定义元模型——打包单元、目录条目、发布/消费流。打包三元组以 `examples/platform-agent-demo/` 为依托;目录、解析、门禁与计费在 `@deepseek-ai/dsh-experimental-platform-shell` 中落地,并由 `examples/capability-market-demo/` 无密钥证明。

## 1. 打包单元

一个能力打包三样东西(D5):

| 部分 | 含义 |
|---|---|
| 插件 | 能力背后的工具/服务 |
| 预设 | 能力贡献的角色工具面 |
| 资产 schema | 能力产出的数据形态(见 [platform-asset-schema.zh.md](platform-asset-schema.zh.md)) |

一个能力不是其中任何单样,而是三者合一。原型中的 `register_asset`、`get_asset` 与凭据工具是 demo 的能力;每个角色预设贡献角色工具面;每个资产 kind 是 schema。

## 2. 目录条目

| 字段 | 含义 |
|---|---|
| `id` | 能力 id(插件名) |
| `name` | 展示名 |
| `role` | 挂在哪个角色预设上 |
| `dependencies` | 所需能力,每条带一个 semver 范围 |
| `conflicts` | 不能共存的能力 |
| `execution` | `managed \| sandboxed \| none`(D4) |
| `tools` | 能力管辖的工具名;注册运行时门禁后,门禁关闭时其执行会被拦截 |
| `version` | 打包的 semver 版本 |
| `rate` | 每单位信用点成本(见 [platform-billing-ledger.zh.md](platform-billing-ledger.zh.md)) |
| `enabled` / `rollout` | 执行门禁:禁用或灰度排除的能力会响亮地拒绝装配;注册运行时门禁后,还会在调用时拒绝其工具 |

市场目录把每条条目存为一行 `capabilities` 记录,加 `capability_dependencies` / `capability_conflicts` 边表,并把能力的工作台成员关系存进 `scenario_capabilities`——全部位于 platform-shell 控制平面存储中。

## 3. 发布与消费

- **发布**:`publishCapability` 校验 id 唯一、依赖存在与每条依赖范围;`publishScenario` 注册一个工作台捆绑(工作组 id、展示名、工作台 id、角色、预设 id、能力 id 列表)。卸载一个被其他能力依赖的能力会被外键链拒绝,因此依赖边永远不会悬空。
- **消费**:`assemble_capabilities` 把请求的能力集解析成(见 §4)工作台挂载所用的有序能力集,`consume_capability` 把用量计入工作区账户。

## 4. 装配期检查

`resolveCapabilities` 依依赖优先顺序遍历依赖图,校验每个访问到的能力的版本范围,检查完整冲突对矩阵,并应用执行门禁——禁用能力会拒绝任何直接或经依赖到达它的装配,灰度 0 的能力拒绝每个工作区。每次拒绝都是响亮的(`PlatformShellError` 带 `CAPABILITY_CONFLICT`、`VERSION_MISMATCH` 或 `CAPABILITY_DISABLED`);不会静默跳过任何东西。解析出的集合依依赖优先排序,这正是工作台挂载的顺序。注册运行时门禁后,同一个门禁也在调用时约束执行(§5)。

## 5. 落地的市场

市场的目录、解析、门禁与计费位于 `@deepseek-ai/dsh-experimental-platform-shell` 的 `capability-market` 模块,通过 `publish_capability`、`publish_scenario`、`assemble_capabilities`、`set_capability_gate`、`consume_capability`、`account_balance` 与 `settle_account` 工具提供给 agent。工作台是一个场景捆绑——每个客户群一份能力集加一个预设绑定——通过 harness 插件机制注册;页面渲染属于 Web 应用层。计费是 [platform-billing-ledger.zh.md](platform-billing-ledger.zh.md) 规定的模拟整数信用点账本。

目录条目还记录每个能力管辖的工具名(`capability_tools`),`runtimeCapabilityOwningTool(toolName)` 按单个工具反查实时目录行。`registerCapabilityExecutionGate(ctx, { resolveWorkspace })` 挂一个 `tools/execute` 瀑布:每次调用重新按调用会话所属工作区检查被门禁工具的归属能力,门禁关闭即抛 `CAPABILITY_DISABLED`——装配期门禁由此变成运行时拦截。该读取连接实时门禁行,所以操作者的门禁翻转在下次调用即生效。

## 6. 验证

`examples/capability-market-demo/` 无密钥证明市场:操作者发布目录,两个客户群工作台提供互不相交的能力集,产品装配响亮地拒绝一次冲突与一次版本范围不匹配,禁用依赖与灰度 0 能力被拒绝,计费账本计量用量并结算两个账期——全部可从持久化会话日志重建。同一个驱动还证明运行时门禁:同一个 `analyze_code` 调用在 `code-analysis` 启用时被放行,操作者在回合之间禁用它后,该调用在调用时被以 `CAPABILITY_DISABLED` 拒绝。
