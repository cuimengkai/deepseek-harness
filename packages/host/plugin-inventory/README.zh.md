# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

当前 Cordis Loader 树的只读 Host 投影。`PluginInventoryGateway` 注册 `pluginInventory` 服务，并发布一个由 Typert 生成的直接 Remote：`pluginInventory/list`。每次调用都直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，再按 Loader 顺序返回其余条目，包含 Loader 条目 id、模块标识、有效启用状态与当前根 Fiber 阶段。当模块名出现在内置 spine 元数据表（`./spine-meta`）中时，条目还会携带 harness 原生 `category` 与一行 `description`；用户安装的插件与自定义 overlay 模块两者都不投影，因此控制台可以分组与描述 harness spine，而无需编辑组合层。

阶段为 `pending`、`loading`、`active`、`failed` 或 `unloading`；条目没有存活的根 Fiber 时则为 `null`。该快照刻意只表示调用当下：Loader 仍是唯一的生命周期权威，本包不拥有缓存、历史、来源模型或修改路径。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

## 实时更新事件

网关还发布一个 `plugin-inventory/changed` Host 事件，让已挂载的消费者无需轮询即可刷新。它订阅 Loader 生命周期流（`loader/entry-init`、`loader/partial-dispose`、`internal/plugin`、`internal/status`），把一帧内的事件合并为单次微任务发射，并且只在重算投影与上次已发内容确实不同时才发射——`internal/status` 在每次 Fiber 迁移时都会触发，否则会用无变更的 nudge 洪泛线缆。事件不携带 payload；消费者重读 `list` 来观察新状态。它是一个单向 nudge，由 [`api-remotes`](../../api/remotes/README.zh.md) 转发循环按原文中继给订阅的客户端。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.zh.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的清单投影不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **仅表示调用当下** —— 结果不包含持久的失败历史；不存在存活的根 Fiber 一律报告为 `null`，而不区分原因。`changed` 事件是 nudge，不是 payload，并按帧合并：多次 loader 迁移产生一次事件，同帧内被回滚的变更则不产生任何事件。
- **无来源与修改能力** —— 服务不识别条目由哪个 bundle、profile 或 override 引入，也不能启用、停用、添加或移除插件。
- **spine 元数据手工维护** —— `spine-meta` 表没有针对 bundle 补丁的门禁；改名或移除的 spine 模块会静默丢失其分类与描述，并以未分类状态出现。
