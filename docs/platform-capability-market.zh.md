# 能力市场元模型

[English](platform-capability-market.md) | 中文

> [platform-architecture.zh.md](platform-architecture.zh.md)(D5、D4)的配套文档:能力市场是目录与装配层,使平台能力(插件 + 预设 + 资产 schema)可发现、可组合、可追溯。本规范定义元模型——打包单元、目录条目、发布/消费流——以 `examples/platform-agent-demo/` 为依托。

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
| `dependencies` | 所需能力 |
| `conflicts` | 不能共存的能力 |
| `execution` | `managed \| sandboxed \| none`(D4) |
| `version` | 打包版本 |

原型中的 roster 是一个最小目录:它扫描预设目录并按 id 列出装配好的预设(`roster.list()`)。真实目录补上依赖/冲突/版本列。

## 3. 发布与消费

- **发布**:能力作者打包三元组并注册条目。目录校验 id 唯一、依赖存在、schema-kind 已注册。
- **消费**:用户选一个角色与一组能力;预设装配器(见 [platform-preset-assembler.zh.md](platform-preset-assembler.zh.md))渲染 agent 装配;roster 挂载之。`agent-preset/selected` 事件记录该 agent 运行的能力集。

## 4. 装配期检查

装配器在挂载前检查目录的依赖与冲突约束(id 唯一、服务注入、工具名遮蔽、禁用行)。市场拒绝一个会产出"两个同名工具"或"缺失注入服务"的 agent 的组合。

## 5. 两阶段路线

- **一期**:目录仅登记——发布注册条目,消费列出并装配,不计费。原型的 roster 即此阶段。
- **二期**:依赖/冲突解析显式化、版本分级、加入计费(D1、架构 §7)。元模型的依赖与冲突列正是解析作用之处。

## 6. 验证

原型无密钥证明消费路径:roster 扫描目录、按 id 装配 agent、把空白 agent 重组装到预设、持久记录选择。本规范的增量是打包三元组、目录条目字段、发布/消费流——即 §9 中的 D5 后续。
