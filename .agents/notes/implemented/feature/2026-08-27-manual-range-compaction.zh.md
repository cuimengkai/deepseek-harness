# Agent Note: Manual range compaction (seam verb, /compact range, tab trigger)

Status: implemented

[English](2026-08-27-manual-range-compaction.md) | 中文

## Problem

上下文标签页的第一阶段交付了压缩的「看」——表面树、压缩历史分组、检查点详情——但有意推迟了「做」：标签页无法发起压缩，`/compact` 只提供保留策略的范围。看到「#2–#9 行里有 45 token 死重量」的用户没有任何针对这些行的动词：无参数的 `/compact` 会重新运行策略自己的选择，而 `compactRegion()` 是一个编程接口动词，不具备人工发起压缩所需的接纳、标记与持久性保护。

缺口有三层：seam 需要一个手动范围动词，命令需要一个范围语法，标签页需要一个范围交互——且每一层的失败方式都必须与无参数形态完全一致，而不是发明第二套错误词汇。

## Decision

### 一个新的 seam 动词，`compactNow` 的事务体

`CompactionEngine.compactRegionNow(start, end, agent, signal, sourceCommandId?)` 是 `compactNow` 的范围形态：调用方选择范围，而非保留策略。`compaction-basic` 将其实现为 `runManual(agent, signal, (operationSignal) => commitManual(agent, operationSignal, sourceCommandId, { start, end }))`——与策略形态相同的空闲门独立 `compaction/* { turn: null }` 标记对、取消映射与持久性检查点，范围解析位于维护阶段内（表面读取发生在接纳之后）。

`start` 与 `end` 是按位置排序的表面 seq，包含两端。缺失、倒置或不平衡的范围以指明被违反端点的普通 `Error` 拒绝；busy、取消、范围变化、摘要、提交与持久化失败像 `compactNow` 一样抛出 `ManualCompactionError`，因此命令现有的错误表无需变更即可覆盖范围形态。

### `/compact <startSeq>:<endSeq>`

`command-compact` 用严格的 `^\s*(\d+)\s*:\s*(\d+)\s*$` 语法解析参数，并路由到 `compactRegionNow(start, end, invocation.agent, invocation.signal, invocation.commandId)`。无参数形态不变；其他参数是使用错误，其 `USAGE` 行现在同时列出两种形态。被拒绝的范围（引擎的普通 `Error`）原样作为命令的错误文案——该信息已指明被违反的端点，客户端改写会分叉词汇。

### 标签页发送与输入框相同的字符串

`ui-context` 在其注入面上新增 `compactRange(start, end)` 回调：调用 `ctx.remote.commands.execute(sessionId, \`/compact ${start}:${end}\`, [])`，获接纳的执行返回 `null`，否则返回失败文案（错误字符串保持英文——错误展示策略）。没有新 RPC、没有新线上接口：命令路径已满足模型可见⟺已记录，其生命周期归并到聊天视图的命令节点。

交互基于锚点：普通点击选中并重新锚定（清除任何范围）；在表面行上 shift 点击从锚点扩展，因此范围可以双向生长。被压缩刷新丢弃的锚点改为以被点击行为锚点，而不是发出引擎必拒绝的范围。操作条显示闭区间摘要（覆盖行数、token 总和——组成自身的数字，不重新估算）与触发/清除动作；被拒绝的执行保留范围供用户调整重试，获接纳的清除范围，修订驱动的重读渲染收缩后的表面与新历史行。

### fixture 提交真实的持久序列

fixture 的 `/compact a:b` 分支写入引擎写入的序列：携带被遮蔽范围、token 数与写入路由的 `compaction/summary` 事件，然后是带 `surfaceOp: { op: 'replace', start, end }` 与 `compactCheckpointSource(compactionId, commandId)` 的替换 `user/message`——离线路径端到端演练组成重读、表面折叠的遮蔽与检查点详情。范围校验镜像位置折叠（`foldSurface` 顺序、`indexOf` 端点）。无参数形态保持文档化的假动作。

### 包纯净：一个白名单跨插件值导入

fixture 对 `@deepseek-ai/dsh-compaction/checkpoint`（取 `compactCheckpointSource`）的值导入需要 `tsdown.client.ts` 新增的 `INLINE_SAFE_OUTLETS` 模式——现有 `INLINE_SAFE` 允许列表旁的包级例外。该出口对其他所有客户端消费者仍是 types-only 子路径；只有 fixture 的 dispatch 路径导入其运行时值。

