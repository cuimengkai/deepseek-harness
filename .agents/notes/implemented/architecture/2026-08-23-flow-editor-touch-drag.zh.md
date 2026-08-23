# Agent Note: Flow canvas touch drag via pointer-capture discipline

Status: implemented

[English](2026-08-23-flow-editor-touch-drag.md) | 中文

## 问题

流程画布上的节点拖拽基于指针事件：对节点 `pointerdown` 会调用 `setPointerCapture`，拖拽跟随 `pointermove`。在触屏上，除非元素声明自己处理平移与滚动，否则浏览器会把指针拖拽转换成 `pointercancel` 并收回手势。画布未设置任何 `touch-action`，因此在触屏设备上，拖拽在浏览器一接手手势时就中止——画布拖不动的报告在触屏上复现，而桌面指针拖拽正常。

## 决策

`.canvas` 设置 `touch-action: none`，告诉浏览器该元素拥有自己的平移与滚动，于是触屏拖拽继续触发 `pointermove` 而不是变成 `pointercancel`。节点拖拽现在在触屏上跟随手指，与跟随指针完全一致。画布自身的平移与缩放仍延后，所以这条规则是前提而非功能：现在买来正确的拖拽语义，并让元素在平移工作落地时不受浏览器手势处理的干扰。

新增的 `editor-dom.client.spec.tsx` 固定住 jsdom 能观察到的 DOM 级行为：节点拖拽按指针增量移动节点位置并重绘其 DOM `transform`，拖拽在画布原点处被钳制，背景点击取消选中。jsdom 没有 `setPointerCapture`，因此测试在 `Element.prototype` 上打桩（真实浏览器会把被捕获的 `pointermove` 重新定向到节点，测试通过在节点上直接触发 move 来镜像这一点）。计算出的 `touch-action: none` 在 `styles.client.spec.ts` 中断言，因为 jsdom 不应用样式表。

## 备选方案

- **保留指针事件拖拽但不设置 `touch-action`** —— 观察到的缺陷：浏览器把触屏拖拽变成 `pointercancel`，节点停止跟随手指。
- **在 `pointercancel` 上终结一次部分拖拽** —— 治标不治本；拖拽仍在手势中途中止，而不是跟随手指到落点。
- **把 `touch-action: none` 限制在 `(pointer: coarse)` 媒体查询内** —— 手势接管是元素交互的属性，该规则对精确定位指针无害；媒体查询只会在平移工作落地时再次加上同一条规则，现在没有任何好处。

## 后果

- 节点拖拽在触屏上可用；桌面指针拖拽不变。
- `.canvas` 的 `touch-action: none` 是延后的平移/缩放工作依赖的前提。
- ui-flow-editor 的已知局限一节记录了触屏平移与缩放随指针式工作一起延后。
