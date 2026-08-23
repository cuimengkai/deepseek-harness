# Agent Note: 通过 Web 设置界面在线安装/卸载插件（home 补丁热更）

Status: implemented

[English](2026-08-22-live-home-patch-plugin-install.md) | 中文

## 问题

Web 设置界面有插件列表（`ui-settings-plugin-inventory`，对 `ctx.loader.entries()` 的只读 `list` Remote 投影）和插件配置，但没有任何方式从界面安装或卸载插件。需求是把既有标签页打通，支持在线安装插件 / 在线卸载插件，并接入真实的市场：可配置的目录源（`awesome-dsh-plugin` 精选列表与 GitHub `topic:dsh-plugin` 搜索）、清单层、真实的 npm 网络安装，以及插件管理。

## 决策

热更即时生效仍是机制本身。`PluginManagerGateway`（`packages/host/plugin-manager`）注册 `pluginManager` Remote 服务，提供四个 direct 动词——`listAvailable`、`refreshCatalog`、`install`、`uninstall`。每一次受管理的安装都会通过加锁的读-改-写（`withFileLock` + `writeFileAtomic`，`0o600`/`0o700`）向 home 级用户补丁层 `$DSH_HOME/cordis.patch.yml` 追加恰好一行受管理的 `insert` 条目；运行中 Host 的 config-HMR 监视器重新组合，根 Include 无需重启进程即可挂载该 Fiber。返回的安装值是已提交行的调用当下快照——挂载经 HMR 异步落地，控制台通过重新读取清单来观察结果。`uninstall` 只移除 Loader 条目 id 带 `dsh-managed-` 所有权标记且模块名匹配请求的行；绝不触碰用户手写的行、bundle 与 profile 补丁层，或其他模块，其余情形分别以 `not-managed` 与 `not-installed` 拒绝。该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge；Client 包通过显式的 `api-remotes` 组合消费它，而不导入 Host 实现。

### 目录源

`listAvailable` 投影一份来自 `Config.sources` 的合并目录——按顺序组合的源描述符；随附默认为 awesome 精选列表加上 GitHub `dsh-plugin` 主题搜索。`static` 种类持有内联的本地可解析模块列表——即 v1 面，无网络步骤即可安装——当 `sources` 缺省时，兼容旧的 `catalog` 选项并规范化为一个 `static` 源。`awesome` 种类以 codeload tarball 形式抓取 awesome-dsh-plugin 仓库，并在本地解析 `data/plugins/*.yml`；每条目按其 GitHub `user/repo` 规格安装。`topic` 种类执行 GitHub 仓库搜索且仅供浏览——仓库不是可安装的 npm 包，因此 topic 条目不提供安装操作。`manifest` 种类在 `url` 处抓取通用 JSON 清单，是私有市场这一文档化的扩展点；每条目的 `ref` 是 npm 安装规格，缺省时默认为条目 `name`。每个网络源解析后的清单按源键缓存到 `$DSH_HOME/plugins/cache/`，带按种类的 TTL（`topic` 60 秒，`awesome`/`manifest` 一小时），用以吸收未认证的 GitHub 速率限制；`offline` 跳过所有网络抓取与安装，只提供缓存与 static 条目；重新抓取失败时提供过期缓存；每个源 id 共享同一份进行中的抓取；`refreshCatalog` 绕过缓存。

### 网络安装与卸载

网络安装会在 `<installPrefix>/node_modules/.dsh-plugins/<slug>/` 构建每插件独立的 store——一个持有确定最小清单的隔离 npm 工程——并在其中以 `install --legacy-peer-deps --no-audit --no-fund <installRef>` 运行配置的包管理器（`packageManager`，默认 `npm`），经由可注入的 `runPackageManager` seam（用净化后的父环境 spawn，120 秒上限；测试会 stub 它）。解析出的包名以 store 清单的唯一依赖键读回。安装顺序是承重的：包必须在受管理行落地之前可解析，因为 config-HMR 组合会在组合当下重新解析该行的模块名——先安装后落行能挂载，先落行后安装会以 `phase: 'failed'` 挂载。解析出的名字被符号链接进修复后的 `profiles/node_modules` fallback（`<installPrefix>/node_modules/<name>` → store 中的已安装副本），并记入溯源账本 `$DSH_HOME/plugins/installed.json`（同一文件锁下的原子读-改-写），随后追加命名该解析模块的受管理行，让 HMR 挂载该 Fiber。与已挂载或已管理的解析模块冲突，会在包管理器运行之后报告为 `already-installed`，并回滚 store。`uninstall` 先移除受管理行（经 HMR 卸载 Fiber），再移除符号链接、store 与账本条目。当用户接管了该模块的行时，store 与账本会被保留，让模块继续挂载且溯源得以存续，报告为 `not-managed`；行已移除之后的清理失败返回 `remove-failed`，留下可由重试清理的孤儿。`install-failed` 在 `message` 中携带诊断信息（包管理器的 stderr 尾部，或模块发现错误）。

