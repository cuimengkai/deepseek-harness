# Agent Note: 在提交前渲染并校验一棵工作台预设

Status: implemented

[English](2026-08-22-preset-assembler.md) | 中文

## 问题

四期的低代码方向把预设装配器的「渲染 + 校验后提交」步骤定为支点缺口([docs/platform-preset-assembler.zh.md](../../../../docs/platform-preset-assembler.zh.md)):工作台要到达 roster,只能通过手写的角色预设或操作者驱动的 agent 调用,从未经"从声明的能力集机器校验渲染"而来。两条接缝都缺失:市场目录不携带能力贡献给工作台树的预设片段;agent-presets 的「调用者不得提供组合文本」创作边界也没有一条让渲染出的树得以提交的合规途径。

## 决策

platform-shell 包以纯包内模块(与 `execution-gate.ts` 同风格)拥有装配器:`renderPresetTree(base, resolved, patches, warn)` 按目录顺序把每个已选能力的 `rows` 片段追加到角色预设的基底行之后,并通过复用 `@deepseek-ai/cordis-plugin-include` 的 `applyEntryPatches` 应用覆盖补丁(脱离的结果、按 id 定位、warn 接收器——确定性的,同样的请求渲染出深度相等的行);`validatePresetTree(rows, platform)` 报告当前平台被禁用的行(`disabledOnPlatform`),并拒绝重复的行 id(`ROW_ID_CONFLICT`);`assertNoToolShadowing(resolved)` 拒绝被两个能力共有的工具名(`TOOL_NAME_CONFLICT`)——目录 `capability_tools` 的主键按能力划分、无全局唯一性,归属查找是 `LIMIT 1` 且无 `ORDER BY`,否则被遮蔽的名字会有一个不确定的归属者。服务方法 `assemblePreset` 要求场景内的 `capability.consume` 成员关系,解析选择、渲染并校验,并写入一行 `market.preset.assemble` 审计。

`assemble_preset` 工具向 agent 暴露这条接缝:宿主提供一个从 roster 读取角色预设并解析其 entry-list YAML 的 `resolveBaseRows` 绑定(必需——缺失时工具以 `INVALID_ARGUMENT` 响亮失败),工具在返回树与校验报告之前,把携带渲染行的持久化 `preset/assembled` 会话事件追加进日志(模型可见 ⟺ 已记录)。

提交边界被有意放宽。能力在发布请求中新增 `rows` 片段(schema v5;按 pre-release 立场,旧的 v4 磁盘格式被拒绝),发布时逐行校验。agent-presets 包新增一条合规的 `AgentPresets.write(id, rows, meta)` 原语:校验 id,拒绝已占用或随部署发布的 id,用 entry-list YAML 方言转储行(`!!js` 禁用节点保持可求值往返),发布元数据,收紧 POSIX 权限,并原子写入——装配器是这条合规的创作客户端,与 `copyComposition` 从行的路径对应。

`examples/capability-market-demo` 无密钥证明这条接缝:非操作者创建者 agent 在 content-marketing 工作台上调用 `assemble_preset`;宿主通过 `AgentPresets.write` 提交渲染出的行并挂载一个新 agent,组合后的系统提示词按目录顺序携带基础 persona 与每个能力 persona,减去平台禁用行;重复的行 id 与被遮蔽的工具名在任何树到达 roster 之前各自响亮拒绝;同样的请求在重渲染时产出深度相等的行。

## 备选方案

**复用 `cordis-plugin-include` 的 `applyEntryPatches`。** 手写覆盖合并要重新实现按 id 定位的补丁与 `%C` warn 错误码;维护中的辅助函数删除自有代码与测试,是文档记载的渲染路径。

**在装配器里校验工具名遮蔽。** 没有全局工具名注册表时,被两个能力共有的名字会经由 `LIMIT 1` 归属查找解析到不确定的归属者;在提交前拒绝该组合是歧义可见的唯一位置,因此冲突必须在装配处拒绝,而不是以脆弱的调用时行为浮出。

**报告而非拒绝平台禁用行。** 当前平台被禁用的行是预期的工具面差异,不是冲突;报告让宿主展示它,而 loader 级检查(`inactiveRows`/`leakedServices`)留在 roster 挂载时进行。

**用合规的 `write` 放宽创作边界。** 保持只拷贝的边界会让渲染出的树无法提交;`write` 是一次刻意、有文档的放宽,装配器是合规客户端,与 `copyComposition` 从行的路径对应。

## Consequences

装配器只渲染与校验,从不提交——roster 是宿主动作,接缝保持单向(platform-shell 从不读 roster),loader 级检查留在挂载时。`assemble_preset` 需要消费方的 `resolveBaseRows` 绑定,缺失时响亮失败;`preset/assembled` 事件的行是任何模型可见树的持久化重建。`rows` 发布请求字段是新 schema(v5);没有行的能力不向树贡献任何东西。设计规范、低代码评估、能力市场元模型以及 platform-shell 与 demo 的 README 现在都把这一步记为已实现;剩余低代码后续是各能力选项表面与用户侧工作台生命周期。
