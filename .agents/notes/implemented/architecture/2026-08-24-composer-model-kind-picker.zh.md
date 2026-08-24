# Agent Note: Composer model-kind reference selection

Status: implemented

[English](2026-08-24-composer-model-kind-picker.md) | 中文

## Problem

组合器的节点检查器此前没有模型面。曾经提供自由输入 provider/model 段的会话流程 tab 已被移除（流程编辑器的会话视图退役），组合器由此成为唯一可以创作按角色路线的地方——但那里没有任何东西引用流程域的绑定词汇。手打 id 会漂移：键入文本字段的 provider 或 model 未必存在于部署中，而「模型」设置 tab 恰恰已经配置好了组合器应当引用的那份目录——并且带按角色划分的职责。

## Decision

组合器的节点检查器通过 `ModelKindPicker` 一次绑定一种模型角色：每种角色（text、image、audio、embedding）一行，把 provider 下拉与 model 下拉配对到配置目录（`api.llm.models({})` → `{ groups, failures }`）上——也就是「模型」设置表层配置的那批模型，直接选用而非键入。模型在显式 `kinds` 列表包含该角色时供应它，未声明时默认只供应 text；没有配置 provider 供应的角色不渲染行。路线的任何一侧都可以留在节点自身的默认值上（空选项即继承）；更换 provider 会清掉在旧 provider 下绑定的 model，因为路线是 provider/model 对。目录仍在加载、或宿主不可用（拒绝或传输断开）时，渲染各不相同的提示而非坏掉的表单。

目录在组合器或设计页打开期间保持常驻：`view()` 与 `beginCompose()` 触发 `loadModelCatalog()`（单飞），「模型」设置表层所订阅的同一对事件——`llm/adapters-updated` 与 `settings/document-updated`——在浮层打开的前提下刷新它。关闭组合器或设计页、或确认保存，都会丢弃目录。`updateAgentModelKind(nodeId, kind, field, value)` 经 `setAgentModelKind` 修改草稿图，因此路线编辑与行或布局编辑一样会唤醒保存（脏检查比较逐节点的 `agentOptions`）。持久化免费：`modelKinds` 随图节点的 `agentOptions` 保存到行旁边的 `agent.flow.json`。只读设计页把同样的路线以文本展示。选择器不新增依赖——它消费既有的 `dsh-api-remotes/client` 面孔。

## Alternatives considered

- **保留自由输入的 provider/model**（被移除的会话流程编辑器所提供的）—— 已否决：手打的 id 未必能在部署中解析，而「模型」设置 tab 已经拥有带角色职责的目录；引用它才能让组合器不偏离已配置的内容。
- **复用会话流程编辑器的检查器段** —— 已否决：该编辑器及其模型段随会话视图一起退役，而且它的输入是自由文本，不是目录引用。
- **组合器打开时加载一次目录、此后永不刷新** —— 已否决：adapter 拓扑与 settings 文档都会喂给目录，陈旧的列表会让人选中部署刚移除的 provider 或 model；常驻刷新与「模型」表层自身的契约一致。
- **现在就按角色路由请求** —— 暂缓而非选它：`modelKinds` 保持仅声明，直到请求路由消费角色（Phase B/C 后续）；本次改动创作并携带绑定，让后续的路由切片有据可依。

## Consequences

- 选择器呈现已配置的目录，因此路线总是部署能供应的那一个；拒绝或断开的宿主退化为提示，绝不会是坏掉的表单。
- 绑定的角色只被携带、不被路由：正常保存时它随 `agent.flow.json` 保留，但从行重建布局（`rowsToGraph`）会重建不带 `agentOptions` 的节点，因此使布局过期的手工编辑会丢掉路线（见 README Known Limitations）。
- 会话流程 tab 移除后，组合器成为按角色模型创作的归宿；设计页把同样的路线读作文本。
- 测试钉住这些变更（绑定/保留/清空/继承）、目录状态（ready/拒绝/传输断开/单飞）、事件驱动的刷新与只读渲染；保存路径把 `modelKinds` 携带过传输层。
