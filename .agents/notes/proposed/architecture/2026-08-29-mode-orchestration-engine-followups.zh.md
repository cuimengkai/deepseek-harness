# Agent Note: 模式编排的流程引擎后续缺口

Status: proposed

[English](2026-08-29-mode-orchestration-engine-followups.md) | 中文

## 问题

产品模式用 `FlowGraph` 做 Dify 式编排，但仍有若干引擎与运行时缺口阻碍与完整可视化工作流产品对齐：并行扇出后的汇合、人机协同节点、真正生效的 `modelKinds` 请求路由，以及流程 agent 节点启动子 Agent 时应用 `childPresetId`。

## 提案

每个缺口单独 Agent Note 与 PR，按真实模式模板痛点排序：

1. **`childPresetId` 运行时** — **已落地**：compile 发射选项；worker 接受；同进程 `applyChildComposition` 挂载指名预设并盖章子会话头。
2. **`modelKinds` 请求路由** — 就引擎唯一的请求通道而言**已落地**：`dsh-agent-loop` 的 `buildRequest` 在落回基础 `provider`/`model` 之前，先用 `AgentOptions.modelKinds.text` 播种其路由（[agent-loop-modelkinds-text-routing](../../implemented/architecture/2026-08-30-agent-loop-modelkinds-text-routing.zh.md)）。其余类型（`image`、`audio`、`embedding`）在真正会发出它们的请求通道出现之前，仍是"携带但未消费"。
3. **并行后汇合** — **已落地**：`FlowJoinNode`，加上互斥跳过与扇出处等待编译（[flow-join-node](../../implemented/architecture/2026-08-30-flow-join-node.zh.md)）。
4. **试跑节点 I/O** — **已落地**：`FlowRunSnapshot.nodeOutputs` / `nodeDurationsMs`；ModeComposer 上次运行展示。
5. **HITL / 媒体节点** — 延后至内置模式模板需要时。
6. **中途恢复** — 延后。

## 未决问题

- `childPresetId` 是否应要求子 Agent 提供方能力标志（如 `agentOptions`），或仅作同进程覆盖。
- 模式试跑应是设置内本地 `flowEngine.run`，还是始终先创建可见会话。

## 成功标准

- [x] 带 `childPresetId` 的模式 agent 节点为子 Agent 挂载该预设，并记入子会话头。
- [x] 带显式 `join` 的并行扇出可通过校验并编译；扇出后在非 join 处汇聚仍会被拒绝。
- [x] 流程 agent 节点上的 `modelKinds` 在无密钥测试中改变子请求路由。