### 经 profiles fallback 的 peer 共享

`--legacy-peer-deps` 跳过 npm 的 peer 自动安装，因此已安装插件的 peer 导入（`@deepseek-ai/cordis`、Service Definition 包）在导入时经 Node 从 store 的已安装副本向上查找解析。默认 `installPrefix = $DSH_HOME/profiles` 时，该查找链经过 `healProfilesModuleFallback` 维护的 `profiles/node_modules`——应用依赖闭包里每个包一个符号链接——因此每个已安装插件都共享 Host 唯一的 cordis，而不是让 npm 安装重复的 Service 实例。把 `installPrefix` 移离默认值会破坏该共享。

### 受管理行的所有权规则

每一受管理行都是 `- insert: [{ id: 'dsh-managed-<slug>', name: '<module>' }]`，其中 `slug = name.replace(/^@/, '').replace(/[^a-z0-9]/gi, '-').toLowerCase()`。`dsh-managed-` 前缀是所有权标记：`uninstall` 在移除行前同时匹配条目 id 与模块名，因此同名的用户手写行会保留原位并报告为 `not-managed`。

### 不纳入特权门控

`pluginManager.*` 刻意不加入 `PRIVILEGED_METHODS`。`trustedHosts` 是 DNS 重绑定围栏而非鉴权；home 补丁是用户自有配置，LAN 调用方已可等效地手写 `cordis.patch.yml`，也可通过本就未特权的 `agentPreset.*`/`session.create` 表面达成同等能力。这一点现在也涵盖网络安装路径：配置的包管理器及其安装的代码会在主机上运行，且没有生态签名校验，因此 `awesome`——精选列表——是可安装的默认源，`topic` 仅供浏览，每次安装都会把确切的安装规格记入账本。安装未经验证的包属于运维方的决定；包管理器的 landlock 约束暂缓，与不加约束的 `dsh plugin` pnpm 先例一致。

## 备选方案

**仅内存安装、不留持久化行。** 直接挂载 Fiber 会让卸载在第二个进程里无可移除，也无法在重启后存活；home 补丁是既有配置监视器已经在监视的唯一真源，因此已提交的行无需新增任何生命周期。

**需要重启的安装。** 用户选择的是热更即时生效而非重启流程，且 config-HMR 组合会在组合当下重新解析新加入的模块名，因此只要包在行落地前可解析，网络安装的包无需重启即可挂载。

**位于解析链之外的插件 store。** store 位于 `profiles/node_modules/.dsh-plugins/` 内部，正是为了让已安装插件的向上查找链到达修复后的 fallback；孤立的 store 会迫使 npm 的 peer 自动安装（或维护手工的 peer 链接集），并拉入重复的 `@deepseek-ai/cordis`。

**对管理表面做特权门控或回环固定。** 该表面操作的是 LAN 调用方本就能手改的用户自有配置；增加特权要求或钉住回环既掩藏不了什么，又会破坏预期的远程控制面用途。

## 结果

网关不拥有任何监视器——它只在文件锁下读取 `ctx.loader.entries()`、账本与 home 补丁——因此也不拥有可释放的 HMR 生命周期；真实组合的 loader 测试通过实际的配置监视器证明了安装挂载与卸载释放，对 static 与 store 安装的网络 fixture 都成立（即 registry 贡献的 disposal 证明）。单进程内的变更都串在单一操作尾部之后；跨进程写者仍如既往地在 home 补丁文件锁上竞争。受管理行绝不覆盖用户行。home 补丁的重写经 include 的条目列表 schema 重新序列化，因此 `$DSH_HOME/cordis.patch.yml` 中的手写 YAML 注释不会被保留。网络安装会执行无签名校验、无版本锁定的第三方代码（awesome/topic 条目安装当前 HEAD）；账本记录确切的安装规格，卸载会一并移除 store、符号链接与账本条目。
