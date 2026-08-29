---
description: "仅在应用运行时生效的自动化调度：持久化规则，并在宿主进程存活时发起会话提示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-automation

[English](README.md) | 中文

`ctx.automation` 把调度规则持久化到 `$DSH_HOME/automation/<id>.json`，并在进程内定时器上求值。到期规则通过 `ctx.sessionController` 创建会话并排队该规则的提示词。规则在进程重启后仍在；触发不会——本包不会唤醒已完全关闭的应用。

## 服务

`list()`、`create(draft)`、`update(id, draft)`、`setEnabled(id, enabled)` 与 `remove(id)` 是 Remote 面。`kind` 为 `interval` | `daily` | `weekly` | `once`。`tick()` 是仅宿主使用的重新求值，供测试调用。

## 配置

`root`（默认 `$DSH_HOME/automation`）是文档目录。`tickMs`（默认 30000，最小 1000，最大 3600000）是定时器周期。

## 模型体验

间接实现：触发的规则会变成新会话上的用户提示词。调度器不暴露面向模型的工具。

#### KV Cache 影响

自身没有；新会话开始一段新的请求前缀。

## 已知限制与暂缓事项

- **没有从关闭状态唤醒的耐久性** — 定时器只在本进程已加载时运行。关机的电脑不会触发。
- **这不是 `dsh-schedule`** — 会话日志内的后续提醒仍在那个包；本名册是全局的，且仅在应用运行时生效。
- **没有推送通知** — 触发的会话出现在会话列表里；没有操作系统或移动推送。
