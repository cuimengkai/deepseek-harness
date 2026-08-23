# @deepseek-ai/dsh-host-plugin-manager

[English](README.md) | 中文

面向 Web 控制台的插件在线安装/卸载，包括来自可配置目录源的真实网络安装。`PluginManagerGateway` 注册 `pluginManager` 服务，并发布四个由 Typert 生成的直接 Remote：`pluginManager/listAvailable`、`pluginManager/refreshCatalog`、`pluginManager/installPlugin` 与 `pluginManager/uninstallPlugin`。公开 payload 类型位于 `./types` 下；该服务仅限 Remote 使用，不声明同进程的 Cordis `Context` 合并，因此客户端包通过显式的 [`api-remotes`](../../api/remotes/README.zh.md) 组装消费它，而不是导入 Host 实现。

`listAvailable` 从配置的源（`Config.sources`）读取合并后的目录，先让每个网络源经过列表时校验门（§校验与信任），再把每个幸存条目标记 `installed`。`refreshCatalog` 绕过缓存重新抓取每个网络源。`install` 在合并目录中查找请求的名字——同样经过这道门，因此被剔除的条目无法通过直接调用安装——然后要么为本地可解析的模块提交一行受管理的 home 补丁，要么在提交该行之前执行受收容的包管理器网络安装；运行中 Host 的 config-HMR 监视器重新组合，根 Include 无需重启即可挂载该 Fiber。不在任何目录源中的名字会落入内置 spine 路径：被停用的 harness 插件通过清除其停用覆盖来重装。`uninstall` 只移除受管理的行（Loader 条目 id 为 `dsh-managed-<slug>` 且模块名匹配），对于网络安装，还会移除 store、符号链接与账本条目；内置 harness 插件改为写入持久的 `disabled: true` 覆盖（补丁无法删除行，因此启用状态是唯一的可逆开关）；绝不触碰用户手写的行、bundle 或 profile 补丁层或其他模块。每次已提交的安装或卸载以及每次 `refreshCatalog` 都会发出 `plugin-manager/catalog-changed` Host 事件（按帧合并），由 [`api-remotes`](../../api/remotes/README.zh.md) 转发循环中继给订阅的客户端。

## Config

`Config.sources` 是源描述符的列表，按顺序合并。随附默认值为 awesome 精选列表加上 GitHub `dsh-plugin` 主题搜索。当 `sources` 缺省时，兼容旧的 `catalog` 选项并规范化为一个 `static` 源。`static` 种类持有内联的本地可解析模块列表（即 v1 面，无网络步骤即可安装）。`awesome` 种类以仓库 tarball 形式抓取 awesome-dsh-plugin 精选列表，并在本地解析 `data/plugins/*.yml`；每条目按其 GitHub `user/repo` 规格安装。`topic` 种类执行 GitHub 仓库搜索，探测每个仓库的 npm 可安装性，只展示可安装者（拥有根 `package.json`、名字合法且非 `private` 的仓库）；未探测与非包仓库在列表时被剔除，绝不按仅供浏览显示。`manifest` 种类在 `url` 处抓取通用 JSON 清单（数组或 `{ entries: [...] }` 对象），是私有市场这一文档化的扩展点；每条目的 `ref` 是 npm 安装规格，缺省时默认为条目 `name`。

网络行为属于部署策略：`offline` 跳过所有网络抓取与安装，只提供缓存与 static 条目；`installPrefix` 把安装根从默认的 `$DSH_HOME/profiles` 移走；`packageManager` 指定可执行文件（默认 `npm`）；`fetchTimeoutMs` 约束每次清单抓取（默认 `30_000`）；`cacheTtlMs` 覆盖按种类的缓存 TTL（`topic` 默认 15 分钟，以保持在 GitHub 匿名预算内）。

安装安全同样属于部署策略，全部可在 `cordis.yml` 中调整：

