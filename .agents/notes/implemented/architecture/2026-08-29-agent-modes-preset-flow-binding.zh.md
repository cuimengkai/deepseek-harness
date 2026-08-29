# Agent Note: 产品模式把预设绑定到可执行流程

Status: implemented

[English](2026-08-29-agent-modes-preset-flow-binding.md) | 中文

## 问题

用户在创建短视频生成、多人有声剧等产品模式时，希望有 Dify 式交互编排：每节点模型、分支与多 Agent 协作。Agent 预设画布正确地拒绝分支，因为 `agent.cordis.yml` 是无运行时边的有序插件列表（[预设画布笔记](2026-08-23-agent-preset-canvas-composer.zh.md)）。把编排塞进预设格式会发明挂载无法表达的交互。

## 决策

引入并行产品单元 **Agent 模式**：`Mode = 预设绑定 + 入口 FlowGraph + 展示元数据`。模式落在 `packages/preset/agent-modes`（`ctx.agentModes`），磁盘布局为 `mode.yml` / `bind.yml` / `flows/<id>.flow.json`。会话创建接受 `agentMode`，解析 `bind.preset`，挂载该预设，并在会话头同时盖章 `agentMode` 与 `agentPreset`。分支编排仍在 `dsh-flow`；能力组合仍在 `dsh-agent-presets`。Web Agent 中心页（`/settings/agent`）以同页标签承载预设与模式（`dsh-client-ui-agent-preset` 拥有中心壳与预设标签；`dsh-client-ui-agent-mode` 注册模式标签），支持在 `$DSH_HOME/.agent-modes` 下**新建**、绑定与编辑模式。包内附带学习样本对：预设 `orchestration-sample` 与模式 `hello-orchestration`（只读，复制后再改）。样本入口图是**运行时标杆**：只用引擎已落地能力——带 `${OUT[…]}` / 循环变量插值的 Agent 提示词、节点级 `provider`/`model`、条件 `true`/`false`、循环 `body`/`after`、以及不汇合的并行扇出。样本不含未落地编辑字段（`childPresetId`、`modelKinds` 路由、汇合、HITL、子图）。`includeShippedRoot` 默认开启以便看到该样本。只读画布仍挂载 React Flow 的 Handle，以便内置样本的连线能渲染。

`FlowAgentNode.childPresetId` 会发射进 `agent()` 选项；workflow worker 在子启动请求上转发它，同进程子组合在设置时挂载该预设（并盖章子会话头），而不再 join 父级。

## 考虑过的替代方案

- **在预设组合画布上做分支** — 否决：组合是挂载时行列表；条件/循环边没有挂载语义（[画布笔记](2026-08-23-agent-preset-canvas-composer.zh.md)）。
- **仅把模式流程存进 `.dsh/flows`** — 否决：模式入口流程与绑定一样是部署范围，不是引擎会话流程那种工作区范围。
- **会话创建时自动启动入口流程** — 当时延后、现否决空跑：创建只盖章并挂载；客户端在首条用户意图上调用 `agentModes.startEntry` / `flowEngine.run`（[场景产品路径](2026-08-29-scenario-agent-product-path.zh.md)）。

## 后果

- `agentModes` 相对 `agentPresets` 可选；无模式的部署仍走仅预设路径。
- 会话头增加可选 `agentMode`，不提升 `SESSION_FORMAT_VERSION`（预发布：无磁盘兼容承诺）。
- 模式 Remote 命名空间经 `dsh-api-remotes` 与 `agentPresets` 并列挂载。
- 仍延后的引擎项：并行汇合、HITL 节点与 `modelKinds` 请求路由（[引擎后续](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.zh.md)；[childPresetId 运行时](2026-08-30-flow-child-preset-and-try-run-io.zh.md)）。

## 测试

无密钥的 `packages/preset/agent-modes/tests` 覆盖发现、绑定健康、新建/更新绑定/复制/删除、空内置根、会话投影与不变式伴件。会话控制器创建把 `UnknownModeError` / `ModeInvalidError` 映射为 Remote 码。
