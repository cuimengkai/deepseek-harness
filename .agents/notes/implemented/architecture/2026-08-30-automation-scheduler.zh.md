# Agent Note：仅在应用运行时生效的自动化调度

Status: implemented

[English](2026-08-30-automation-scheduler.md) | 中文

## 问题

「自动化」入口解释了后台任务，但没有撰写周期性提示词的地方。`dsh-schedule` 是会话本地、以日志为权威的。云端 cron 或操作系统唤醒会声称桌面宿主并不具备的耐久性：进程不在时，什么都不会触发。

## 决定

1. **`@deepseek-ai/dsh-automation`**（`ctx.automation`）把规则持久化到 `$DSH_HOME/automation/<id>.json`。Remote：`list` / `create` / `update` / `setEnabled` / `remove`。`kind` 为 `interval` | `daily` | `weekly` | `once`。`tickMs`（默认 30000）是进程内定时器周期。
2. **触发是创建再排队。** 到期规则调用 `sessionController.create`，再以 `mode: 'queue'` 调用 `prompt`。缺少 `sessionController` 时记录 `lastError`，不抛出。`tick()` 仅供宿主测试调用。
3. **不会从关闭状态唤醒。** 定时器只在本插件已加载时运行。自动化页写明这一点。这不是 `dsh-schedule`，也不是推送通知。

## 考虑过的替代方案

- **复用 `dsh-schedule`** — 已拒绝：那些提醒属于一条会话日志，且要求该会话处于 live。
- **操作系统或云端 cron** — 已拒绝：产品在退出后不保留守护进程，也不得声称会保留。

## 后果

- 关机的电脑不会触发。规则在重启后仍在磁盘上，并在下一次 tick 时求值。
- 没有操作系统或移动推送；触发的会话出现在会话列表里。

## 测试

无密钥：`packages/automation/automation/tests/service.spec.ts`（`isDue`、持久化 CRUD、没有 `sessionController` 时的 `lastError`）。自动化页客户端测试保留任务列表并加上规则表单。
