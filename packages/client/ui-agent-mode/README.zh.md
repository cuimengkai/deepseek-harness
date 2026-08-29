---
description: "Web GUI 的 Agent 模式名册与编排画布。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-mode

[English](README.md) | 中文

## 概述

[Agent 模式](../../preset/agent-modes/README.zh.md) 的设置 **Agent** 中心 **编排** 标签：在 `$DSH_HOME/.agent-modes` 下新建与维护用户场景，绑定能力预设，并在类 Dify 的画布上编辑入口 `FlowGraph`。向 `@deepseek-ai/dsh-client-ui-agent-preset` 拥有的中心注册 `settings.agent.tab` 的 `modes`（`/settings/agent?tab=modes`）。**用于新会话** 会开启空白会话并调用 `agentModes.select`，从而盖章 **`agentMode`** 并挂载绑定能力预设，然后返回首页（会话面不再挂场景芯片）。试跑仍经 `agentModes.tryRun` 在当前会话下启动草稿图（不切换该会话预设）。Creator 交接会先保存脏更改，再开空白会话并选择 `cordis` 预设。绑定能力链接打开 `/settings/agent?tab=presets&preset=…`。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 `@deepseek-ai/dsh-client-ui-agent-preset` 和 `@deepseek-ai/dsh-agent-modes` 一起挂载本包；编排标签随即出现在 `/settings/agent?tab=modes` 下。

### 画布节点面板

编排器在 `FlowGraph` 上可放置六种节点：`start`/`end`（结构性）、`agent`（subagent 提示词）、`condition`（JS 布尔分支）、`loop`（`for...of` 的 body/after 分叉）、`http`（`GET` 抓取）、以及 `template`（对先前输出的纯字符串插值，不调用模型）。每种类型都有各自的面板条目、节点卡片预览与检查器字段集；`mode-graph.ts` 拥有所有类型共用的节点编排辅助函数（默认节点形态、id 铸造、出边接线）。

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到什么

本包不贡献可见内容。模式选择与流程写作是主机/客户端界面；运行时模型可见内容来自绑定预设与流程子 Agent。

#### Token 影响

无直接贡献。

#### KV Cache 影响

独立。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 节点面板 / 边上插入 / 连线已支持 Agent、条件、循环、HTTP 请求、Template、Code、聚合、列表、分类、抽取与汇合；HITL 节点仍随流程引擎延后。运行时 `childPresetId` 挂载与试跑 `nodeOutputs` / `nodeDurationsMs` / `nodeInputs` 已随流程引擎落地。
- 场景启动需要已盖章的 `agentMode` 与已打开会话；不会自行创建会话。
- 试跑需要已打开的会话（用于归属子 Agent）；不会自行创建会话。
- `http` 与 `template` 节点类型各自的面板条目、卡片预览与检查器字段尚无客户端渲染测试——`apps/web/tests/orchestration-studio.e2e.ts` 覆盖编排器的通用外壳，但未专门断言任一节点；单元覆盖只覆盖 `tests/mode-graph.client.spec.ts` 中的共用编排辅助函数。

### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：尚未定论的开放设计问题与方向。它明确不具权威性——已交付行为、限制与已接受的理由都在上述章节、包代码与关联的 Agent Note 中。

#### 未来：按节点类型的渲染测试

每一种新的处理节点类型（`http`、`template`，以及此后新增的类型）目前都有引擎侧单元覆盖（`dsh-flow` 的 `compile`/`validate`/`service` 测试）与共用辅助函数覆盖（`mode-graph.client.spec.ts`），但都没有针对其自身在 `ModeComposer.tsx` 中的面板条目、卡片预览或检查器字段的渲染断言。一套按类型划分的渲染测试套件可以补上这个缺口，而不必等待整个编排器达到完整覆盖率。

</details>
