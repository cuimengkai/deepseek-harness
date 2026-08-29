# Agent Note：流程 Variable Aggregator 与 List Operator 节点

Status: implemented

[English](2026-08-30-flow-aggregate-list-nodes.md) | 中文

## 问题

流程画布此前有八种节点类型，却没有一种脚本域方式能把若干上游输出组合起来，或对列表取首项/末项/长度，而不调用 `agent` 或 Code 节点。Dify 的面板恰好为此提供了 Variable Aggregator（命名输入 → 一个变量）和 List Operator（首项/末项/长度/反转/展平）。并行扇出后的汇合仍被拒绝，因此那种会*等待*并发分支的 Dify 式聚合器现在还做不到；现在能落地的，是对串行或互斥分支输出的组合，外加封闭的列表运算符。

## 决定

1. **`FlowAggregateNode`**（`type: 'aggregate'`）携带 `items: { name, expression }[]` 与 `mode: 'object' | 'first' | 'concat'`。`validateFlow` 要求至少一条、名称非空且唯一、表达式非空、模式已知。`compile.ts` 生成 `phase(id)`，再生成一个脚本域 IIFE，求值每条表达式（信任模型与 condition 相同）并组合：`object` 写成 `{ [name]: value }`，`first` 返回第一个非空值，`concat` 展平数组并包装标量。`expand.ts` 改写每条表达式里的 `OUT[...]`。
2. **`FlowListNode`**（`type: 'list'`）携带 `source`（JS 表达式）与 `op: 'first' | 'last' | 'length' | 'reverse' | 'flatten'`。`validateFlow` 拒绝空来源或未知运算符。编译生成 `phase(id)`，再生成一个 IIFE：非数组会变成单元素列表（`null`/`undefined` → `[]`），然后应用运算符。按谓词过滤暂缓：v1 只提供封闭的 `op` 集合。
3. **运行面沿用 template，而非 http** — 两种节点都是同步的脚本域表达式，因此 `service.ts` 在 `phase(id)` 处把它们标为 `running`，由下一个节点事件或 `workflow/end` 结算。没有新的主机钩子，也没有 `workflow/node-start` 事件对。
4. **画布** — Transform 面板分组新增聚合与列表运算；检查器是模式/运算符选择，外加 `name: expression` 文本域（聚合）或来源文本域（列表）。`graphToRows` 拒绝这两种类型，与 `http`/`template`/`code` 相同。

## 考虑过的替代方案

- **等到 A3 的 join 落地再加聚合器** — 已拒绝：互斥的 condition 汇合已经存在，串行组合与列表运算在没有 join 时也有用。该节点写明它不会等待并行分支。
- **一种带开放表达式语言的节点** — 已拒绝：自由形式的归约就是 Code 节点。封闭的 `mode`/`op` 标签让校验和检查器可枚举。
- **给这些节点 `workflow/node-start`/`node-end`** — 已拒绝，理由与 template 相同：没有需要叙述的主机往返。

## 后果

- 并行扇出之后的聚合器仍会被互斥分析拒绝；在 join 落地之前，作者只能组合互斥分支或串行输出。
- 按表达式过滤/映射/排序仍然走 Code 节点，而不是在 `list` 上再发明一种语言。

## 测试

无密钥：`packages/workflow/flow/tests/{compile,validate,service}.spec.ts`（编译含扇出与子图改写；空/重复/未知模式校验；基于 `phase` 的状态）。`packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` 覆盖默认值、类型解析与条目文本往返。新检查器字段尚无客户端渲染测试——与 HTTP/Template/Code 是同一笔债务。
