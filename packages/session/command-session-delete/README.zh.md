# @deepseek-ai/dsh-command-session-delete

[English](README.md) | 中文

面向用户的 `/session-delete` 命令,基于 [`ctx.sessionDeletion`](../session-deletion/README.zh.md)。插件通过 [`ctx.commands`](../../interaction/commands/README.zh.md) 注册一个全局命令,每个组成的命令适配器都能执行它,无需模型回合。

## 命令契约

| 输入 | 结果 |
|---|---|
| `/session-delete <sessionId>` | 物理删除指定会话及其整棵子代理后代树,然后报告数量。 |
| `/session-delete <sessionId>`(无持久化工件) | `Session "<id>" not found.` |
| `/session-delete <sessionId>`(范围内成员活跃) | `Cannot delete running session(s): <ids>. Stop them before deleting.` |
| `/session-delete` 或 `/session-delete <a> <b>` | `Usage: /session-delete <sessionId>` — 恰好一个 id 参数。 |

每次成功调用都会记录 executor 拥有的仅日志 `command/run` / `command/done` 事件对;两者都不会进入模型历史。预期的 `SessionDeletionError` 码变为稳定的直接错误;意外的实现失败会拒绝派发,取消则结算为 `Deletion cancelled.`。插件释放时先注销 `/session-delete`,再排空所有已启动的 handler。

## 组成

生产者注入 `commands` 与 `sessionDeletion`。挂载命令注册表、删除 seam 与本插件:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: session-deletion
  name: '@deepseek-ai/dsh-session-deletion'
- id: command-session-delete
  name: '@deepseek-ai/dsh-command-session-delete'
```

## 已知限制与待办

- **无确认、无批量选择** —— 命令从一个 id 参数一次性删除整棵子代理后代树;没有逐成员确认,也无法一次选择多个根。