## Alternatives considered

### 为什么不让标签页走 `compactRegion()`？

`compactRegion` 是强制的编程动词：没有空闲门、没有独立 `turn: null` 手动标记对、没有 `sourceCommandId`，错误词汇也不同（裸抛出）。人工发起的压缩需要的正是 `compactNow` 的接纳与持久性语义——这就是 `compactRegionNow` 共享 `runManual`/`commitManual` 而非 `commitRegion` 事务体的原因。复用 `compactRegion` 会让同一用户动作出现两套失败词汇，并失去排队手动压缩 note 拥有的全部保障。

### 为什么不加专用的 `contextComposition.compact` RPC？

commands Remote 已在线上承载 `/compact`，命令执行器已记录 `command/run`/`command/done` 对并转发取消，聊天视图已把生命周期归并到检查点节点。第二个 RPC 会复制这三者并新增一个需要维护的线上接口；把范围作为命令文本输入保持单一接纳路径，并演练与输入框输入 `/compact` 相同的路径。

### 为什么不在客户端预校验范围（配对、已遮蔽成员）？

宿主的表面折叠拥有该事实；客户端副本会在折叠学到新规则的瞬间漂移，且引擎无论如何必须校验。标签页发送原始端点并原样渲染引擎的拒绝——权威流而非派生副本回答问题的表面不变规则。

### 为什么不把 fixture 范围分支保持为无参数那样的假动作？

第二阶段的验收是持久可见的收缩：194 行 → 192 行、压缩历史行、检查点详情。假动作会渲染成功文案而树保持冻结——组成重读、replace 遮蔽与检查点折叠在离线路径中全部未被测试。

## Consequences

seam 新增第五个动词（抽象契约与测试中的每个 mock 都多一个方法——封闭 Service Definition 的代价）。命令的使用文案变了形态（`/compact (no arguments)` → 双形态 `USAGE`），这是用户可见的字符串变化，不是契约变化。标签页的注入面新增一个回调，因此 `ui-context` 注入的每个 `conversation.view` 消费者都会看到（props 是显式的，不是可选的）。

范围校验边界值得精确表述：UI 不会拒绝引擎会接纳的范围，也不会接纳引擎会拒绝的范围——它完全让渡，因此任何引擎侧规则变化（配对吸附、已遮蔽成员）无需客户端变更即可到达标签页。代价是用户可能组出一个注定失败的范围（不平衡端点）并在触发时才知道；操作条的区间摘要让尝试变得廉价。

## Verification

- Seam 与后端：`compaction-basic` `manual-compaction.spec.ts`——显式范围事务接纳平衡范围、拒绝倒置范围、映射端点失败；`compaction` spec 在桩引擎上固定抽象面。
- 命令：`command-compact.spec.ts`——范围语法路由（原样范围拒绝、畸形参数使用错误）、命令身份转发、取消与处置不变。
- Fixture：`fixture-commands.client.spec.ts`——`/compact a:b` 分支写入 summary + replace 对、发出 mux 帧、拒绝越界参数。
- 标签页：`context-view.client.spec.tsx`——锚点/扩展语义（双向）、带闭区间端点的触发接线、接纳清除 vs 拒绝保留、丢失锚点重新锚定、清除动作。
- 组装路径：`apps/web/tests/context-tab.snapshot.ts` 固定操作条、触发、压缩后的树（192 表面行、`Compaction #553` 历史行、`Log revision 556`）与检查点详情。金样在触发后重新查询活跃的 `[data-context-view]` 元素，因为重载可能重挂载视图主体——持有的压缩前引用读取的是脱离文档的 DOM 节点，快照会误报失败。
- `pnpm run build:lib:client` 带着新增的 `INLINE_SAFE_OUTLETS` 例外通过；`scripts/client-bundle-purity.spec.ts`（tsdown 构建期门禁的 spec）仍通过。

## Related

- [Context composition view（第一阶段）](2026-08-26-context-composition-view.zh.md)——本触发扩展的只读标签页；其为第二阶段记录的暂缓项由本 note 退役。
- [Queued manual compaction](2026-07-30-queued-manual-compaction.zh.md)——`compactRegionNow` 共享的接纳、锁与持久性语义。
