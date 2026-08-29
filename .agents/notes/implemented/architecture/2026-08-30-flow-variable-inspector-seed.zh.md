# Agent Note：流程 Variable Inspector 的 seed 与逐节点输入

Status: implemented

[English](2026-08-30-flow-variable-inspector-seed.md) | 中文

## 问题

试跑的 Last Run 能看到 `nodeOutputs` / 耗时，却看不到节点*当时看见了什么*，也无法改一笔缓存输出再只重跑下游——而这正是 Dify Variable Inspector 的模型。为了改一个节点的结果而重跑整张图，会浪费上游每一次 `agent()` / `http()` / `code()` 调用。

## 决定

1. **编译时查阅 `SEED`** — `compileFlow(graph, { seed })` 生成 `const SEED = …`，在每次 `visit(id)` 时记录 `IN[id] = { ...OUT }`；若 `SEED` 含有可播种 id，则写入 `OUT[id] = SEED[id]` 并运行 `SEED_CONT[id]`（该节点的无标签或 classify 延续），而不运行函数体。可播种类型是 agent（非内嵌）、http、template、code、aggregate、list、classify、extract。start/end/condition/loop/内嵌不可播种。
2. **脚本返回 `{ OUT, IN }`** — `applyNodeOutputs` 把该信封拆进 `nodeOutputs` 与 `nodeInputs`；光秃的 `OUT` 映射（桩 / 旧脚本）仍只投影为输出。
3. **`FlowRunRequest.seed`** 与 `agentModes.tryRun(..., seed)` 转发该映射。ModeComposer 的 Last Run 展示选中节点的 `nodeInputs`、可编辑的缓存输出文本域，以及 **从这里重跑**：用上次运行的输出减去选中节点及其后代做成 seed（当编辑后的 JSON 能解析时再写入该值）。

## 考虑过的替代方案

- **把 seed 放进 `args.__dshSeed`** — 已拒绝：会污染作者可见的 `args` 全局变量。
- **只在运行结束后用前驱输出重建输入** — 已拒绝：当 seed 跳过或互斥分支省略了兄弟节点时，那并不是节点当时看见的 `OUT`。

## 后果

- 被播种的 classify 仍根据播种的 `{ class }` 走互斥类别边；null / 未知类别仍走 `default` 或返回 `OUT`。
- 当编辑后的 JSON 能解析时，「从这里重跑」不会重新执行选中节点——它播种该值，只重新执行后代。

## 测试

无密钥：`packages/workflow/flow/tests/{compile,service}.spec.ts`（SEED / SEED_CONT 生成、`{ OUT, IN }` 投影、`run` 转发 seed）。`packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` 覆盖 `descendantIds` / `seedForRerun`。Last Run 文本域尚无客户端渲染测试——与其它检查器字段是同一笔债务。
