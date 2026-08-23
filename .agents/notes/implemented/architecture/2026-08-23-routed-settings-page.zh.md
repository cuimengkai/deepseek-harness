# Agent Note: 设置页改为路由式整页

Status: implemented

[English](2026-08-23-routed-settings-page.md) | 中文

## 问题

设置表面是一个居中弹窗：宽 800px、高 `min(800px, calc(100vh - 48px))`，188px 导航栏加 54px 头部，四个分区各自被 720–760px 的 max-width 卡死，全部滚动挤在同一个 `.options` 容器里。弹窗的开合状态与当前分区 id 是组件内的 `useState`——没有 URL、没有入口语义、没有浏览器返回、也无法分享某个分区。用户要求把设置改成路由页（「弹窗里视图显示太紧凑，一点都不友好，重新调整整个设置页面的布局」），并把路由机制设计成通用机制，因为后期肯定会有很多页面。

## 决策

**可路由的 `page` 槽。** ui-layout 声明第五个子 slot `page`（list/root），其条目携带 `path` 选项。AppFrame 把条目与当前 URL 匹配，当某页面的 path 激活时，把该条目渲染到整个窗口之上、高于所有栏与 overlay；其下的应用 grid 变为 `inert`——DOM 级的焦点/指针守卫，经 `display: contents` 包装层施加，因此各栏仍是直接的 frame grid 项。应用在覆盖页之下保持挂载是有意为之：开/关页面不会丢失任何会话或草稿状态，页面拥有自己的滚动容器。pages 投影把 `page` 账本与 router 位置折成一份快照（可路由条目加命中的页面 id），框架与任何页面消费方共享这份快照。

**专用路由包。** 新增 `@deepseek-ai/dsh-client-ui-router` 提供 `ctx.router`：包装 react-router v7 的 `UNSAFE_createBrowserHistory` 与 `matchRoutes`/`matchPath` 的浏览器历史 + 页面路由匹配服务，暴露为 uSES 兼容的可观测源外加 `navigate`/`back`/`forward`。history 模式意味着真实 URL——深链、浏览器返回/前进、在路由处刷新全部可用。react-router 从不进入 React 组件树（业务组件看到零 context，packages/client/AGENTS.md），因此页面经服务的 snapshot/subscribe 对消费 URL 状态，绝不通过 router context 或 `<Link>`/`useParams`。react-router 是共享平台模块（web 的 `PLATFORM_MODULES` 加 seed 配对，编译期钉死），因此一条 history 身份服务所有 bundle。

**设置拆成两个 slot 条目。** ui-settings-general 的 `SettingsRoot` 弹窗拆成 `SettingsTrigger`——导航到 `/settings`、在该路由激活时携带 `aria-current`、并在路由激活期间抑制每个 onboarding 步骤的 `sidebar.settings` 行——与 `SettingsPage`，一个位于 `/settings/:section?` 的 `page` 条目，顶栏（返回、标题、操作、关闭）压在左侧导航栏与全高内容列之上。激活分区 id 是对照分区账本校验过的 URL 参数，首行为回退。关闭（× 控件、Escape，或分区的 `close` owner prop）导航到根目录，让覆盖页完全消失；标题栏的返回控件则改为历史后退，为直接打开到该路由的标签页提供根目录回退。进入页面时焦点落在关闭控件上。

**友好的布局。** 顶栏 + 232px 左侧导航 + 36/48/64px 内边距的内容区；分区 max-width 从 720–760px 提到 960px，卡片网格随之多排一列。

**深链在刷新后依然可用。** frontend-static 的回退为缺失但接受 HTML 的路由式路径服务外壳，因此刷新 `/settings/models` 返回 200，而真实资源缺失仍为 404。

**启动顺序。** ui-router 在注入它的行之前激活；web boot 按拓扑序创建条目，提供方行 await 自己的服务 fiber，因此消费行运行时 `ctx.router` 已可解析（[web boot 顺序创建](2026-08-23-web-boot-sequential-creates.zh.md)）。

## 曾考虑的替代方案

- **保留弹窗，只加宽**——漏掉了两个真正的诉求：URL/入口语义（深链、浏览器返回、可分享的分区）以及为「肯定会有很多页面」准备的通用页面机制。「太紧凑」是症状，弹窗外壳才是病因。
- **把 react-router 放进 React 树**（`RouterProvider`/`<Link>`/`useParams`）——违反 packages/client/AGENTS.md（业务组件看到零 context）。否决；react-router 保持为内部历史 + 匹配引擎，页面经服务的 inject-face 模式拿 URL 状态，与 slot 系统既有的形状一致。
- **手写历史 + 匹配**——react-router v7 已内置本需求所需的历史与匹配实现；手写既不删代码又添维护。采纳 react-router，但锁定 v7（v8 把 React peer 要求抬到 ≥ 19.2.7，外壳在 React 18.3.1 上），并把 `UNSAFE_createBrowserHistory` 隔离在唯一定义点。
- **把页面渲染进会话栏**——用户明确要求整页覆盖、隐藏应用骨架；弹窗盖在应用之上正是抱怨本身。带 `inert` 的覆盖页冻结应用，同时保持其挂载。
- **用 `<dialog>` 元素做页面**——设置表面是可导航、可深链的 URL 主体，不是一次性弹窗；URL 成为唯一事实来源，弹窗的组件内状态随之消失。

## 后果

- 深链、浏览器返回/前进、在路由处刷新全部可用；在 `/settings` 处重载会带着设置页重新启动应用。
- 分区状态就是 URL 参数——页面无法独立于路由保持某个分区打开。设置路由激活期间 onboarding 步骤被抑制；协调器保留完成状态，返回后继续。
- 应用 grid 在覆盖页之下保持挂载（inert）——保留滚动与草稿，但让 DOM 在页面背后保持存活。
- 进入页面时焦点落在关闭控件上；关闭不把焦点还给触发器（与旧弹窗持平）。页面不是 dialog（无 `role=dialog`/`aria-modal`）；分区携带 `aria-current`。
- react-router 必须是平台单例——插件私自打包自己的副本会拆裂 history 身份并静默破坏每个路由页面；编译期 seed 投影钉死了配对，却无法阻止第二次 import，因此 `react-router` 只能经平台模块到达 bundle。
- 省略 ui-router 行的组合会让 web boot 审计响亮失败并点名等待中的行——绝不静默降级。
