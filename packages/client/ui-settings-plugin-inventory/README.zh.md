# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

面向 Web 设置的**插件**标签页。浏览器插件注册一个 id 为 `all` 的本地化 `settings.plugins.tab` 贡献；“插件”分区拥有导航入口与标签栏。插件激活期间不会读取 Remote；首次选择该标签页时才挂载组件，并通过 [`api-remotes`](../../api/remotes/README.zh.md) 懒调用 `ctx.remote.pluginInventory.list()`（Loader 清单）与 `ctx.remote.pluginManager.listAvailable()`（合并后的可安装目录）。

该标签页把两个面渲染成按分类分组的统一列表。通过 plugin-manager 安装的插件以带 `dsh-managed-` 所有权前缀的 Loader 条目 id 挂载；客户端在比较前剥离 `include:` 获取器前缀，因此这些行合并到对应的目录卡片中，而不会出现两次。顶部的按源状态行报告每个目录源的 id、种类、状态（`已同步`、`获取失败`、`使用缓存`、`离线`）、条目数与抓取错误，并在 Host 的列表时校验门剔除条目时额外显示一个 `已剔除` 计数——控制台展示过滤确实发生过，而不是默默隐藏条目。工具栏包含搜索框、分类筛选菜单与一个刷新按钮，调用 `pluginManager/refreshCatalog` Remote 绕过缓存重新抓取每个网络源。搜索匹配模块名、裸条目 id、短名称、分类与描述；筛选菜单按分类列出各自的行数，外加 `全部分类 (N)`。

一个 store 为每个面各持有一份快照，并跨标签页重新挂载存活，因此再次选择该标签页会命中缓存快照，而不是重新读取两个 Remote。推送的 Host 失效事件让它无需轮询即收敛：store 订阅转发后的 `plugin-inventory/changed` 与 `plugin-manager/catalog-changed` 事件，各自只在标签页挂载期间重拉自己的面；标签页未挂载时到达的事件会把该面的缓存快照标记为过期，让下次挂载重拉。`connection/reset` 会强制完整重载两个面，因为缓存快照属于上一个 Host 进程。

**统一卡片。** 每个 Loader 条目与每个目录条目都渲染成同一张折叠卡片：一行徽标（Loader 行显示 harness 运行时徽标，目录行显示来源种类徽标）、可选的分类 chip、作为标题的模块短名称、一个状态标签（`已安装` / `未安装`）、已启用 spine 行上的根 fiber 状态圆点，以及一个操作按钮。Loader 条目的 `enabled` 标志即安装状态，因此两个面都经由相同的 `install(name)` 与 `uninstall(name)` Remote；卸载 harness 插件会在 Host 上持久化一条 `disabled` 覆盖，再次安装则清除它（机制见 [`plugin-manager`](../../host/plugin-manager/README.zh.md) README）。Host 的列表时校验门已经在上线前剔除了非法与未经验证的目录条目，因此渲染出的市场卡片要么可安装、要么仅可浏览；跳过探测的离线来源条目渲染 `仅可浏览` 提示，不带操作按钮。网络安装会显示不同的 `安装中…` 待处理状态（static 条目复用通用的处理中状态），且某个操作进行期间所有操作都被禁用。Host 侧完整性校验发现漂移的已安装网络条目会携带篡改徽标。

展开卡片后展示一个定义列表。Loader 卡片列出条目 id、状态、Cordis 状态（仅已启用行）、分类、描述与模块，并附一条提示该组件可随时重新安装的 harness 说明；目录卡片列出条目名称、星数与仓库链接（如存在）、状态、分类、来源、描述、确切的安装规格、安装后的解析版本，以及账本检测到漂移时的篡改详情。已提交的操作会重新读取两个面，让目录标签与 Loader 清单收敛到真实的挂载结果。

Host 强制确认的网络安装在请求离开浏览器前会先打开信任对话框。它展示模块名、确切的安装规格、来源种类与仓库 URL，声明该操作会安装并运行第三方插件代码且生命周期脚本默认禁用，并要求勾选确认框后才能启用“安装”按钮。仅当快照宣告 `allowInstallScripts` 时，对话框才提供“允许生命周期脚本（不推荐）”勾选框；当部署无法提供收容（`installSandbox: unavailable`）时，它会显示沙箱提示并禁用“安装”，因为 Host 本来也会拒绝该请求。确认后发送 `install(name, { confirmed: true, allowScripts })`。

Host 的 `pluginManager` Remote 把业务拒绝包装在传输层 Result 中；组件解开传输层，并把业务码（`invalid-name`、`already-installed`、`not-installed`、`not-managed`、`not-found`、`offline`、`in-use`、`confirmation-required`、`sandbox-unavailable`、`install-failed`、`remove-failed`）本地化，而不是当作传输层失败处理。`in-use` 覆盖运行时底座——plugin-manager 自身、Loader 与 API 网关——它们无法在进程内卸载自己。未知码与传输层失败回退到通用操作失败。目录读取失败会显示内联提示，Loader 行仍然可用；Loader 读取失败显示可重试的错误。加载、空结果、无匹配结果与通用失败状态只属于已挂载组件。注册使用 `ctx.slots.inject()`，因此能跟随标签 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

## 模型体验

无，因为本包只在浏览器设置中展示 Host 拥有的部署快照，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **推送的失效只在标签页挂载期间刷新** —— 转发过来的 Host 事件只在标签页存在存活订阅者时重拉自己的面；未挂载时到达的事件会把缓存快照标记为过期，下次挂载重拉它，而不是展示过期的视图。
- **目录变更以 manager 为边界** —— 安装与卸载只作用于 Host plugin-manager 拥有的目录条目与 spine 行；同名的手写 home 补丁行保持原样，并报告为 `not-managed`。
- **spine 卸载是持久化停用，不是删除行** —— 补丁无法删除行，因此卸载 harness 插件会写入一条 `disabled` 覆盖，稍后的安装会清除它；两个方向都完全可逆且幂等。
- **社区安装会在进程内执行第三方代码** —— Host 收容安装步骤（`--ignore-scripts` 与 OS 沙箱）、在账本中记录来源与完整性、并要求显式信任确认，但已安装插件自身的代码仍在 Host 进程内运行；真正的运行时隔离是后续架构阶段，确认对话框说得正是这一点。
- **离线来源保持仅可浏览** —— 跳过 npm 可安装性探测的来源会保留其条目但不可安装，因此离线控制台仍能看到缓存里有什么。
