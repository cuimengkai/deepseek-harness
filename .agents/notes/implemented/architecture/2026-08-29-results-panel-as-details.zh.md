# Agent Note: 结果栏复用 AppFrame details 列

Status: implemented

[English](2026-08-29-results-panel-as-details.md) | 中文

## Problem

主流 Agent 产品（WorkBuddy、Claude、Codex）在会话右侧保留**会话结果**栏——产物、工作区文件、变更——由对话顶栏开关打开，不依赖点选某次工具调用。DeepSeek Harness 已有 AppFrame 第三列（`details`），但只承载工具调用检视，用户无法在不查找工具行的情况下验收会话输出。

## Decision

复用既有 `details` 列作为**结果**面板，而不是新增第四列网格或新路由：

- 标签：**产物 | 变更 | 文件 | 检视**。检视即原工具详情主体；选中工具仍打开该列并聚焦检视。
- 顶栏工具位 `conversation.session.header.utilities`（`id: results`，order −20）通过 `ctx.layout.toggleDetails` / `openDetails` / `subscribeDetails` 开关该列。
- 产物与变更列表从 Chat 轮次 `deliverables` 数据投影会话级路径（与 `ui-deliverables` 同一词汇）；文件标签展示这些路径并附带会话 cwd 说明（只读，不是完整 IDE 树）。
- 首次出现产物时自动打开该列；关闭时若仍有产物则保留角标。

## Alternatives considered

- **新建 `ui-results` 包 + 第四列** — 否决：AppFrame 已解决几何、拖拽与会话门控占用；并行列会重复布局约定。
- **details 仍仅工具检视，产物只留在轮次尾部** — 否决：轮次尾部芯片短暂，不符合「随时打开结果」习惯。
- **仅在点击工具行时打开结果** — 否决：把验收绑到检视，正是相对 WorkBuddy 独立右栏的缺口。

## Consequences

- `dsh-client-ui-chat` 同时拥有结果壳与顶栏开关；layout 为开关镜像打开态，而不把面板几何移出根 store。
- 工具卡详情测试挂载同一 `DetailsPanel`，须传入 `openFile`；检视仍是选中工具的表面。

## Testing

单测：layout 的 `toggleDetails`/`syncPanels`、chat apply 注册 `details` 与 `results` 工具位、DetailsPanel 结果标题 / 检视空路径。Playwright：冷播种产物会话 → 结果开关打开面板且产物或变更有条目。
