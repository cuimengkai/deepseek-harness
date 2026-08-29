# Agent Note: `AgentOptions.modelKinds.text` 覆盖引擎唯一的请求通道

Status: implemented

[English](2026-08-30-agent-loop-modelkinds-text-routing.md) | 中文

## 问题

`AgentOptions.modelKinds`、`FlowAgentOptions.modelKinds`，以及 worker-thread `agent()` 调用的 `modelKinds` 选项，此前已经端到端携带了每个 [`ModelKind`](../../../../packages/llm/llm/src/types.ts) 的 provider/model 覆盖——编译发射、worker 校验、`ChildStartRequest`，一直到挂载的子 Agent 的持久化 `AgentOptions`——但每一层自己的注释都写着"声明而已，直到请求路由消费类型为止"。请求时从没有任何地方读取过这个字段，因此在流程 agent 节点上设置 `modelKinds` 对该节点子 Agent 实际发起模型调用的方式毫无影响。

## 决策

`dsh-agent-loop` 唯一的请求通道永远是 [`ModelKind`](../../../../packages/llm/llm/src/types.ts) 中的 `text`——该循环只有一个 waterfall（`agent/request`），且它总是服务于轮次/步骤的对话循环，绝不服务于图像、音频或嵌入调用。因此 `ReactLoopAgent.buildRequest`（[packages/core/agent-loop/src/agent.ts](../../../../packages/core/agent-loop/src/agent.ts)）把基础路由播种为 `{ provider: modelKinds?.text?.provider ?? options.provider, model: modelKinds?.text?.model ?? options.model }`，而不再总是直接读取 `options.provider`/`options.model`。`modelKinds.text` 绑定的任一侧都可缺省，从同名的基础字段继承，与其余每一种按类型绑定所声明的语义一致。这个种子仍然只在该循环实例的首次请求上生效（后续轮次仍从持久化的头恢复，与此前一致）；`agent/request` waterfall（实时模型切换、`dsh-core/agent` 的 `model-selection.ts`）之后仍会运行，仍可进一步覆盖。

其余类型（`image`、`audio`、`embedding`）仍会被携带进子 Agent 的 `AgentOptions.modelKinds`，但没有实际消费者：本代码库中还没有任何请求通道会发出图像、音频或嵌入调用。所有把这称为"声明而已"的 JSDoc 均已更新，说明哪个类型已生效、其余为何尚未生效。

## 考虑过的替代方案

- **给 `agent/request` waterfall 载荷加一个 `kind` 参数** — 否决：目前没有任何调用方有第二种类型可传（见上文）；在没有调用方实际使用的情况下加一个未使用的参数，是投机性的接口面，违背本仓库"无硬编码可调项"/"在使用点显式"的约定。等真正的图像/音频/嵌入请求通道出现时再重新考虑。
- **在 `dsh-workflow-flow` / `dsh-workflow-worker-thread` 中解析 `modelKinds`，而不是在 `dsh-agent-loop`** — 否决：这两个包只组装子 Agent 的 `AgentOptions`，自己从不发起模型请求；在那里解析会与循环自身的 provider/model 优先级逻辑重复，而不是与其组合。

## 后果

- 流程 agent 节点的 `agentOptions.modelKinds.text` 现在会改变已编译 `agent()` 调用子 Agent *实时*的 provider/model，而不只是其持久化选项——补齐了[模式编排引擎后续缺口](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.zh.md)中的验收标准。
- `image`/`audio`/`embedding` 绑定在其自身的请求通道出现之前仍不生效；该通道的设计（以及是否复用同样的播种形态）留待后续决定，本文不作决定。
- 并行扇出后的汇合是 Track A 中引擎后续缺口一栏仍剩的唯一一项。

## 测试

无密钥：`packages/core/agent-loop/tests/agent.spec.ts`（`modelKinds.text` 覆盖把请求路由到另一个已注册的 provider/model；部分覆盖从基础路由继承缺失字段；另一类型的 `modelKinds` 条目从不影响 text 请求）。