- `installSandbox`（默认 `true`）让每次网络包管理器调用都在 OS 沙箱的 `workspace-write` 文件策略下运行。启用但无可用后端时，安装以 `sandbox-unavailable` 被拒——包管理器绝不裸跑。
- `allowInstallScripts`（默认 `false`）决定是否允许生命周期脚本；除非该配置与请求的 `allowScripts` 同时为真，否则每次安装都会追加 `--ignore-scripts`。
- `requireInstallConfirmation`（默认 `true`）让 Host 拒绝缺少显式 `confirmed: true` 的网络安装请求（`confirmation-required`）；该检查在 Host 侧强制执行，绕过控制台依然命中。static 与内置安装是可逆的本地操作，从不要求确认。
- `validationProbeBudget`（默认 `10`）限制一轮目录扫描最多探测多少未缓存的仓库的 npm 可安装性，`validationProbeTtlMs`（默认 24 小时）决定已缓存判定的新鲜度。两者都是因为 GitHub 匿名 contents API 受严格速率限制。
- `probeAwesome`（默认 `false`）把 npm 可安装性探测扩展到 `awesome` 条目；精选列表默认受信任。

## 校验与信任

列表时过滤是服务端策略模块（`src/validator.ts`），在构建快照和 `findInstallable` 内部都生效，因此无法通过直接调用安装一个已被列表剔除的名字来绕过控制台。每个非 `static` 条目先经过语法门：`topic`/`awesome` 的名字必须匹配 `owner/repo`，`manifest` 条目的 `installRef` 必须是安全的 npm 规格（裸名、`@scope/name`、`user/repo[#branch]` 或公开的 `https`/`git+https`/`github:` URL）——`file:` 等本地路径 scheme 一律拒绝。随后 npm 可安装性探测经 GitHub contents API 读取每个仓库的根 `package.json`；404（无清单或私有仓库）为 `not-installable`，速率限制与服务端错误为 `unknown`，两者都被剔除而非展示。判定持久化在 `$DSH_HOME/plugins/cache/probes.json`，带新鲜度 TTL，因此一个仓库探测过后，后续刷新通常零探测。每个源通过 `PluginManagerCatalogSourceStatus` 上的 `filteredCount` 上报剔除条目的数量，让控制台能看到过滤发生过，而不是默默隐藏条目。离线的源跳过探测，保留条目仅供浏览，因此离线控制台仍能看到缓存里有什么。

## 网络安装与卸载

网络安装会在 `<installPrefix>/node_modules/.dsh-plugins/<slug>/` 构建每插件独立的 store——一个显式带 `--legacy-peer-deps` 的隔离 npm 工程——对该条目的 `installRef` 运行包管理器（生命周期脚本默认关闭，处于 OS 沙箱内，npm 缓存重定向到 `<slugDir>/.npm-cache` 以便卸载时随 store 一并删除），发现解析出的包名，并把 `<installPrefix>/node_modules/<name>` 符号链接到 store 模块。store 位于经修复的 `profiles/node_modules` fallback 之下，因此已安装插件的 peer 导入（`@deepseek-ai/cordis`、Service Definition 包）通过 Node 的父目录向上查找解析到 Host 唯一的 cordis，而不是 npm 安装的重复副本。解析出的名字、版本与 npm integrity 记入溯源账本 `$DSH_HOME/plugins/installed.json`，随后追加受管理的 home 补丁行，让 HMR 挂载该 Fiber；与已挂载或已管理的解析模块冲突，会在包管理器运行之后报告为 `already-installed`。目录快照携带 `capabilities` 块（`networkConfirmation`、`allowInstallScripts`、`installSandbox` 取 `confined`/`unconfined`/`unavailable`），让客户端精确渲染该部署允许的信任面。

