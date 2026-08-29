# Agent Note：流程 Join 节点（并行扇出后的显式汇合）

Status: implemented

[English](2026-08-30-flow-join-node.md) | 中文

## 问题

`validateFlow` 拒绝任何入边分支都可能执行的汇聚。condition 或 classify 类别分叉是互斥的，因此那些汇聚合法；并行扇出并不互斥，因此两条臂在 agent、template 或 aggregator 上相遇会被拒绝。Dify 的面板用显式 Join 做这种汇合。没有它，画布可以扇出，但无法等待后再继续一次。

## 决定

1. **`FlowJoinNode`**（`type: 'join'`）没有额外字段。`validateFlow` 允许至多一条无标签出边，拒绝带标签的边，并在共享后继是 join 时跳过「两条分支都能执行」的汇聚错误。loop body/after 分叉后的汇聚仍会被拒绝。`graphToRows` 拒绝 `join`，与其他非 agent 类型相同。
2. **编译在扇出处等待，而不是在每条臂内部等待。** 仅后继为 join 的臂返回 `OUT`，而不 `visit(join)`。每条臂都是该 join、或仅后继为该 join 的节点时，扇出发射 `await parallel([...]); return await visit(joinId)`。join 函数体是 `phase(id)` 再加无标签延续。join 不可播种。
3. **运行面沿用 template。** `service.ts` 的 `onPhase` 把 `join` 当作 `condition`/`loop`/`template`/`aggregate`/`list`：在 `phase(id)` 时标为 `running`，在下一个节点事件或 `workflow/end` 时结算。
4. **画布** — Join 放在 Logic 面板分组。检查器只有类型/id 提示。字形/卡片/类型使用 `--dsw-static-green-500`。

## 考虑过的替代方案

- **在任意共享后继上隐式汇合** — 已拒绝：扇出后的无标签汇聚会掩盖作者要的是互斥还是并发，互斥分析也不再是响亮失败的检查。
- **给 join 配 `workflow/node-start`/`node-end`** — 已拒绝：该节点不做主机往返；`phase()` 与 template 是同一类门。

## 后果

- 臂共享一个非 join 后继时，没有 join 的扇出仍会被拒绝。
- join 不合并输出；需要一个对象时，作者在 join 之后放聚合器。

## 测试

无密钥：`packages/workflow/flow/tests/{compile,validate,service}.spec.ts`（扇出等待后再访问 join；臂返回 `OUT`；在 join 处汇聚被接受；两条出边和标签被拒绝；基于 `phase` 的状态）。`packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` 覆盖默认工厂与类型解析。面板条目尚无客户端渲染测试——与 HTTP/Template/Code 是同一笔债务。
