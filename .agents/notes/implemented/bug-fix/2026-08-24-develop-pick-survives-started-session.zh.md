# Agent Note：develop 选择在已开始的会话下得以存续

Status: implemented

[English](2026-08-24-develop-pick-survives-started-session.md) | 中文

## 问题

当当前会话已经开始运行时，一次 preset 选择会被当作「无法投递」而丢弃。`AgentPresetSeatController.apply()` 在 `onStageSettled`（→ `clearPendingAgentPreset`）中清掉暂存并报告结算，前提是「当前会话已经启动」——其依据是宿主拒绝给已开始的会话更换 preset。这条判断本身没错——切换确实会被拒绝——但「丢弃」的假设是：暂存值针对的是**当前**会话。英雄 chip 的选择指向**下一个**会话，而先于导入做出的 develop 选择正是如此：用户在某个运行中的会话里，为即将导入的项目选择 develop，真正创建该新会话的是导入的 `connectWorkspace`。由于 `apply()` 已经清掉了工作区的 pending，连接的 create 分支让导入的会话落在部署默认值上，develop 模式的自动扫描因此从未触发。

## 决策

当当前会话已经启动时，`apply()` **保留**暂存值，而不是将其结算为「无法投递」。已开始的会话无法接收该选择，但这次选择仍指向下一个连接即将创建的会话，因此暂存值保持 pending，直到某个空白会话出现并消费它——无论是连接的 create 分支把它带进 wire 载荷，还是列表变更应用器把它应用到复用的空白会话。当某个空白会话已运行该 preset、或宿主拒绝/驳回本次应用时，暂存值仍照常结算。

这修订了 [workspace-pick-preset-fallback](../architecture/2026-08-23-workspace-pick-preset-fallback.zh.md) 决策第 2 点：「无法投递」不再是已开始会话的结算点。另外两个结算点——已应用、已拒绝——保持不变，`clearPendingAgentPreset` 仍然在暂存值真正结算后保护后续无关的连接免受陈旧暂存值的影响。

## 备选方案

- **继续丢弃，由导入流程重新暂存** —— 导入入口已经在调用会读取 pending preset 的 `connectWorkspace`，重新暂存就得塞进导入路径内部；这会在第二个地方把工作区连接与 preset 选择耦合起来，而不是唯一的「暂存→记入」机制。
- **只在真正被消费时结算，绝不在拒绝分支结算** —— 这正是所选形态：拒绝分支现在直接返回、不结算，因此针对已开始会话做出的选择，其行为与「当前无会话」时的选择完全一致。

## 影响

- 在运行中的会话当前时做出的 develop 选择会存活到下一个连接，导入项目的会话得以在 develop 下创建，project-insight 自动扫描随之触发。
- 针对已开始会话的暂存值保持粘性：chip 持续显示暂存的选择，直到某个空白会话接收它或宿主拒绝切换。
- `agent-preset-locked` 拒绝仍然存在——seat 从不请求宿主给已开始的会话换 preset——但该拒绝不再取消 pending 的暂存值。
