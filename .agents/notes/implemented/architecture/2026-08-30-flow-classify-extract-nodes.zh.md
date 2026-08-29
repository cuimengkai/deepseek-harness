# Agent Note：流程 Question Classifier 与 Parameter Extractor 节点

Status: implemented

[English](2026-08-30-flow-classify-extract-nodes.md) | 中文

## 问题

流程画布已有脚本域辅助节点（template、aggregate、list）和主机往返节点（http、code），但没有专用的 LLM 结构化节点。Dify 的面板有 Question Classifier（把输入分到互斥类别再分支）和 Parameter Extractor（填入一组命名参数）。作者可以用普通 `agent` 再加后续 `condition` 来假装这两种能力，但这会让 `agent` 超载（它的契约是「运行子 agent 提示词」），类别边也没有标签，互斥分析会把合法汇合当成并行合并而拒绝。

## 决定

1. **`FlowClassifyNode`**（`type: 'classify'`）携带 `query`（JS 模板字符串）与 `classes: { id, name? }[]`。`validateFlow` 要求查询非空、至少两个互不相同的非空类别 id，并保留 `default` 作为未匹配标签。每个类别 id 需要恰好一条出边；`default` 可选。编译生成 `agent(instruction, { phase, schema: { class: enum } })`，再生成互斥的 `if (_cls === id) visit(...)` 分支；结构化结果为 null / 未知时访问 `default` 或返回 `OUT`。类别分叉与 condition 一样互斥。
2. **`FlowExtractNode`**（`type: 'extract'`）携带 `query` 与 `parameters: { name, type, description?, required? }[]`，`type` 属于 `string | number | integer | boolean`。编译生成 `agent(instruction, { phase, schema })`，schema 即该对象，然后按无标签延续（终止 / 一条边 / `parallel()` 扇出），与 agent 相同。`graphToRows` 拒绝这两种类型。
3. **运行面沿用 `agent`，而非 `phase()`** — 两种节点都做真实的 `agent()` 主机往返，因此 `service.ts` 已通过 `agent-start`/`agent-end` 推动它们。没有新钩子。
4. **画布** — 分类器放在 Logic 面板分组；抽取器放在 Transform。检查器是查询文本域，外加 `id: name`（分类）或 `name[!]: type description`（抽取）行。

## 考虑过的替代方案

- **继续把它们做成配置过的 `agent` 节点** — 已拒绝：类别边会保持无标签，互斥分析会拒绝合法汇合，检查器也会把 schema 契约藏进自由提示词。
- **只给 classify 一个脚本域 `phase()` 门** — 已拒绝：这项工作是一次 LLM 调用；把它包成门会让 Last Run 看不到 `agent-start`/`agent-end`。

## 后果

- classify 之后的汇合是合法的；extract 扇出后的汇合在 join 落地前仍会被拒绝。
- 编译出的 schema 是 `agent({ schema })` 已经强制的封闭 `assertObjectJsonSchema` 子集。

## 测试

无密钥：`packages/workflow/flow/tests/{compile,validate,service}.spec.ts`（schema 生成、default 回退、子图 query 改写、类别边校验、互斥汇合、`agent-start`/`agent-end` 状态）。`packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` 覆盖默认值、类型解析、检查器文本与分类边接线。新检查器字段尚无客户端渲染测试——与 HTTP/Template/Code/Aggregator 是同一笔债务。
