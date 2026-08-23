# Agent Note: Web boot 顺序创建条目

Status: implemented

[English](2026-08-23-web-boot-sequential-creates.md) | 中文

## 问题

`AppWebEntry.runPluginBoot` 并行创建每一个 loader 行。某个消费行在其提供方的服务 fiber 仍在加载时被创建，就会进入 PENDING，而 `loader.await()` 会跳过 PENDING 条目（它们不携带任何惯性），于是激活审计随后拒绝整个 boot。新增 ui-router 行——ui-layout 与 ui-settings-general 都 strict 注入的提供方——让该竞态变得足够确定而命中：`web boot: 4 entries did not activate`，ui-layout 与 ui-settings-general 因等待 `router` 而 PENDING，ui-sidebar 与 ui-conversation 因等待 `layout` 而 PENDING。「提供方的服务先于消费方启动解析」这一假设只靠时序成立。

## 决策

**创建按清单顺序逐条进行。** 清单是拓扑排序的——行的提供方先于其消费方——因此顺序创建让提供方的服务在下一个消费行启动前落定；组合已经声明的顺序变成了现实，而不是靠时序。随后在激活审计之前把 loader await 到静默。

**提供方行的 apply 会 await 自己的服务。** 挂载其他行要注入的服务的条目，会一直保持 LOADING，直到该服务的 fiber 变为 ACTIVE（`await ctx.plugin(RouterService)`），因为 loader 认为一行在其入口 fiber 落定后才算加载完成——一个早于其服务激活的条目正是那个 PENDING 竞态。消费方 strict 解析该服务，而省略提供方的 boot 会让消费方保持 PENDING，审计响亮点名等待中的服务。

## 曾考虑的替代方案

- **保留并行创建并重新 await PENDING 条目**——`loader.await()` 跳过 PENDING 是 loader 的契约；重新 await 它们会重新引入竞态，并为几十行添加机制。顺序创建在源头消除了时序缺口。
- **让消费方改惰性（`ctx.get`）而非 strict 注入**——削弱提供方/消费方契约，并把缺失服务推迟到首次使用才暴露；strict 注入加顺序创建让 boot 保持确定，审计响亮。
- **依赖 loader 自身的依赖排序**——loader 在能够时解析跨行注入；该竞态正是排序本身无法闭合的创建期窗口。

## 后果

- Boot 是确定的：提供方的服务先于其消费方落定，审计只报告真正的激活失败。几十行的顺序创建成本可忽略。
- 该模式现在是一项要求：任何挂载其他行要注入的服务的 function-plugin `apply` 都应 await 该服务 fiber，让条目的落定成为真正的就绪信号。
- 忘记必要提供方行的组合会让审计响亮点名等待中的服务——响亮且自解释。
- 周边的 boot 粘合——先取件后创建、模块收养、激活审计——归 [web config-tree boot note](2026-07-24-web-config-tree-boot-and-transport-layering.zh.md) 所有；本 note 细化的是该流程内图形行的创建方式。它保护的 ui-router 提供方正是 [设置路由页的路由](2026-08-23-routed-settings-page.zh.md)。
