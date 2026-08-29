# Agent Note：master 合并后恢复设置页面层

Status: implemented

[English](2026-08-29-settings-page-layer-restore.md) | 中文

## 问题

master 合并校对把 `AppFrame.tsx` 换成了 master 的版本，该版本早于路由化页面架构（master 没有 `ui-router` 包，也没有 `page` 槽位）。但 `index.ts` 保留了分支的 pages 基础设施：`page` 子槽位声明和 `hooks: { pages }` inject face。于是设置页注册进 `page` 槽位并导航到 `/settings`，却没有任何东西渲染该槽位——框架只画出三栏和 overlay。这次校对还从 ui-layout 的 `inject` 数组里丢掉了 `router`（master 的值是 `['slots', 'theme', 'locale']`），尽管 `ui-router` 的契约写着 ui-layout 会 strict-resolve `router`；同时 `apply.client.spec.ts` 被对齐到 master 的无 pages 预期，对着仍然存在的 pages inject face 断言失败。

## 决策

AppFrame 重新渲染 `page` 槽位，采用分支已验证的形态：从 `usePages` inject-face hook 选取 `activeId`，整个应用网格包进一个 `appRegion` div（`display: contents`），页面活动时转为 `inert`，并在所有栏与 overlay 之上用一个 `pageLayer` div 渲染 `renderSlot('page', {}, { only: activeId })`。master 较新的框架特性——`DocumentTitle`、`SessionProvider`、locale share——全部保留；恢复与它们组合而非替换。inject 数组改为 `['slots', 'theme', 'locale', 'router']`，两个 spec 文件重新断言 pages 投影（apply bench 挂载真实 `RouterService`；frame spec 桩掉 `usePages` 并钉住页面层/inert 行为）。

## 验证

`packages/client/ui-layout` 单元测试：68 通过（含两个恢复的 page-layer 测试和恢复的 inject 投影断言）；`ui-settings-general` 与 `ui-router` 套件：另有 58 通过；`tsc -b`、`lint`，以及修改前通过的文档门仍然通过。

## 后果

- 设置页在 `/settings` 覆盖整个窗口渲染，下方应用网格保持挂载但 inert，开合保留会话与草稿状态。
- ui-layout 再次 strict-resolve `router`；省略 router 行的 web 组合会让 boot 审计响亮失败，而不是静默降级。
- 今后 master 侧对 AppFrame 的改动必须对照这个 page-layer 形态重新合并：框架现在拥有第五个子槽位和 `usePages` inject-face 依赖。
