---
description: "将 Agent 预设绑定到可执行入口流程的产品模式，供用户与维护者查阅。"
kind: "reference"
---

# @deepseek-ai/dsh-agent-modes

[English](README.md) | 中文

## 摘要

**Agent 模式**是把一个 [Agent 预设](../agent-presets/README.zh.md) 绑定到一张可执行 [流程](../../workflow/flow/README.zh.md) 图的产品单元。用 `agentMode` 创建会话时会解析绑定、挂载具名预设，并在会话头同时写入 `agentMode` 与 `agentPreset`。模式本身不挂载插件，也不取代预设组合器：分支编排落在模式的 `flows/`，能力组合仍在预设里。包内附带运行时标杆样本（`hello-orchestration` → `orchestration-sample`），入口图只用引擎已落地能力（Agent + provider/model、条件、循环、并行扇出、OUT/循环插值）；用户模式落在 `$DSH_HOME/.agent-modes`。

## 磁盘布局

```
<mode-id>/
  mode.yml                 # optional display metadata
  bind.yml                 # preset + entryFlow + defaultArgs
  flows/<id>.flow.json     # FlowGraph documents (formatVersion 1)
```

`includeUserRoot` 为真时，用户模式落在 `$DSH_HOME/.agent-modes`。`includeShippedRoot` 默认开启，以便看到包内 `modes/` 下的学习样本。

## 配置

| 字段 | 默认 | 作用 |
|---|---|---|
| `default` | 未设 | 调用方未指名时的模式 id |
| `roots` | `[]` | 额外扫描根（`path`、`trust`） |
| `includeShippedRoot` | `true` | 前置包内 `modes/` 根（含 `hello-orchestration`） |
| `includeUserRoot` | `true` | 追加 `$DSH_HOME/.agent-modes` |

## 服务 API（`ctx.agentModes`）

| 方法 | 作用 |
|---|---|
| `list` / `resolve` | 名册发现（损坏模式仍可见） |
| `resolveBind` | 健康绑定（`preset`、`entryFlow`、`defaultArgs`） |
| `readEntryFlow` / `readFlow` / `saveFlow` | 模式自有流程文档 |
| `create` / `updateBind` / `copy` / `write` / `remove` | 用户根写作 |
| `select` | 空白会话切换：重挂绑定预设并记录模式 |
| `tryRun` / `getTryRun` | 画布试跑：经 `flowEngine` 在会话 Agent 下执行 |
| `startEntry` | 场景会话启动：在活 Agent 下跑绑定的入口流程 |

Remote 命名空间 `agentModes`：`list`、`read`、`readFlow`、`saveFlow`、`create`、`saveBind`、`copy`、`deleteMode`、`select`、`tryRun`、`getTryRun`、`startEntry`。

## 模型体验

### 请求上下文与条件

#### 模型看到什么

本包不直接贡献可见内容。模式只选择挂载哪个预设以及之后可跑哪张流程；工具模式与提示段落来自绑定预设，以及流程启动的子 Agent。

#### Token 影响

无直接贡献。

#### KV Cache 影响

独立——无提示贡献。

## 已知限制与延后工作

- 会话创建会盖章模式并挂载预设，不会自动启动入口流程；客户端在首条用户意图上调用 `agentModes.startEntry`（[场景产品路径](../../../.agents/notes/implemented/architecture/2026-08-29-scenario-agent-product-path.zh.md)）。
- 流程 agent 节点上的 `childPresetId` 会在同进程 one-shot 子 agent（workflow 试跑 / `agent()`）上挂载该预设；可续跑冷恢复在描述符持久化覆盖之前仍会 join 父级。
- 并行扇出后的汇合与 HITL 节点仍属流程引擎后续项；`modelKinds.text` 请求路由已落地（[Agent Note](../../../.agents/notes/implemented/architecture/2026-08-30-agent-loop-modelkinds-text-routing.zh.md)）。
- Web 新建会话英雄芯片尚未接入；创建后用 `session.create({ agentMode })` 或空白会话上的 `select`。