`uninstall` 先移除受管理的行（经 HMR 卸载 Fiber），再移除符号链接、store 与账本条目。移除前会对照账本校验网络 store——完整性漂移在结果的警告路径上报，但 store 仍会被完整删除，因为疑似被篡改的插件恰恰是最需要删除干净的那个。当用户接管了该模块的行时，store 与账本会被保留，让模块继续挂载且溯源得以存续，调用报告 `not-managed`。行已移除之后的清理失败返回 `remove-failed`，留下可由重试清理的孤儿。

拒绝码：`invalid-name`（标识不是裸模块名）、`invalid-entry`（目录条目未通过列表时校验门）、`not-found`（名字不在任何源中，也不在已挂载的 spine 中）、`offline`（网络安装被禁用）、`already-installed`、`not-installed`、`not-managed`、`in-use`（该模块属于 plugin-manager 自身的运行时底座，无法在进程内停用）、`confirmation-required`（缺少显式信任确认的网络安装）、`sandbox-unavailable`（请求了沙箱收容但不可用——包管理器从未运行）、`install-failed`（包管理器或 store 初始化失败，stderr 尾部在 `message` 中）以及 `remove-failed`。安装响应是对已提交行的调用当下快照——挂载异步落地，控制台通过重新读取清单来观察结果。

## 模型体验

无，因为这个仅限 Host 的管理面不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **社区安装的代码在进程内执行** —— 网络安装运行的插件代码在 Host 进程内部执行；`--ignore-scripts` 与 OS 沙箱收容的是安装步骤，显式信任确认与完整性账本给运维方提供了证据，但没有进程边界在运行时隔离恶意插件。真正的运行时隔离（子进程插件宿主）是后续架构阶段；在那之前，安装未经验证的包属于运维方的决定。
- **GitHub 源受速率限制** —— 主题搜索与 npm 可安装性探测共享 GitHub 的匿名预算（约每小时 60 次请求）。15 分钟的主题缓存与探测判定缓存吸收了它；硬刷新仍可能命中 `403`，在 `listAvailable` 中按源上报，并带 `filteredCount` 说明预算耗尽后未探测的条目数。
- **不锁定版本** —— topic 或 awesome 条目安装的是当前仓库 HEAD（`npm` 的 GitHub 简写）；账本记录的是解析出的版本与 integrity，而非冻结的 SHA。manifest 源可通过提供确切的 tarball `ref` 来锁定。
- **完整性是 store 层面的检查，不是包签名** —— 账本把当前的 `package-lock.json` 与记录的 npm integrity 对比，因此能检测本地漂移，但无法检测被攻破的上游 registry，也无法检测作者更换已发布 tarball。
- **peer 共享依赖 profiles fallback** —— `--legacy-peer-deps` 跳过 npm 的 peer 自动安装，让 peer 经修复的 `profiles/node_modules` 解析，这要求安装前缀处于该父目录向上查找链中；把 `installPrefix` 移离默认值会破坏共享，npm 将安装重复的 `@deepseek-ai/cordis`。
- **受管理行绝不覆盖用户行** —— `uninstall` 只移除 Loader 条目 id 带 `dsh-managed-` 所有权标记且模块匹配的行；同名的手写行会保留原位，并报告为 `not-managed`。
- **内置“卸载”是持久化停用，不是删除行** —— 补丁无法删除行，因此卸载随附的 harness 插件会在其裸行 id 上写入 `disabled: true` 覆盖，再次安装则清除它（`disabled: false`）；两者完全可逆且幂等。plugin-manager、plugin-inventory 以及承载 manager 自身 wire 调用的 API/typert 网关固定在不可移除集合中，卸载时以 `in-use` 拒绝——manager 无法停用执行请求的那只手。
- **绕过安全默认值是刻意的部署选择** —— `installSandbox: false` 与 `requireInstallConfirmation: false` 会完全移除拒绝门；设置它们的运维方接管了默认值本应承担的风险。
- **重写会丢弃 YAML 注释** —— 带锁的读-改-写会经 Loader 条目列表 schema 重新序列化 home 补丁，因此 `$DSH_HOME/cordis.patch.yml` 中手写的注释不会被保留。
