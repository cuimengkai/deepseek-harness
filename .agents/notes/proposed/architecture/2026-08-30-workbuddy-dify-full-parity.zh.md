# Agent Note: WorkBuddy 全量对标与 Dify 级模式编排

Status: proposed

[English](2026-08-30-workbuddy-dify-full-parity.md) | 中文

## Problem

WorkBuddy 对齐的壳层信息架构与「模式 = 预设 + 流程」拆分已交付，但运营者仍缺少 Dify 级精细控制（节点设置 / 上次运行、SYSTEM·USER、分类调色板、实时 `childPresetId` / `modelKinds` / 汇合），以及 Experts 深度（Skill Map、集成卡片）。项目 / 自动化占位与「连接器」文案对不存在的 Host 后端过度承诺。单一切片 demo 无法收口；产品需要分阶段、对引擎诚实的落地计划。

## Proposal

在既有架构上按序落地全量对标（保留 dsw token；预设挂载工具 / Skill；模式拥有 FlowGraph）：

0. 契约笔记 + **用于新会话**经 `agentModes.select` 盖章 `agentMode`（非仅选预设）。
1. ModeComposer 设置 | 上次运行、SYSTEM·USER、模型目录、发布=保存。
2. 引擎：`childPresetId` 运行时、`modelKinds` 路由、并行后汇合、试跑节点 I/O。
3. 分类调色板与诚实的能力深链（无假工具节点）。
4. Experts 标签：Skill Map + 来自 `pluginInventory` 的集成卡片（无商店评分）。
5. 模型 / 插件产品打磨与交叉链。
6. 项目 / 自动化变为可操作的 Harness 表面（工作区；Jobs / 流程运行）；收回连接器市场文案。
7. Results / 会话密度 + 编排 e2e。
8. 样本、文档、门禁卫生。

否决暗色 Dify 换皮、假 OAuth 连接器店、在 `agent.cordis.yml` 上做分支，以及会话双芯片（场景 + 能力）。

## Alternatives considered

- **单次巨型 demo 工作室 PR** — 否决：无法安全落地引擎汇合 / 路由；评审爆炸半径过大。
- **托管专家 / Skill 市场** — 否决：无后端；映射到本地预设、文件系统 Skill、清单卡片。
- **恢复会话场景 dock** — 否决：[场景产品路径](../../implemented/architecture/2026-08-29-scenario-agent-product-path.zh.md)。

## Success criteria

- 每阶段带测试合并，并更新本笔记 Consequences 清单中的验收行。
- 模式「用于新会话」后 `projectionValues.agentMode` 已设且绑定预设已挂载。
- 运营者可编写 SYSTEM·USER、查看上次运行 I/O，并在随船样本上跑通引擎支持的汇合 / childPreset / modelKinds。
- Experts Skills + Integrations 浏览真实 Host 数据；项目 / 自动化可操作且不发明 SaaS 后端。

## Consequences

Checklist（阶段交付时勾选）：

- [x] Phase 0 — 契约 + 用于新会话走 `agentModes.select`
- [x] Phase 1 — 检视 Settings / Last Run + SYSTEM·USER + 发布
- [x] Phase 2 — `childPresetId` 运行时挂载 + 试跑 `nodeOutputs` / 耗时（`modelKinds` 请求路由与并行后汇合仍延后）
- [x] Phase 3 — 分类调色板（基础 / 逻辑 / 能力深链；无假工具节点）
- [x] Phase 4 — Skills Map + Integrations 清单卡片
- [x] Phase 5 — 模型 / 插件文案交叉链到集成 / 共用目录
- [x] Phase 6 — Projects 工作区页 + Automation Jobs/编排链；Experts 导航去掉连接器市场承诺
- [x] Phase 7 — Results 开关保留；orchestration-studio + WorkBuddy IA e2e
- [x] Phase 8 — 本笔记清单 + followups 中记录仍延后的引擎项

仍延后（引擎诚实，UI 不假装）：实时 `modelKinds` 请求路由；并行扇出后汇合；HITL / resume。

相关：[agent-modes 绑定](../../implemented/architecture/2026-08-29-agent-modes-preset-flow-binding.zh.md)、[引擎后续](2026-08-29-mode-orchestration-engine-followups.zh.md)、[WorkBuddy IA](../../implemented/architecture/2026-08-29-workbuddy-final-ia.zh.md)。
