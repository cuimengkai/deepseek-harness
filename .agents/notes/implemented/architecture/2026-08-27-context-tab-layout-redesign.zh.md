# Agent Note：上下文 tab 改为固定摘要头 + 树/详情双栏浏览

Status: implemented

[English](2026-08-27-context-tab-layout-redesign.md) | 中文

## Problem

上下文 tab 在会话视图里整页滚动：摘要块（模型、提供方、已用/窗口、日志修订）随行一起滚走，扁平的行列表把序号标签、预览和 token 数混在一起毫无层次，范围操作条又排在内容之后。用户的请求 —— "上下文tab中 优化一下布局 固定顶部，不要跟随页面滚动而滚动，并且上下文页面信息的展示乱七八糟，交互也不友好" —— 要求头部固定、信息层次可读、交互友好。

## Decision

根节点挂上会话视图的 composer-overlay 包围模式（`data-conversation-composer-overlay` 加 `flex: 1 1 0%; min-height: 0; overflow: hidden`），与 ChatView 和 trajectory tab 的填充契约一致。tab 自身不再整页滚动；树和详情体成为视图仅有的两个滚动容器，各自在底部内边距里预留实时的 `--dsh-composer-height` 净空，悬浮输入条不再遮住最后几行。

- **摘要头 flex: none 固定在两栏之上。** 自上而下三行：标识行（模型、提供方、已用/窗口带百分比、日志修订描边小签）、分段容量条（system/tools/surface）、右端承载范围选择提示的图例行。提示在范围激活或压缩进行中时让位，恰好只在交互可用时可见。
- **树是左栏，分组头吸顶。** 每个分组标题在其行滚动时保持可见；每行是一个整宽按钮，依次为角色签、序号标签、截断预览和右对齐的等宽数字 token 数。激活行带内嵌主色边；落在所选压缩范围内的行带主色底。分组标题带行数与 token 汇总。
- **详情栏占据右栏。** 头部块（标题加每对标签/值一个描边事实签 —— 序号、角色、token、提供方、模型）位于本栏自己的滚动区上方；切换所选行时滚动区归零，新行总是从头打开。表面正文与压缩摘要走 `MarkdownText` 渲染；工具目录保持表格。
- **范围操作条悬浮。** 范围激活时，一张绝对定位的卡片居中悬浮于输入条上方，承载跨度摘要、`/compact` 触发、取消动作与拒绝文案；它覆盖两栏而不推移内容。`Escape` 清除范围与拒绝文案。

文案键随布局收敛：`label.usedWindow`、`label.noRequest`、`label.toolsCount` 支撑新的头部与行数字；日志修订标签随页脚删除移入标识行；旧单页滚动布局专用的键（页脚行、容量条独立字符串）连同标记一起删除。

## Alternatives considered

- **在页面级滚动容器内对头部用 `position: sticky`** —— 否决：保留了 composer overlay 要替换的页面滚动容器，overlay 预留的净空仍要按滚动容器逐个推导。有界填充模式给头部与其他会话 tab 相同的保证。
- **保留扁平单列列表只做重绘** —— 否决：行的序号、预览、token 数需要不同的视觉权重，单行的详情需要稳定的阅读位置。树/详情分栏两者兼得；重绘扁平列表两者皆无。
- **把范围动作放进头部** —— 否决：标识行是与选择无关的状态；放入范围的瞬态动作会让头部内容依赖交互状态，且动作远离它覆盖的行。

## Consequences

- tab 不再随会话页滚动：标识、容量条、图例全程可见，长表面在树内滚动。
- 树和详情体未绘制任何抬升表面 token，基础滚动条对即生效，本样式表无需满足抬升表面的滚动条重绑契约。
- 事实签把标签与值渲染为两条独立的可读文本行，组装 golden 因此把详情栏固定为逐签的 `detail=` 行（标签与值分离），不再是旧的拼接元信息行。
- `#序号` 标签与行内预览现在是分离元素，按拼接文本匹配行的 DOM 查询必须改为匹配行标签元素 —— 组装车道的 `#9` 行查找改为匹配 `rowLabel` 元素。
- 提示行位于图例行内，无范围激活时 golden 的 `legend=` 块携带它。

## Verification

- `context-view.client.spec.tsx`：原有八个用例对新结构全部成立，新增 Escape 用例 —— keydown 清除范围与拒绝文案，清除后普通点击重新锚定仍然可用。
- `apps/web/tests/context-tab.snapshot.ts` 重录：golden 固定标识行（`head=` 行）、图例、双栏树（角色签、标签、预览、token 数为独立 `tree=` 行）、逐签详情行、悬浮范围卡、压缩后的树与检查点详情。
- `scrollbar-styles.client.spec.ts` 21/21，仓库 `typecheck` 绿，改动包 oxlint 干净；`ui-context` 与 `ui-settings-models` 套件 243/243。

## Related

- [Context composition view（一期）](../feature/2026-08-26-context-composition-view.zh.md) —— tab 的数据契约；本笔记只改呈现。
- [Manual range compaction](../feature/2026-08-27-manual-range-compaction.zh.md) —— 悬浮卡呈现的锚定/扩展语义与触发接线。
- [Insight tab layout redesign](2026-08-24-insight-tab-layout-redesign.zh.md) —— 本 tab 沿用的填充布局先例。
