# Agent Note: Agent 设置中心统一预设与模式

Status: implemented

[English](2026-08-29-agent-settings-hub.md) | 中文

## 问题

能力预设与编排模式相关（`Mode = 预设绑定 + 流程`），却以两条平级设置导航并存。用户分不清哪一面决定新会话挂载什么，模式绑定的预设与预设名册之间也缺少深链。重复页标题与不一致的名单操作加剧了混淆。

## 决策

设置导航合并为单一 **Agent** 分区（`id: agent`，order 20），标签经 `settings.agent.tab` 贡献：**能力**（`dsh-client-ui-agent-preset` 拥有）与**编排**（`dsh-client-ui-agent-mode` 拥有）。中心壳拥有标题/导语与简短搭建顺序概览；标签面板去掉重复的 `h2`。旧路径 `/settings/agent-presets` 与 `/settings/agent-modes` 改写到 `/settings/agent?tab=presets|modes`。查询深链 `?preset=` / `?mode=` 打开对应画布并在消费后剥离；模式卡片与编排器可通过 `?tab=presets&preset=` 跳到绑定能力包。模式编排器在绑定和/或流程脏时提供「全部保存」；试跑与创造交接文案写明它们不切换会话预设。

**会话产品路径**（场景优先 Hero、首条意图 `startEntry`、预设芯片降为高级）由[场景 Agent 产品路径](2026-08-29-scenario-agent-product-path.zh.md)拥有；本说明不再主张会话保持 preset-first。

## 考虑过的替代方案

- **保留两条设置导航、仅加交叉链接** — 否决：平级导航暗示两套平级产品单元，并重复页面框架。
- **把模式嵌进每个预设卡片** — 否决：模式是带独立名册、复制与画布的一等编写单元；嵌套会藏起共享同一预设的多个模式。
- **与中心同一 PR 落地模式优先会话** — 当时延后；已由场景产品路径说明落地。

## 后果

- 预设与模式包经 `settings.agent.tab` 协作，互不导入对方 React 树；深链路径助手由中心拥有或本地复制。
- 内置预设显示名使用「预设」而非「模式」，以免与编排模式撞名。
- 引擎后续项（汇合、HITL、`childPresetId` 运行时）不在本中心 UX 切片；场景启动由产品路径说明覆盖。
