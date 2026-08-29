---
description: "automation 组地图：仅在应用运行时触发的会话提示，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# automation/ — 仅在应用运行时触发的提示

[English](README.md) | 中文

## 概述

automation 组持久化全局调度规则，并且只在宿主进程存活时触发：到期规则通过 `sessionController` 创建会话并排队该规则的提示词。规则在重启后仍在；触发不会——这不是从关闭状态唤醒的耐久性，也不是 `dsh-schedule`（会话内提醒）。本页是组的映射；包级约定由包 README 负责。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`automation/`](automation/README.zh.md) | 持久化规则并在进程内定时器上求值；到期规则启动会话并排队提示词 | `ctx.automation` |

-----

<a id="related-documentation"></a>
## 相关文档

- [仅限会话内的 Schedule](../schedule/README.zh.md) — 留在一条会话日志里的提醒。不要把那个包拿来做全局、仅在应用运行时生效的规则。
- [连接器登记表](../mcp/connector-registry/README.zh.md) — 触发的会话在宿主上可能已经挂载的 MCP 卡片。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
