# Agent Note: Worker diagnostics stay out of the captured log ledger

Status: implemented

[English](2026-08-27-worker-diagnostic-suppression.md) | 中文

## Problem

`WorkerThreadCodeRuntime` 为每次运行各起一个 worker，其入口（未构建时的 `src/worker.ts`）通过 Node 原生类型剥离加载。在该特性仍属实验性的 Node 版本上——v24.0.0，落在仓库支持的 `>=24` 范围内——每个新 worker 都会向 stderr 打印 `(node) ExperimentalWarning: Type Stripping is an experimental feature`。运行时的兜底管道捕获把原生 stderr 写入当作杂散日志追加进模型运行的日志账本，于是在这些版本上每次运行都携带约 150 字节程序从未写过的 Node 自身诊断。十八个断言精确日志内容的 runtime 规格失败，spill-policy 背压测试死锁：它 100 字节的 inline 预算把警告本身变成一次对挂起后端的 spill，通道因此永远到不了测试所等待的派发。

## Decision

worker 启动传入 `execArgv: ['--disable-warning=ExperimentalWarning']`（此前为 `[]`）。账本的契约是只记录程序输出、不记录宿主进程诊断，且该契约必须在 engines 范围允许的每个 Node 版本上成立；此标志在源头消除告警，同时保持启动的封闭性——不从宿主运行器的 execArgv 继承任何内容。workflow worker 不受影响：它通过 tsx 转换而非原生类型剥离加载。

## Alternatives considered

- **在杂散 stderr 捕获里过滤警告文本** —— 捕获层将不得不解析 Node 的诊断格式，而那不是稳定接口；措辞一变污染就会悄悄回归。
- **把 v24.0.0 视为不支持** —— engines 范围刻意允许它，且告警属于运行时的属性，不属于账本所要记录的模型代码。

## Consequences

- worker 日志捕获在受支持的 Node 范围内确定一致；v24.0.0 上的运行不再携带该诊断。
- worker 内来自 Node 内部的其他实验特性告警也被抑制——可接受，因为 worker 本就封闭设计：模型代码没有环境通道，也没有测试或消费者从 worker 管道读取 Node 诊断。
- execArgv 不再字面为空，这一点在启动处的注释中可见；它所记录的封闭规则（不引入宿主 loader 钩子）仍然成立。
