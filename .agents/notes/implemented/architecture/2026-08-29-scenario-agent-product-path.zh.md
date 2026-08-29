# Agent Note: 场景 Agent 产品路径（设置编写 + 会话能力）

Status: implemented

[English](2026-08-29-scenario-agent-product-path.md) | 中文

## Problem

能力预设与编排模式是正确的运行时拆分，但产品表面在会话屏上把它们卖成两个对等谜题。Hero 上同时挂场景芯片与能力芯片会争夺注意力，并暗示会话绑定了两个对等选择。会话壳也缺少主流三栏习惯（侧栏任务 · 中间对话 · 右侧结果）。

## Decision

- **会话壳**对齐 WorkBuddy 式三栏：侧栏管任务，中间管对话与作曲器，右侧 `details` 重定义为结果栏（[结果栏笔记](2026-08-29-results-panel-as-details.zh.md)）。一级导航、助理空态分类与诚实的项目/自动化占位由 [WorkBuddy 最终 IA 笔记](2026-08-29-workbuddy-final-ia.zh.md) 拥有。
- **会话**只绑定**能力**（`agentPresets.select`）。作曲器工具行在权限控件**之后**展示能力芯片（`conversation.input.left`，order −10）。
- **场景**（= 模式：绑定能力 + 入口 flow）在 Agent 设置中心编写与试跑。**用于新会话**只把模式的**绑定预设**暂存到空白会话——不在会话面暴露场景芯片或开始 dock。
- **不要**在 `session.create` 上空跑入口 flow。设置试跑在构建者需要时仍用当前会话 agent 下的 `agentModes.tryRun` / `startEntry`。
- 空态保留品牌 + 分类芯片 + 能力快捷行 + 工作区芯片 + 同一套作曲器；无引导卡或场景 dock。
- 文案：会话面 = Capabilities / 能力；构建面 = Scenario agent / 场景 Agent，含 Capabilities + Orchestration 标签。

## Alternatives considered

- **场景优先 Hero + 开始 dock** — 否决：会话铬过载；能力才是会话的持久绑定。
- **创建时静默空输入自动 start** — 否决：Chatflow 类应用需要用户意图作为 flow 输入（[绑定笔记](2026-08-29-agent-modes-preset-flow-binding.zh.md)）。
- **把预设与模式压成同一磁盘格式** — 否决：挂载与可执行图保持分包装。
- **为结果新增 AppFrame 第四列** — 否决；重定义 `details` 由结果栏笔记拥有。

## Consequences

- `dsh-client-ui-agent-preset` 拥有作曲器能力芯片、顶栏标签、hero 分类芯片与空白会话能力快捷行；`dsh-client-ui-agent-mode` 只拥有设置编排（无会话场景 dock）。
- Hero 座位 `conversation.hero.agentMode` 仍声明但未使用；`conversation.hero.agentPreset` 承载分类芯片。
- Chat 拥有结果壳与顶栏结果开关；工具检视是结果栏的一个标签。

## Testing

空白会话上的 seat select 与作曲器 `conversation.input.left` 注册有单测。设置试跑 / `startEntry` 仍由 agent-modes host 测试覆盖。结果注册与顶栏开关由 ui-chat / ui-layout 测试覆盖；Playwright 冒烟在产物冷播种会话上打开结果栏。
