# Agent Note: WorkBuddy 最终信息架构（侧栏导航、助理空态、诚实目的地）

Status: implemented

[English](2026-08-29-workbuddy-final-ia.md) | 中文

## Problem

产品已将 `details` 重映射为结果栏，并把场景编排收进 Agent 设置，但左侧栏与助理空态仍像通用会话浏览器：「新会话」、无 WorkBuddy 式一级目的地，也没有对「项目 / 自动化」的诚实落点。截图所定义的产品意图要求对齐该信息架构，同时不得伪造 Host 未提供的连接器市场、多人项目或定时自动化。

## Decision

在保留 dsw token（不做暗色换皮）的前提下，将已交付的 Web 壳对齐 WorkBuddy 截图信息架构：

- **侧栏：**「新建任务」开启空白会话；主导航为助理（`/`）、项目（`/projects` 工作区列表）、专家·技能（`/settings/agent`）、自动化（`/automation` Jobs + 编排链接）、更多 → 仅设置。会话列表分区文案为**任务**；空白行为**草稿**。
- **目的地页：** `/projects` 列出宿主工作区并提供开始/打开会话；`/automation` 说明会话 Jobs 与编排试跑且不提供 cron SaaS——不是假 OAuth 或调度器界面。
- **助理空态：**问候（`{brand}, 我帮你`）+ 带图标的分段分类控件映射到随船预设（`standard` / `develop` / `cordis`，缺则隐藏）+ 作曲器上方按类静态技能起步芯片（`setDraft`）+ 动词式 hero placeholder；工作区与权限在作曲器底栏上下文条；英雄态 `+` 菜单为文件 / Plan / 专家 / 技能。会话面不恢复场景 dock（[产品路径](2026-08-29-scenario-agent-product-path.zh.md)）。

## Alternatives considered

- **交付假的腾讯连接器 / 项目 / cron 表面** — 否决：无 Host 后端，会训练用户走死路。
- **暗色 WorkBuddy 换皮** — 否决：继续 dsw token；只对齐信息架构与布局。
- **在 hero 恢复场景 dock** — 否决：编排仍只在 Agent 设置（[绑定说明](2026-08-29-agent-modes-preset-flow-binding.zh.md)）。

## Consequences

- `dsh-client-ui-sidebar` 注入 `router` 与 `sessions`，拥有主导航外壳，并注册可操作的项目 / 自动化页。
- `dsh-client-ui-agent-preset` 用分段分类控件填充 `conversation.hero.agentPreset`，用**静态 locale 技能起步**（空白会话 `setDraft`，非 Host 技能市场或预设名单芯片）填充 `conversation.input.dock`。
- 助理空态问候为 `{brand}, 我帮你` / `{brand}, I can help`（标题无鱼标与预览徽标）。工作区芯片与权限在工具行下方的作曲器**上下文条**；英雄态 `+` 打开文件 / Plan / 专家 / 技能（活跃会话的 `+` 仍只开指令）。
- Workspace 文案拥有任务 / 草稿隐喻；结果栏仍为右侧栏（[结果面板](2026-08-29-results-panel-as-details.zh.md)）。

## Testing

单测：侧栏导航与项目/自动化页、分类芯片预设映射、分类技能行 `setDraft`、英雄问候与上下文条。Playwright：打开 Web → 见新建任务与结果；专家 → `/settings/agent`；项目 → 工作区列表。
