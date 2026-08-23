# Agent Note: Flow canvas palette, pan/zoom, and delete-key affordances

Status: implemented

[English](2026-08-24-flow-editor-canvas-affordances.md) | 中文

## Problem

流程画布只能拖拽节点，缺少 Dify 式编辑模型：没有拖放添加节点、没有平移或缩放（固定的可滚动网格）、没有键盘删除。滚轮在这之上也无法使用：React 在根部把 `wheel` 注册为被动监听，其中的 `preventDefault` 被忽略，因此滚轮处理器无法阻止页面在画布上方滚动。

## Decision

画布获得三项操作能力，每一项都是建立在 `src/client/view.ts` 中纯几何助手之上的薄手势（`ViewState`、`clientToGraph`、`panView`、`zoomAt`、`clampScale`）：

- **调色板拖放**——左侧条带提供可拖拽的 Agent/条件/循环卡片（工具栏按钮仍作为无障碍回退）。卡片的 `dragStart` 把节点类型以 `application/x-flow-node` 写入 data transfer；画布 `drop` 读取它，通过 `clientToGraph` 把客户端坐标转换为图坐标，并调用 `controller.addNodeAt(type, position)`——该方法把位置钳制到原点并选中新节点。光标下的图坐标点透过视图变换保持不变。
- **平移/缩放**——`.content` 层携带 `translate(x, y) scale(s)`。背景 `pointerdown` 开始一次平移手势；只有当指针越过 3 px 移动阈值（`PAN_THRESHOLD`）后视图才开始跟随，因此静止按下仍是取消选中的点击，而不是抖动画布。滚轮缩放以指针为锚（`zoomAt`）并限制在 0.2×–2×（`MIN_SCALE`/`MAX_SCALE`），且使用原生非被动 `wheel` 监听，因为 React 的被动滚轮永远不会让 `preventDefault` 生效。`.canvas` 改为 `overflow: hidden`；视图变换取代滚动条。
- **Delete/Backspace**——一个 window `keydown` 监听删除选中的节点（`removeNode`）或连线（`removeEdge`），并忽略焦点位于 `input`、`textarea`、`select` 或 `[contenteditable]` 内的情况，因此检查器或运行输入中的键入是安全的。

几何逻辑被从组件中剥离，以便每个手势都可以在无 DOM 的情况下测试（`view.client.spec.ts`），DOM 接线由 `editor-dom.client.spec.tsx` 钉住。jsdom 没有可构造的 `DragEvent`——testing-library 用普通 `Event` 构造 drop 事件，会丢掉客户端坐标（于是落点变成 `NaN`）——因此 DOM 测试在 `beforeEach` 中用 `window.DragEvent = window.MouseEvent` 打补丁。该补丁仅存在于测试中，不是产品代码。

## Alternatives considered

- **保留可滚动网格而不做平移/缩放**——被拒：画布拖不动的修复与 Dify 式编辑模型都需要可平移、可缩放的画布。
- **通过 React `onWheel` 加 `preventDefault` 挂载滚轮监听**——被拒：React 在根部把滚轮注册为被动，`preventDefault` 被忽略，页面会在画布下方滚动。
- **任何背景拖拽都立即当作平移**——被拒：移动阈值把平移与点击取消选中区分开，避免轻微拖动点击移动视图或无法取消选中。
- **在组件内联计算视图变化**——被拒：把几何逻辑抽取到 `view.ts` 让手势数学可以在无 DOM 下单元测试，并且可被 B1b 的 preset 画布复用。

## Consequences

- 画布成为带可拖拽调色板的平移缩放点阵；节点拖拽、连线、平移、缩放与删除共存（平移只从背景开始，因为节点的 `pointerdown` 会停止传播）。
- B0.3 的 `.canvas` `touch-action: none` 保留；指针式平移与滚轮缩放交付，触屏平移与捏合缩放仍延后并在 README 中记录。
- 新增 `palette.title`、`palette.hint`、`canvas.hint` 中英文字典键。
- B1b 的 preset 画布复用 `view.ts` 与同一套手势模式来实现模块调色板。
