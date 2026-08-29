---
description: "Web 壳的 SPA dist 服务器：占据 webserver 回退席位，以遍历拒绝与显式 History API index 路径前缀服务已构建的前端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-frontend-static

[English](README.md) | 中文

## 概述

浏览器从 `dsh-host-frontend-static` 获取已构建的 Web 壳：它占据 [webserver](../webserver/README.zh.md) 回退席位，并按锁定语义服务已构建前端目录——dist 根目录、配置的 index 路径，以及配置的 History API pathname 前缀在未命中文件时以 HTTP 200 渲染 `index.html`，其他已有文件直接提供，dist 根目录内未列入允许列表的缺失或非文件 target（包括配置的 index 缺失）返回空 404，越出 dist 根目录的遍历返回 403，未知扩展名按 `application/octet-stream` 提供，GET／HEAD 之外的方法在没有匹配的具名路由时返回 405。每个成功的 index 响应都经 webserver 的 `renderIndex` 渲染，启动 manifest（元数据清单）就是经这条路径送达页面的。回退席位只有单一所有者：第二次占据会抛错，卸载插件即释放席位。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在服务已构建 Web 壳的浏览器宿主中组合本插件：它占据 webserver 的回退席位，并应答所有未被具名路由命中的请求。它需要已构建前端 `index.html` 的绝对路径，以及可选的客户端 History API 路由 pathname 前缀（刷新或深链时必须存活）。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-host-frontend-static'
  config:
    distIndex: /absolute/path/to/dist/index.html
    indexPaths:
      - /settings
```

`distIndex` 是组合应用的组装事实：[`dsh-web-app`](../../bundle/web-app/README.zh.md) 通过前端包的 exports 解析它，并以 `indexPaths: ['/settings']` 挂载本插件以覆盖设置页；部署绝不硬编码 dist 路径。

### 服务器强制什么

请求从 dist 根目录（包含 `distIndex` 的目录）提供。dist 根目录与配置的 index 路径以 HTTP 200 渲染 `index.html`；pathname 等于或位于某个 `indexPaths` 条目之下的未命中，在认证后同样渲染 index。任何其他已有文件按自身 MIME 类型直接提供，未知扩展名按 `application/octet-stream` 提供。解析到根目录之外的路径以 403 拒绝，因此精心构造的路径无法读取 dist 之上的文件。dist 根目录内未列入允许列表的缺失或非文件 target——文件缺失、目录或配置的 index 缺失——返回空 404。没有匹配具名路由的非 GET／HEAD 请求回答 405。每个成功的 index 响应都经 webserver 的 `renderIndex` 渲染，因此启动 manifest 在 `/`、配置的 index 路径以及允许列表中的 History 路径上到达页面。

根路径、配置的 index 与允许列表未命中的响应会在读取 HTML 前调用 `ctx.connection.authorizeIndex`。有效进程 token 会得到 303 重定向与持久浏览器 cookie；已有有效 cookie 时直接提供 index；其他 index 请求得到 Connection 所有的 401 响应。非 index 文件仍是公开静态资源。Token、cookie、过期时间与签名记录语义都归 Connection 所有。

### 可观察的失败

遍历返回 403 而不是错误页。dist 根目录内未列入 `indexPaths` 的缺失或非文件 target 返回空 404，因此失效链接或拼错的 pathname 是显式失败，而不是静默的 SPA 回退。第二次占据席位会抛错，而席位无人占据时 webserver 回答 404——本插件 fiber 被 dispose 后浏览器看到的就是它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计概念

本包是围绕 `serveStatic` 的单一函数插件：`apply` 从 `distIndex` 解析 dist 根目录，构建在原始 `index.html` 上运行 `ctx.webServer.renderIndex` 的 `renderIndex` 闭包，并在 effect 作用域下注册回退处理。席位按 webserver 约定只有单一所有者——第二次注册会抛错——且受 effect 作用域约束，因此 dispose fiber 即释放席位。

### 遍历围栏

`serveStatic` 规范化请求的 pathname 并拼到 dist 根目录，然后要求 target 是根目录本身或停留在其下。检查使用 `sep` 而非 `/`，因为 `resolve()` 在 Windows 上发出反斜杠路径，此时 `/` 后缀会把每个合法子路径都当成遍历而拒绝。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `serveStatic` 与 `apply`：回退占据、遍历拒绝、index 渲染、MIME 表 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当服务约定不够用时阅读这些：先是席位所有者的约定，然后是解析 dist 的组合与子系统参考。

- [Webserver](../webserver/README.zh.md)——本插件占据的回退席位及其运行的 index 注入点。
- [dsh-web-app 捆绑包](../../bundle/web-app/README.zh.md)——解析 `distIndex` 并挂载本插件的应用。
- [HTTP 服务器子系统](../../../docs/subsystems/web-server.zh.md)——回退席位如何契合路由表。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-host-frontend-static)——每个接受的配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

无；SPA dist 服务器应答浏览器资产请求，不注册任何面向模型的内容。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明某个资产类别何时尚未被覆盖。它们是当前包约束，不是任务积压。

- **初始 MIME 表很精简**：它覆盖 Vite 输出的资产集合及实际交付的 PWA manifest；其他扩展名在相应资产类别发布前都会回退到 `application/octet-stream`。
- **Pathname 路由是显式声明**——History API 路由只有在其 pathname 前缀列入 `indexPaths` 并带有真实组合覆盖时，刷新才能存活。基于 Accept 或扩展名的宽泛 SPA 回退已被拒绝。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
