# Agent Note: 级联物理会话删除 + 持久化删除台账

Status: implemented

[English](2026-08-19-session-deletion.md) | 中文

## 问题

会话持久化是事件溯源 + append-only：持久化日志永不改写，所以会话与磁盘占用无界累积，没有官方清理入口。`SessionPersistence` 没有 delete 操作；唯一的"移除"是手动删文件——搜索索引已能反应（`persistentDeletes`），但没有任何官方入口触发它。

## 决策

增加一个分三层实现的物理删除能力。

1. **持久化 seam**（`SessionPersistence.delete(id)`）：只删除一个会话的持久化日志，返回是否存在工件，且当该 id 活跃时拒绝（`LiveSessionError`）。协调器等待排空的退役 tail、并入 per-id 串行链、拒绝活跃 owner 与进行中的 resume 准备、使 prepared 视图失效，然后调用新的 `PersistenceBackend.deleteStored` hook。JSONL 删除整个会话目录（绝不只删日志文件）；SQLite 执行一次 `DELETE FROM sessions`，依赖已声明的 `ON DELETE CASCADE`。删除后的 id 表现为从未创建：`load` 报 not found、`list` 省略它、之后的 `create` 可复用该 id 开启新生命周期。

2. **级联删除服务**（`@deepseek-ai/dsh-session-deletion`）：面向用户的编排器。`deleteSession(id)` 从合并的 live + 持久化 header 语料计算传递子代理闭包，任一成员活跃时拒绝**整个操作**（不留下部分孤儿树），根优先逐个删除成员，并写一条持久化台账记录。消费者（投影缓存、工作区注册表）通过可选的 `evict`/`forgetSession` 清理各自的 per-session 状态。

3. **用户面**：`/session-delete` 斜杠命令与 `session.delete` host RPC，都把 `LiveSessionError` 映射为稳定的用户/线缆结果。

删除是显式、用户发起的 append-only 例外，不是保留策略：store 级 wipe/保留推迟到容器部署阶段。

## 备选方案

- **软删除/墓碑**：保留审计与撤销，但不释放磁盘，与动机相悖。选中的设计用小而持久的台账记录代替保留内容，让物理删除后的可问责性以极小代价保留。
- **级联放进 seam**：`SessionPersistence` 保持单一职责（每次删一个会话）；血缘是 Consumer 关注点，所以闭包放在删除服务里，而不是后端。
- **复用 `ctx.subagents.listDescendants` 计算闭包**：它需要投影注册表并逐候选折叠读取，删除用不上，且损坏的子日志会阻断删除。改为镜像其血缘规则的轻量 header 遍历。
- **台账按记录 id 键控（追加历史）**：重建的 id 的旧删除会累积；按根 id 键控会覆盖，回答"这个 id 是否删过"而不无界增长。
- **用事件（`session/deleted`）做消费者清理**：直接可选调用让依赖方向保持"新功能依赖既有基础设施"，比既有基础设施依赖新事件类型更便宜。

## 后果

- seam 的 `delete` 与后端无关，协调器处理所有竞态状态；两个后端和所有测试假件都实现 `deleteStored`。
- 级联规则镜像子代理血缘（`origin === 'subagent'` + `parentSession`），整树删除永不孤儿化活跃子节点，也永不破坏"模型可见 ⟺ 可重建"不变量（子会话续跑自包含）。
- `session-query` 无需改动：其 `persistentDeletes` 路径已在下次查询时对消失的会话收敛。
- 物理删除不可恢复；台账是唯一痕迹，用户面要求显式 id（无当前会话默认值）。
