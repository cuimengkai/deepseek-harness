# @deepseek-ai/dsh-client-ui-router

[English](README.md) | 中文

浏览器历史路由服务，客户端外壳唯一的 URL seam。它把 react-router v7 的 `UNSAFE_createBrowserHistory`（history 模式）包装成 uSES 兼容的可观测源，并通过 react-router 的 `matchRoutes`/`matchPath` 匹配页面路由模式，暴露 `ctx.router`：`getSnapshot`/`getVersion`/`subscribe` uSES 三元组、`navigate`/`back`/`forward`、对 `page` 槽条目的 `match`，以及针对单个模式的 `matchParams`。在入口的 apply 中经 `ctx.plugin(RouterService)` 构造——Service 构造函数把 `ctx.router` 注册到挂载 fiber 之下，history 监听器随该 fiber 一同消亡，因此 dispose 或重载会随着所在行拆掉订阅。

react-router 刻意只是内部的历史 + 匹配引擎：它从不进入 React 组件树，因为业务组件看到的是零 context（packages/client/AGENTS.md），所以页面经该服务的 snapshot/subscribe 对与导航方法消费 URL 状态，绝不通过 router context 或 `<Link>`/`useParams`。history 模式意味着真实 URL：路由即深链，浏览器返回/前进以及在路由处刷新都可用，重载会重新启动在打开时所在的路由上。

react-router 是共享平台模块：web 外壳把它一次性种子进冻结的模块表（`PLATFORM_MODULES` 加 `seed.ts` 中成对的静态 import，由 `satisfies Record<PlatformModule, unknown>` 投影在编译期钉死配对），于是每个动态 bundle 都解析到同一个 react-router 身份与同一条 history。外壳的路由表面——设置页——经由 ui-layout 的 `page` 槽骑在这个路由上：`path` 命中当前 URL 的 `page` 条目会在整个窗口之上渲染，同时其下的应用 grid 变为 inert。

只提供、不消费：该入口不注入任何服务，因此它必须在 strict 解析 `router` 的行（ui-layout、ui-settings-general）之前激活。web boot 按拓扑序创建条目，提供方行的 apply 会 await 自己的服务 fiber，因此消费行运行时 `ctx.router` 已可解析（[web boot 顺序创建](../../../.agents/notes/implemented/architecture/2026-08-23-web-boot-sequential-creates.zh.md)）；省略 router 行的组合会响亮地让 boot 审计失败，而不是静默降级。

## 模型体验

无。路由器只管理浏览器 URL 状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **react-router 必须是平台单例**：插件一旦私自打包自己的 react-router 副本，就会拆裂共享的 history/context 身份并静默破坏每个路由页面；编译期 seed 投影钉死了配对，却无法阻止第二次 import，因此 `react-router` 只能经平台模块到达 bundle。
- **`UNSAFE_createBrowserHistory` 是 react-router 的非稳定 API**：它被隔离在 `router.ts` 的唯一定义点，react-router 主版本一旦移除它，只需改动这一个文件。
- **react-router 锁定在 v7**：v8 把 React peer 要求抬到 ≥ 19.2.7，而外壳在 React 18.3.1 上，因此升级随 React 升级同行，不能单独进行。
