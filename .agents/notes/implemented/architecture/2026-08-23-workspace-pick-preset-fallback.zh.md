# Agent Note: Workspace-pick fallback for unservable presets

Status: implemented

[English](2026-08-23-workspace-pick-preset-fallback.md) | 中文

## 问题

工作区选择可以命名一个 agent preset（hero chip 在 connect 前先暂存一个）。当该 preset 无法解析或挂载时，host 的新建分支抛出 `UnknownPresetError` 或 `PresetMountError`，整个 `session.create` 失败，选择被回滚并报错。一个只是失效的 preset——被删除，或损坏到无法挂载——就能把一次常规的工作区切换变成硬失败。

另外，客户端的 `pendingAgentPreset`（每次暂存都会设置）只在 connect 内部的 `takePendingAgentPreset` 里清除。一次没有经历 connect 就结算的暂存——因会话已启动或已运行它而被判为不可服务丢弃，或被 host 拒绝——会把 pending preset 留在原地，之后一次不相关的 connect 悄悄把它带到一个用户从未为它选择过的会话上。

## 决策

两处作用域受限的改动让选择在预设问题上变得有韧性，同时不削弱身份规则。

1. **新建分支回退到部署默认。** `ensureSession` 的 `createFreshAgent` 先尝试请求的 preset，在 `UnknownPresetError`（解析失败）或 `PresetMountError`（setup 挂载失败）时改用 `undefined`——即部署默认重试。只有新建分支使用这个回退：create 已干净回滚（setup 拒绝不会发布任一 id），所以同一 sessionId 重试是安全的。采纳与恢复保持严格拒绝——它们组装会话已运行的 preset，坏的存储组装继续大声拒绝，好让它的所有者修复。记忆化的 `sessionCreations` 现在解析为 `{ agent, effectiveRequest }`，最后的 `assertPresetUnchanged` 门槛用有效请求——create 实际兑现的预设——对比产出的 agent，因此回退结果（agent 落在默认上）不会被当作请求预设不匹配而拒绝。

2. **已结算的暂存清除 workspace pending。** workspaces 服务新增 `clearPendingAgentPreset()`，seat 通过新的 `onStageSettled` 回调报告暂存结算，该回调在三个暂存消费点触发：判为不可服务丢弃、成功应用、被拒绝。每个点都清除 workspace pending，因此过期的暂存 preset 永不搭乘之后不相关的 connect。

## 备选方案

- **只对解析失败回退，不对挂载失败回退** —— 最初的修复覆盖 `UnknownPresetError`，但不覆盖 `PresetMountError`，后者在 `ctx.agents.create` 期间从 setup 的 `presets.mount` 抛出。把整个 create 包进回退同时关闭两条路径，回滚也让重试安全。
- **让最终门槛继续与请求的 preset 对比** —— 回退会合法地产出一个落在部署默认上的 agent，该门槛会把回退结果当作冲突拒绝。把有效请求穿过记忆化的 creation（按每次创建，而非按每次调用）传递才是修正。
- **在拒绝时消费 pending 而非显式清除** —— seat 无法区分"connect 消费了它"与"connect 失败了"；结算点的 `clearPendingAgentPreset` 由 seat 拥有，它知道暂存何时耗尽。

## 后果

- 命名了坏 preset 的工作区选择仍能打开工作区，落在默认组装上。
- 采纳与恢复保持严格的预设身份：存储预设优先与 `agent-preset-conflict` 均未改变。
- 会话 hero 里的 `workspaceError` alert 现在只对真正的失败（cwd 冲突、忙碌的子代理、host 内部错误）触发——预设问题不再到达它。
- 从未到达会话的暂存在所有地方被丢弃，因此之后的 connect 从部署默认开始。
