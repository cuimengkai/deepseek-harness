# Agent Note: Per-kind model-route bindings

Status: implemented

[English](2026-08-23-model-kind-route-bindings.md) | 中文

## 问题

模型既有角色 kind（text、image、audio、embedding），也有它接受的内容（其输入 modality），但 Agent 的路由在这两者上都没有建模。线路上的 `ModelCatalogModel` 完全丢弃了 `inputModalities`，路由处处都是单一扁平的 `(provider, model)` 对：每个 Agent 一条路由，无论工作多么异构。流程画布节点检查器只能绑定一个提供方与模型，也没有任何位置可以说"把图片工作路由给视觉模型，其余交给快速文本模型"。

## 决策

现在有三层承载按 kind 的模型事实，全部是增量式的。

1. **llm 领域为模型 kind 命名。** `ModelKindMap`（`packages/llm/llm/src/types.ts`）是一张可合并扩展的映射，含四个已知 kind——`text`、`image`、`audio`、`embedding`——而 `LlmModelInfo.kinds?: readonly ModelKind[]` 声明模型的角色 kinds。DeepSeek 的静态 catalog 声明 `text`；省略的 `kinds` 默认 `['text']`，因此既有模型无需改配置仍是纯文本。

2. **线路投影 kinds 与 modalities。** `ModelCatalogModel` 及其 Zod schema 增加 `kinds` 与 `inputModalities`；`buildModelCatalog`（`api-proxy.ts`）对两者都做投影，因此 Models 设置页可以按 kind 分组与筛选，模型选择器也能在提供方与说明旁边显示模型的 kinds。发现采纳路径保留提供方所披露的一切，把 `inputModalities` 与 `kinds` 连同 id、名称与容量一并存入 profile。

3. **按 Agent 的按 kind 绑定。** `FlowAgentNode.agentOptions` 增加可选的 `modelKinds?: Partial<Record<ModelKind, { provider, model }>>`。这是增量式的：流程校验器从不拒绝未知字段，持久化只按 `FLOW_FORMAT_VERSION` 门控，因此无需版本提升。编译器把该袋子序列化进 worker 的 agent 调用；worker 运行时的 `readModelKinds` 对它做结构化校验（一个按 kind 键控的对象；每个绑定是一个只含 `provider`/`model` 的对象，各自为非空字符串，至少绑定一个字段），并经 `ChildStartRequest.modelKinds` 转发；host 的 `resolveChildAgentOptions` 把请求的选项整体展开进 core `AgentOptions.modelKinds`。流程画布节点检查器通过四行绑定按 kind 的模型（因为 `ModelKindMap` 可合并扩展，UI 在本地枚举四个已知 kind）；store 在编辑按 kind 行时保留朴素的 `provider`/`model` 路由，并丢弃空行与空袋子。

## 备选方案

- **现在就在请求期按 kind 路由** —— 消费按 kind 绑定属于 Phase B/C 后续：目前还不存在图片或音频工具，而会按 kind 调度的 Dify 式编排也未构建。先交付绑定 seam 让基础保持小而可验证。
- **给每个绑定一个 `modalities` 字段** —— 绑定的职责是按角色 kind 路由，kind 与 modality 是两条不同的轴；输入内容的接受仍属于模型自己的 `inputModalities`，不是路由关切。
- **单独的顶层 agent-options 键** —— `modelKinds` 就放在 `agentOptions` 里，与朴素路由同处一处，因此编译器既有的转发路径、worker 的支持选项集合以及 host 的 `...requested` 展开都天然覆盖它，无需新管道。

## 后果

- 该绑定是**仅声明**的：一条已绑定的按 kind 路由会到达 core `AgentOptions.modelKinds` 并随流程持久化，但还没有任何请求路由器消费它。因为它从不进入模型请求，就不增加新的模型可见输入，也无需快照。
- 既有流程文件原样加载；空袋子序列化为缺席，因此没有按 kind 绑定的流程在朴素路由上字节相同。
- `AgentOptions.modelKinds` 是未来按 kind 路由器读取的唯一 seam，因此 Phase B/C 的工作不改变任何既有绑定面。
