# Agent Note: 流程 childPresetId 运行时与试跑节点 I/O

Status: implemented

[English](2026-08-30-flow-child-preset-and-try-run-io.md) | 中文

## 问题

模式编排图需要 Dify 式 SYSTEM/USER 写作、按节点子预设，以及 Last Run 查看节点状态、耗时与输出。此前编译仅把 `childPresetId` 当作写作字段；试跑快照只有 `nodeStatuses`，ModeComposer 无法展示输出或耗时。

## 决策

1. **`FlowAgentNode.systemPrompt`** — 可选；非内嵌 agent 校验要求 `systemPrompt` / `prompt` 至少一者非空；编译用同一模板字面量把 system 与 user 以空行拼接。
2. **`childPresetId` 运行时** — 编译发射进 `agent()` 选项；worker-thread 引擎校验并在 `ChildStartRequest` / `SubagentStartRequest` 上转发；`applyChildComposition` 在设置时（异步）挂载该预设，而不再 `composeFrom`；`childSessionMeta` 盖章子会话头 `agentPreset`。不新增 subagent 能力位（同进程覆盖）。
3. **试跑 I/O** — `FlowRunSnapshot` 增加 `nodeDurationsMs`（agent-start → agent-end）与 `nodeOutputs`（完成脚本返回的 `OUT`）；`getTryRun` / ModeComposer Last Run 消费它们。

## 考虑过的替代方案

- **像 `agentOptions` 一样给 `childPresetId` 能力门** — 暂否：只有带 `agentPresets` 的同进程驱动能挂载；进程外提供方忽略该字段。
- **在 `workflow/agent-end` 上流式输出** — 延后：事件载荷无结果值；完成后的 `OUT` 已够 Last Run。

## 后果

- 可续跑冷恢复在描述符持久化 `childPresetId` 之前仍会 join 父级。
- 并行汇合与 `modelKinds` 请求路由仍延后（[引擎后续](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.zh.md)）。

## 测试

无密钥：`packages/workflow/flow/tests`（compile/validate/service）、`packages/workflow/workflow-worker-thread/tests`（选项转发）、`packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts`（挂载 + 头盖章）。
