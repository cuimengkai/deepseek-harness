# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

外壳插件：三栏 AppFrame（拖动手柄与让步链）加 `ctx.layout` 面板几何服务；它注册到运行时拥有的 `root` slot，并声明 `sidebar`、`conversation`、`details`、`shell.overlay` 和 `page`。侧边栏的缩放边界是不可见命中条带，详情栏边界则保留其浮动胶囊；让步期间只有详情栏会收缩并随后自动关闭。关闭的侧边栏仍保留 56px 控制栏，详情栏则关闭到零宽度。该包还提供主题呈现器：它消费解析后的 `ctx.theme` 快照，并将其投影到 document（用 `html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，并将主题的别名 token 设为 body 上的内联变量，同时拥有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新）。在应用调色板和 token 后进行测量，可确保渲染后的背景成为唯一的颜色依据；呈现器在 dispose（资源释放）时会移除其自有的元数据节点，并一并清除其写入的其他全局状态。

AppFrame 始终挂载会话栏和详情栏；已连接 Session 通过 `SessionProvider` 渲染。布局 store 是瞬时状态，侧边栏以默认宽度启动，详情栏则保持关闭，且该 store 从不读写 `localStorage`。hero 和其他未选中状态也会将详情栏的渲染宽度派生为零，但不会改变存储的宽度偏好。AppFrame 会跨越这些状态保留最后一个非 blank 会话 id：首个会话保持关闭；显式打开详情栏的操作会使用约定默认宽度；返回同一会话时恢复其未改变的宽度；选择不同会话时，详情栏会在绘制前关闭。会话 owner share 为空，侧边栏 owner share 只包含 `collapsed` 和 `width`；注册方通过标准钩子获取业务数据，并从各自的 inject 接口获取操作。

框架的第五个子 slot `page` 是路由式整页表面：一组条目，其 `path` 选项（如 `/settings/:section?`）把条目变成页面路由。当某页面的 path 命中当前 URL 时，框架把该条目渲染到整个窗口之上、高于所有栏与 overlay，同时其下的应用 grid 变为 `inert`——DOM 级的焦点/指针守卫（包装层用 `display: contents`，因此各栏仍是直接的 frame grid 项，冻结应用的是 `inert` 而非一个盒子）。应用在覆盖页之下保持挂载是有意为之，因此开/关页面绝不会丢失会话或草稿状态；页面拥有自己的滚动容器。只按 id 渲染命中的条目，没有 path 的条目永远无法命中——带 path 的新 id 在随附的设置页旁注册一个新的整页表面。pages 投影骑在框架的 inject face 上，把 `page` 账本与 router 位置折成一份快照（按注册序排列的可路由条目加命中的页面 id），于是框架与任何页面消费方读到的是同一份 URL↔路由真相。

`/client` 导出表层包含插件主体（`apply`／`inject`）、`LayoutController`、`ILayout` 面板操作 face 与 `PagesSnapshot` 投影类型。AppFrame、面板 store、让步求解器与 pages 源仍属于包内部。

## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板几何信息是瞬时状态**：重新加载会恢复侧边栏默认值，并使详情栏保持关闭；在不同会话 id 之间切换同样会关闭详情栏，并忘记拖动后的宽度，而未选中表面会以零宽度渲染详情栏，但不会修改几何信息。
- **让步链自动关闭通过推导零宽度实现，不会改动宽度偏好**：窗口变宽时面板会自行恢复；消费方禁止把 store 中的详情宽度当作实际渲染状态。
- **挤压重排期间不提供滚动锚定**：布局变化可能移动读者的 viewport。
- **同一时刻只有一个激活页面**：框架只匹配第一个 path 命中的 `page` 路由并按 id 渲染该条目；堆叠或嵌套的页面表面不在范围内。
