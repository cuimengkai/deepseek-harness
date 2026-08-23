# Agent Note: 按 kind 的模型绑定在 flow 线路上幸存

Status: implemented

[English](2026-08-23-flow-modelkinds-wire.md) | 中文

## 问题

流程画布节点检查器会在每个携带图的 `flow.*` 调用上发送按 kind 的模型路由（`agentOptions.modelKinds`），但 `flowAgentNodeSchema`（`packages/host/apiproxy/src/api/flow.schema.ts`）在 `agentOptions` 下只声明了 `provider`/`model`。Zod 对象 schema 默认丢弃未知键，因此按 kind 的绑定在保存时被静默剥离，也从不出现在 run、get 或 list 的读回里——客户端以为持久化了一条引擎从未收到的路由。

## 决策

`flowAgentNodeSchema` 现在声明 `modelKinds: z.record(z.string(), z.object({ provider: z.string().optional(), model: z.string().optional() })).optional()`，锚定的 `satisfies z.ZodType<Wire<...>>` 类型也获得匹配的 `Record<string, { provider?, model? }>`。键是任意字符串，因为线路并不认识可合并扩展的 `ModelKindMap`；record 值 schema 会拒绝畸形绑定而不是丢弃它。由于 save、run、get、list 都共享 `flowGraphSchema`，这一次 schema 编辑修复了整个表面。

## 备选方案

- **`ModelKind` 的有限枚举** —— `ModelKindMap` 设计上可合并扩展，闭合的 `z.enum` 会拒绝未来的 kind，并迫使每加一个 kind 就改一次线路；任意字符串键保持线路开放，而值 schema 仍校验形状。
- **静默丢弃（现状）** —— 缺陷正是静默剥离；`z.record` 值 schema 会在边界拒绝畸形绑定，而不是在保存时丢失它。
- **`Record<string, unknown>` 值** —— 丢失了锚定的 `satisfies z.ZodType<Wire<...>>` 类型所承诺的 provider/model 字符串校验；record 值 schema 让运行时与类型保持一致。
- **提升 `FLOW_FORMAT_VERSION`** —— 该字段是增量式的，该常量只门控持久化，因此无需格式升级。

## 后果

- 按 kind 的路由原样往返；不是 provider/model 字符串对象的绑定会在线路边界被拒绝，而不是被静默丢弃。
- 无需版本提升：该字段是增量式的，`FLOW_FORMAT_VERSION` 只门控持久化。
