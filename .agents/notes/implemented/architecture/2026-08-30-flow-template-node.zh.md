# Agent Note：流程 Template 节点（纯字符串插值，不调用 LLM）

Status: implemented

[English](2026-08-30-flow-template-node.md) | 中文

## 问题

流程画布（[packages/workflow/flow](../../../../packages/workflow/flow)）此前有六种节点类型（`start`/`end`/`agent`/`condition`/`loop`/`http`），却没有一种方式能把上游输出插值成字符串而不启动一个 subagent——而 Dify 的节点面板恰好为此提供了一个专属的 Template 节点：纯字符串插值，不调用模型。在此之前，画布作者如果只需要 `"Hello ${OUT['fetch-name']}"`，就得编写一个提示词恰好不需要补全的 `agent` 节点，这既浪费一次 subagent 调用，又是一个误导性的节点（`agent` 节点的契约是"运行一次 subagent 提示词"，不是"惰性插值"）。

## 决定

1. **`FlowTemplateNode`**（[types.ts](../../../../packages/workflow/flow/src/types.ts)）携带一个必填的 `template`（JS 模板字符串表达式，插值规则与 agent 提示词或 `http` 节点的 `url` 相同：`${variable}`、`${OUT['<nodeId>']}`）。`validateFlow` 拒绝空的 `template`；`compile.ts` 的 `templateBody` 复用了既有的 `templateLiteral` 辅助函数（agent 提示词已在用）同步生成 `OUT[id] = \`...\``——不调用钩子，不发生主机往返——再访问其出边（有多条出边时同 agent 一样通过 `parallel()` 扇出）。`expand.ts` 按照改写提示词与 `http` `url` 的同一方式，改写子图 `template` 中的 `OUT[...]` 引用。
2. **运行面追踪沿用 `condition`/`loop`，而非 `http`**——template 节点没有子生命周期事件对来推动它经过 `running`：`service.ts` 的 `onPhase` 在其编译出的 `phase(id)` 调用处把它标记为 `running`，交由下一个节点事件（或 `workflow/end`）结算，与 condition/loop 门完全一致。`http` 节点的 `workflow/node-start`/`node-end` 事件对之所以存在，正是因为该节点发生了主机往返；而 template 节点的函数体是同步的脚本域表达式，因此获得门式处理，而非生命周期事件对。
3. **不引入新的插值语法**——该节点复用了 agent 提示词和 `http` `url` 已经在用的同一套 `templateLiteral`/`rewriteOutRefs` 机制，将其形式化为独立节点类型纯粹是为了与 Dify 的命名对齐，并停止在画布词汇中把"subagent 提示词"与"纯插值"混为一谈。
4. **画布接线**——`mode-graph.ts` 把 `template` 加入可放置节点类型及其自身的 `wireOutgoing` 扇出分支；`ModeComposer.tsx` 新增一个"Transform"面板分组，含 Template 条目、节点卡片预览与模板源码检查器文本域（`setSelectedTemplate` 动作沿用既有的 `setSelectedUrl`/`setSelectedExpression` 模式）；`AgentModeSection.module.css` 新增该节点的图标/卡片/类型样式（琥珀色，与 `http` 的颜色区分）。
5. **Preset 组合图拒绝 `template` 节点**——`packages/preset/agent-presets/src/conversion.ts` 的 `graphToRows` 对 `template` 节点抛错，与它已对 `condition`/`loop`/`http` 所做的完全一致：preset 行是 agent 组合条目，而 template 节点不携带任何可投影到其上的 agent 语义。

## 考虑过的替代方案

- **像 `http` 一样为 `template` 单独设一对 `workflow/node-start`/`node-end` 事件**——拒绝：该事件对的存在是为了叙述一次主机往返的开始与结束；template 节点的函数体从不离开脚本域，因此用 `phase()` 门包裹它（condition/loop 已如此）才是正确的处理方式，也不会给 `dsh-workflow` 的 `invariant.ts` 增加新的事件配对不变式需要维护。
- **让 `agent` 节点通过永不发起补全来表达纯插值**——拒绝，这正是本节点要修复的现状：它在画布、校验与运行面上都与一个配置错误的 agent 节点难以区分，并且仍要为它不需要的 subagent 请求生命周期付出代价。
- **引入 Jinja/Handlebars 语法而非 JS 模板字符串**——拒绝：JS 模板字符串已经是 agent 提示词与 `http` 节点 `url` 的插值语言；引入第二套模板语法会让 `expand.ts` 的 `OUT` 引用改写逻辑为同一功能维护两套不同的解析器（按路线图的目标是"与 Dify 命名对齐"，不是"与 Dify 语法对齐"）。

## 后果

- template 节点与 agent 或 http 节点完全一致地参与今天仅支持互斥合并的规则：它可以通过 `parallel()` 扇出，但不能作为两条分支的汇聚点（并行后汇合仍属后续工作，见 [engine followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.zh.md)）。
- 未来每一个非 agent、非主机往返的节点（例如脚本域的 Aggregator/List Operator）现在有第二个可循的先例，与 `http` 的主机往返先例并列：`service.ts` 对纯脚本域节点采用基于 `phase` 的运行面处理，对主机往返节点采用 node-start/node-end 处理。
- 不新增对 `dsh-web` 或工作流 worker 线程 `http()` 钩子的依赖：即使在从未加载 `dsh-web` 的组合中，template 节点也能正常编译与运行。

## 测试

无需密钥：`packages/workflow/flow/tests/{compile,validate,service}.spec.ts`（template 节点编译，包括扇出与子图 `template` 改写、空 `template` 校验、分支标签与扇出互斥性检查、基于 `phase` 的生命周期投影到 `nodeStatuses`/`nodeOutputs`）。`packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts`（新文件）以 100% 语句/分支覆盖率覆盖 `mode-graph.ts` 的节点编排辅助函数，包括 `template` 节点的默认工厂、类型解析与出边接线。`ModeComposer.tsx` 中新增的 Template 面板条目、卡片与检查器字段尚无客户端渲染测试——与 Checklist 面板（[mode-composer-checklist-gating](2026-08-30-mode-composer-checklist-gating.zh.md)）以及 HTTP 节点（[flow-http-node](2026-08-30-flow-http-node.zh.md)）同样的技术债；`apps/web/tests/orchestration-studio.e2e.ts` 覆盖编排器的通用外壳，但未专门断言 Template 节点。
