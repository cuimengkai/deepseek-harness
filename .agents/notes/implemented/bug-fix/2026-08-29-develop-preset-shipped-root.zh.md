# Agent Note: 合并 master 后 develop 预设重回 shipped 花名册

Status: implemented

[English](2026-08-29-develop-preset-shipped-root.md) | 中文

## 问题

五个 develop 模式洞察 Tab（模块拓扑、组件依赖、技术栈、组件、Agent 技术）始终不渲染：`filterViewTabs` 把它们按 `modes: ['develop']` 门控，但已没有任何根提供 `develop` 预设。分支把预设写在 `apps/cli/config/agent-presets/develop/`，经 `composeProfile` 的 launcher 侧 overlay（把 `SHIPPED_PRESET_ROOT` 推进 `agent-presets` 行的 `roots`）喂进花名册。合并和解采纳了 master 的 `profile-boot.ts`——master 的 f94495e527 已把 shipped 预设移入包内并删除该机制——分支的 develop 预设于是躺在一个无人扫描的目录里，`config/agent-presets` 树留在磁盘上无人引用。

## 决策

遵循 master 架构而非复活 launcher 补丁：`git mv` 把预设移入 `packages/preset/agent-presets/presets/develop/`，由 `includeShippedRoot`（schema 默认 true）以 `system` 信任、首根优先发现，包 tarball 的 `presets/` 条目本就携带它。web e2e 的 `SHIPPED_PRESETS` 常量改指包的 shipped 根，`shipped-root.spec.ts` 断言五元集合。`verify-cordis-config` 对 develop 报出与 standard/ptc/cordis 相同的 `workflow-worker-thread` plane 投诉——预存基线类别，非新增违规。

## 验证

`packages/preset/agent-presets`：170 个测试通过，含更新后的 shipped 集合断言（develop 在列、system 信任、非畸形）；`tsc -b`、`oxlint`、`verify-cordis-config` 保持改动前基线。运行中的 web 服务每次花名册调用都重读 shipped 根，重启即恢复预设，无需重建。

## 后果

- develop 预设重新出现在每个花名册；运行它的会话显示五个洞察 Tab，`autoScanPresets`（默认 `['develop']`）恢复工作区扫描。
- shipped 预设现在只存在于 `dsh-agent-presets/presets/`；`apps/cli/config/agent-presets` 已删除，未来的预设加进包里，而不是 launcher 喂的目录。
