# Agent Note: 流引擎与可视化流程画布

Status: implemented

[English](2026-08-23-flow-engine-and-visual-flow-canvas.md) | 中文

## 问题

agent loop 只运行一条线性轮次链；会话无法用分支与循环编排多个 agent，工作台也没有可视化 surface 用于构建此类工作流。所要求的能力是多 agent 编排加分支，外加用于构建它的画布，并且不重做 loop——"插件而非 loop 改动"规则将该权限保留给扩展点。

## 决策

独立的流能力 `@deepseek-ai/dsh-flow` 通过 `compileFlow` 将可视化 `FlowGraph` 编译为 `dsh-workflow` 脚本，并经 `ctx.workflowEngine.start({ script, meta, parent, signal })` 在主 agent loop 之外运行。`FlowEngine` 服务声明 `inject: ['workflowEngine']`，当引擎未组合时抛出 `FLOW_ENGINE_ABSENT`。图节点为 `start`、`end`、`agent`、`condition` 或 `loop`；引擎仅在 `!== undefined` 时发出 `agentOptions.provider`/`model`，因此清空的字段必须丢弃该键而不是发送空字符串。

host 将每个图持久化为 `<root>/.dsh/flows/<id>.flow.json`——原子写入（0600/0700）、`FLOW_FORMAT_VERSION = 1`、对 kebab-case `id` 的路径穿越防护、拒绝超大或不再合法的文档。apiproxy 域暴露 `flow.list/get/save/delete/run/getRun/listRuns/stop` RPC 链；引擎缺失时回答 `flow-unavailable`。

`@deepseek-ai/dsh-client-ui-flow-editor` 以单个 `conversation.view` 条目（"流程"）在环形顺序 15 渲染画布——排在 trajectory（10）之后、开发模式洞察标签（20+）之前。会话级 `FlowEditorController` 按会话当前 `cwd`（来自 sessions feed）键控，因此工作区切换会为新目录重新加载画布；它列出并打开已保存流程、保存与删除（首次保存时从图名生成 id）、在本地编辑节点与连线、以 JSON 输入框运行（解析失败会在任何线上流量之前拒绝运行）、每 800 ms 轮询 `flow.getRun` 直到运行落定、绘制每个节点的状态并列出运行历史。没有引擎时画布只读并渲染提示。该条目是通用用途，不限定任何 agent preset。

## 验证

流引擎与 apiproxy 域携带单元与 RPC 测试；画布携带 28 个客户端测试，覆盖纯图辅助函数、控制器行为（starter 图、保存/删除、连线拒绝、非法输入拒绝、轮询落定、停止、释放）以及插槽注册（顺序 15、会话级控制器缓存）。客户端 bundle 仅以类型专用 `dsh-flow` 导入构建，客户端聚合类型检查通过，插槽目录重新生成并通过校验，README 三件套通过 `doc-sync`。

## 考虑的替代方案

**在 agent loop 内实现分支。** 已拒绝：为 `agent-loop` 增加条件与循环步骤触及核心，且违反扩展点规则；独立引擎保持 loop 不变。

**无画布的纯 RPC 编排。** 已拒绝：已批准的范围是引擎加可视化画布，因此 web surface 负责编排与观察流程，而不是由模型驱动它们。

**客户端门控引擎。** 已拒绝：引擎缺失时线上报告 `flow-unavailable`，因此画布的只读状态跟随组合的 host，而非客户端启发式。

## 后果

组合了流引擎的会话可以从工作台编排并运行分支多 agent 工作流；没有它的会话只看到只读提示。流程按会话 `cwd` 限定且不共享。v1 仅接受无环图（循环不能携带状态重访节点），并拒绝会聚式并行（并行扇出或循环分支后的合并）；运行状态是轮询而非推送，服务不发出任何 `flow/*` 事件。模型无法在会话中途编排或运行流程——`tool-flow` 消费方延后。
