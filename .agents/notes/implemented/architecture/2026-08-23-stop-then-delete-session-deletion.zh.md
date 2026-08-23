# Agent Note: Stop-then-delete for session deletion

Status: implemented

[English](2026-08-23-stop-then-delete-session-deletion.md) | 中文

## 问题

[原会话删除 note](2026-08-19-session-deletion.zh.md) 描述的级联删除服务在范围内任一成员活跃时拒绝整个操作。在 web 应用里，会话永久保持活跃：host 的 `ensureSession` 丢弃返回的 agent handle，所以每个使用过的会话都保留着活跃的 `Session` 与 `Agent` 注册。删除这类会话总会命中拒绝，而客户端用 console note 吞掉了拒绝，于是"删除"动作看起来什么都没做。

## 决策

`deleteSession` 现在先处置活跃的范围内成员再删除持久化日志（强制停止后删除），仅在处置后仍有成员活跃时拒绝。改动落在四条 seam 上。

1. **工厂 seam 学会处置。** `AgentFactory` 增加必填的 `disposeAgent(id): Promise<boolean>`；`AgentLoop` 用 `byId` 映射追踪每个已创建 agent 的拆除并 await，`AgentRegistry.disposeAgent` 防御性委托（`?.` 让按旧接口编译的工厂仍返回 false）。agent-loop 的复合拆除本来就以解除会话挂载收尾，所以一次成功的处置会把会话从 `ctx.sessions` 移除。
2. **会话处置作为 `enter` 的逆操作。** `SessionStore.dispose(session)` 解除一个活跃条目，发出 `session/disposed`，让持久化协调器在删除执行前完成退役与最终 flush。
3. **`deleteSession` 里先处置再删除。** 对每个活跃的范围内成员：在代理服务已挂载时 `agents.disposeAgent(member)`，然后重新取回并对任何仍活跃的会话 `sessions.dispose`（此前的活跃检查此时已过期）。处置拒绝只记录日志、不致命——代理拆除本来就在 `finally` 里解除了会话挂载，由活跃性复查做决定。循环后仍有成员活跃时，整个操作抛 `SessionDeletionError`（`code: 'live'`）且不删除任何东西。
4. **客户端呈现拒绝。** `WorkspaceBrowser` 把会话删除失败渲染为 alert，取代静默的 console note。

为什么这样：原有拒绝是因为活跃会话在下一次 flush 时会重新物化日志，在其运行时删除会被立即撤销。先处置让删除与最后一次 flush 重合——持久化协调器的 `waitForRetirement` 本就串行化 flush-前-删除，因此没有新的排序屏障。剩余的拒绝是防御性兜底，覆盖无法被处置的成员（例如没有 agent 工厂的外部活跃会话）。

## 备选方案

- **让 host 在使用后处置 agent** —— 关闭了泄漏，但不覆盖删除时已活跃的会话，且把 host 的会话生命周期耦合到删除功能上；无论如何，工厂上的通用处置 seam 对其它消费者也有用。
- **要求调用方先处置** —— 把拆除知识推到每个删除面上；服务拥有循环，应由它拥有排序。
- **无视活跃守卫直接删除** —— 不削弱 `LiveSessionError` 就做不到，而它存在的意义正是阻止删除被下一次 flush 撤销。

## 后果

- 删除使用过的会话端到端可用：agent 排空（cancel → idle → scope 拆除 → 会话解除），协调器退役并最终 flush，然后移除持久化日志。
- agent-loop 的 `disposeAgent` 对并发调用方安全：复合拆除被记忆化，两次同时处置共享一次排空并都观察到成功。
- 当范围内成员活跃但非 agent 所有（未挂载工厂，或工厂返回 false）时删除仍可能拒绝——该拒绝现在是 UI 里的 alert，不再是静默无操作。
