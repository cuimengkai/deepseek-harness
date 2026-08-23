# Agent Note: Compose an agent preset from validated plugin rows

Status: implemented

[English](2026-08-23-agent-preset-row-compose.md) | 中文

## 问题

agent-preset 设置分区的唯一创作路径是「复制→在文件里编辑」：`copy` 落下一个既有 preset 的整个目录，其余一切都在 preset 自己的文件里发生，因为创作边界原本只有复制——「调用方不提供组装文本，也不提供路径」。因此用户无法在页面上从已安装插件组装一个 agent；需求正是把 Agent 预设模块改造成可拖拽的组合器——拖拽插件组装一个 agent，底层仍是 `agent.cordis.yml`。

## 决策

宿主新增一个面向浏览器的受控写入。`AgentPresets.compose(id, rows, meta?, { overwrite, assertResolvable })` 从行结构——`{ id, name, config?, disabled? }`，即 Loader entry 的 JSON 安全子集——写入组装：创建（`overwrite: false`，目标 id 必须空闲）或就地替换一个本地创作的 preset（`overwrite: true`，目标必须已存在且为 `user` 信任级别；随附 preset 被拒绝）。它强制 preset 域自身的行不变量（行非空、每行一个插件模块、id 唯一），并通过必传的 `assertResolvable` 证明执行「只能组装已安装插件」规则：回调返回行所引用但未安装的模块名，非空即整体拒绝（`ComposeModuleError`）。由 wire 层提供基于 inventory 的实现，任何调用方都无法绕过。`readRows(id)` 用 Loader 自己的 YAML 方言把组装解析为同样的行结构（`!!js` 的 `disabled` 节点得以存活），因此组合器编辑的是行，浏览器从不解析 YAML。

wire 层为 `agentPreset` 增加 `compose`，并给 `read` 加上 `rows`；两者与 `copy`/`remove`/`openDocument` 同级被固定在环回地址，因为组装指明了一个会话所运行的插件。compose handler 在任何内容落盘之前对照 `pluginInventory.list()` 重新校验每一个被点名的模块，并把 `ComposeModuleError` 映射为 `agent-preset-invalid`、把随附目标（`PresetNotWritableError`）映射为 `agent-preset-read-only`、把未知目标映射为 `agent-preset-not-found`。

客户端（`dsh-client-ui-agent-preset`）在设置分区里增加组合器：来自 `pluginInventory.list` 的可搜索已安装插件调色板（经过去重——inventory 按 entry 排序，同一个模块可能由多个 Loader entry 提供，而重复的 React 列表 key 会在过滤缩小列表时破坏 keyed reconciliation），拖入组合列；行通过同样的原生 HTML5 拖拽重排、可移除，保存需要标识符与至少一行。`rowIdFor` 从模块名派生行 id（`@deepseek-ai/dsh-tool-bash` → `tool-bash`），冲突时追加 `-2`/`-3`。随附 preset 不提供组合动作——只有 `user` 副本才会被原地组合——组合器是复制之外的**新增**创作路径，而非替代。

`apps/web/tests/agent-preset-composer.e2e.ts` 以 keyless 方式驱动真实 HTML5 DnD 生命周期（Playwright 原生鼠标序列，零模型调用），在拖入、重排、移除与保存之后断言目标用户 preset 的 `agent.cordis.yml` 恰好以所组装的顺序落盘，并覆盖用户 preset 的原地编辑。

## 备选方案

**复用既有 `write(id, rows, meta)` 原语。** `write` 原样接受受信进程内调用方给出的行、拒绝已占用 id 且没有就地替换；面向浏览器的接缝需要域的行不变量、已安装模块证明与创建/替换之分，因此它获得了自己的 `compose`，`write` 保留为受信进程内路径。

**让服务自己证明可解析性。** roster 没有 inventory；把 preset 域耦合到 `pluginInventory` 会倒置依赖。把证明做成写入的必传前置，意味着做出决定的那个操作强制执行规则，由 wire 提供基于 inventory 的检查——决定在做出它的操作里被强制执行，而非在调用方可绕过的门面里。

**接受浏览器提供的组装文本或路径。** 复制唯一姿态的由来正是文本/路径创作是弱且危险的表面；`compose` 让浏览器两者都不提供——行是结构，宿主重新校验，且只有用户根接受写入。

**引入 DnD 依赖。** 原生 HTML5 DnD 配合 `dataTransfer` 与基于中点的插入即可覆盖桌面拖入与重排，无需新增客户端依赖；触屏设备保留移除按钮与点击添加路径。

## 影响

创作边界是收窄而非放开：浏览器现在能写组装，但只有行结构、只有已安装插件、只写进用户根。preset 域仍是组装不变量与 YAML 序列化的唯一所有者；浏览器从不解析或转储 YAML、从不提供路径。组合器复用常驻的 roster 发现（组装的 preset 对下一次 `list()` 立即可见），而一次保存是一个 per-save 事件而非 per-deploy 事件，这同样界定了 README 所述被替代代际的成本上限。`config`/`disabled`/`inject` 值原样通过但不被组合器编辑；桌面拖拽是设置页上的交互，触屏超出范围——两者都作为暂缓事项记入包 README。
