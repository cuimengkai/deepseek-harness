# Agent Note: 显式 Web index 路径与静态资源未命中的 404

Status: implemented

[English](2026-08-20-explicit-web-index-paths.md) | 中文

## 问题

无条件 SPA 回退会让每个未匹配的 GET 或 HEAD 请求看起来都成功。失效的普通链接，以及缺失的 JavaScript、样式表、source map 或 manifest，都会收到状态码为 200 的 HTML 外壳，导致浏览器、缓存与监控无法区分有效页面入口和缺失资源。

## 决策

`dsh-host-frontend-static` 在规范化目标为 dist 根目录或配置的 index 路径时，或在文件未命中且位于配置的 `indexPaths` 前缀之下时，渲染 `index.html`。已发布的 Web 组合列出 `/settings`，使客户端 History 路由 `/settings/:section?` 在刷新与深链时仍能存活。查询字符串不会改变 pathname 匹配，URL 片段也不会到达服务器。现有文件照常提供，而未列入允许列表的 `ENOENT`、`EISDIR` 和 `ENOTDIR` 读取产生不带内容类型的空 404 响应。其他文件系统失败会重新抛给 webserver 的请求失败处理，不会被错误标记为缺失。

GET 与 HEAD 对 index 入口、文件和未命中项使用相同的状态码与内容类型。具名路由仍先于回退匹配，越出 dist 根目录的遍历仍返回 403，到达回退的非 GET/HEAD 请求仍返回 405。每个 index 响应（包括允许列表未命中）仍须通过 Connection 的 `authorizeIndex`。

## 曾考虑的替代方案

**根据路径没有文件扩展名来推断页面路由。** 文件扩展名不会声明客户端路由：这种做法仍会把未知普通路径变成成功页面，会拒绝未来任何带点号的客户端路由，也会在缺少无扩展名静态文件时错误处理该请求。

**把 `Accept: text/html` 请求头作为回退规则。** 该请求头表达的是内容表示偏好，而不是 pathname 是否为已声明的客户端路由。浏览器 fetch、机器人和监控都可能为无效路径请求 HTML，因此仍会产生同样的假成功行为。

**让 History 路由没有服务器入口。** 客户端已经注册了 `/settings/:section?`。没有匹配的服务器规则时，首次导航或刷新该 pathname 会返回空 404。在该路由落地后拒绝这一做法。

## 后果

失效链接与缺失资源具有可供缓存和监控观察的独立 HTTP 状态，资源加载器也不会把 HTML 外壳当作 JavaScript 执行。每条新的 History API pathname 路由必须在同一项变更中加入其 `indexPaths` 前缀（或等价规则）与真实组合覆盖。frontend-static 的真实 Loader 测试固定了 index 入口、允许列表 History 未命中、现有资源、普通未命中和资源未命中的 GET/HEAD 状态一致性，并覆盖类似 API 的路径、路径遍历、畸形目标、不支持的方法和回退释放。
