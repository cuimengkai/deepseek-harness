# Agent Note: 插件目录安全加固：列表时过滤、安装期收容与客户端缓存

Status: implemented

[English](2026-08-23-plugin-catalog-security-hardening.md) | 中文

## 问题

统一的插件管理器交付了在线安装/卸载，但对照用户「安全第一」的指令——非法与无效的目录条目在列表展示时一律剔除，安装与卸载必须彻底——仍有三个缺口。topic 条目仅供浏览，因为 GitHub 仓库不是可安装的 npm 包；控制台能展示却无法安装它们。每次挂载标签页、每次刷新都会重新读取整个目录，因为既没有客户端缓存也没有推送；控制台反复命中 Remote。而网络安装会在主机上运行包管理器与包的生命周期脚本，无签名校验、无沙箱——用户明确指出，装了不安全插件带来的后果负担不起。

## 决策

Phase A 加固交付六个 seam，全部记录在 plugin-manager README，并可在 `cordis.yml` 中调整。诚实边界仍然立在案上：插件代码仍在 Host 进程内执行，因此进程级运行时隔离是后续阶段；本阶段收容安装步骤、记录来源，并要求显式信任确认。

### 列表时校验与过滤

服务端策略模块（`src/validator.ts`）在构建快照时以及 `findInstallable` 内部对所有非 `static` 目录条目施加同一道门，因此控制台无法通过直接安装已被列表剔除的名字来绕过过滤。每条条目先经过语法门：`topic`/`awesome` 名字必须是 `owner/repo` 形态，`manifest` 条目的 `installRef` 必须是安全 allowlist 内的 npm 规格——`file:` 与其他本地路径 scheme 一律拒绝。随后 `topic`（始终）与可选的 `awesome` 条目经 GitHub contents API 探测 npm 可安装性——有合法且非 `private` 名字的根 `package.json` 即 `installable`，404 是 `not-installable`，速率限制与服务端错误是 `unknown`。`not-installable` 与 `unknown`（未探测、速率受限、预算耗尽）条目在列表时被剔除，绝不按仅供浏览显示；离线的来源跳过探测并保留条目仅供浏览，因此离线控制台仍能看到缓存里有什么。判定持久化在 `$DSH_HOME/plugins/cache/probes.json`，带新鲜度 TTL；探测预算（默认 10）限制一轮最多探测多少未缓存仓库；GitHub 的匿名速率限制由 15 分钟的 topic 缓存与判定缓存吸收。每个源通过 `PluginManagerCatalogSourceStatus` 上的 `filteredCount` 上报剔除的条目数，让控制台看到过滤确实发生过，而不是默默隐藏条目。

### 安装期收容

`installArgv` 默认追加 `--ignore-scripts`，并把 npm 的缓存重定向进每插件 store 目录，因此卸载时缓存随 store 一并删除。`installSandbox`（默认 `true`）开启时，包管理器调用在 OS 沙箱的 `workspace-write` 文件策略下运行，作用域限定为 store 目录；开启但没有可用后端时，安装以 `sandbox-unavailable` 被拒，包管理器绝不裸跑。生命周期脚本只在部署设置 `allowInstallScripts` 且请求设置 `allowScripts: true` 时才运行，两者默认均为关。随附沙箱后端不限制网络，因此脚本与外联风险由 `--ignore-scripts` 与信任门承担；沙箱把恶意包在安装步骤中的文件破坏面框住。

### 完整性账本

溯源账本记录新增 `version` 与 npm `integrity`，安装成功后从 store 的 `package-lock.json` 读取。`verifyStoreIntegrity` 重新读取锁文件并报告 `ok`、`tampered` 或 `missing`；完整性漂移的已安装条目在目录快照中带完整性警告、在控制台带篡改徽标；`uninstall` 删除前先校验，但仍会完整删除 store——疑似被篡改的插件恰恰是最需要删干净的那个。

### 显式信任确认，宿主强制

`PluginManagerInstallRequest` 新增必填的 `confirmed: boolean`。`requireInstallConfirmation`（默认 `true`）开启时，缺少 `confirmed: true` 的网络安装请求以 `confirmation-required` 被拒；该检查在 Host 侧强制执行，绕过控制台依然命中。目录快照携带 `capabilities` 块——`networkConfirmation`、`allowInstallScripts`，以及取 `confined`/`unconfined`/`unavailable` 的 `installSandbox`——让控制台精确渲染部署允许的信任面。信任对话框展示模块、确切的安装规格、来源种类与仓库 URL，声明该操作会安装并运行第三方代码且生命周期脚本默认禁用，并把「安装」按钮挡在确认勾选之后；仅当部署宣告时它才提供脚本勾选，且当部署无法收容时禁用「安装」。

### 客户端缓存与事件转发

`api-remotes` 名单新增 `plugin-inventory/changed` 与 `plugin-manager/catalog-changed`，Host 转发循环随之把它们中继给客户端。plugin-inventory 网关把一帧内的 Loader 生命周期事件（`loader/entry-init`、`loader/partial-dispose`、`internal/plugin`、`internal/status`）合并为单次微任务发射，且只在重算投影与上次已发内容确实不同时才发射，因此 `internal/status` 的 Fiber 迁移不会用无变更的 nudge 洪泛线缆；plugin-manager 在每次已提交的安装/卸载与每次 `refreshCatalog` 后发射。清单标签页在跨标签页重挂载存活的 store 里为每个面各持有一份快照，订阅转发事件，并且只在标签页存在存活订阅者时重拉某个面——未挂载时到达的事件把该面的缓存快照标记为过期，下次挂载重拉它，而不是展示过期的视图。`connection/reset` 强制完整重载，因为缓存快照属于上一个 Host 进程。

### topic TTL

`topic` 缓存 TTL 从 60 秒降到 15 分钟，让主题搜索与 npm 可安装性探测装进 GitHub 的匿名预算（约每小时 60 次请求）；`cacheTtlMs` 全局覆盖它，`validationProbeBudget` 调节探测频率。

## 备选方案

**在 UI 过滤而不是在线上过滤。** 用户的指令明确要求非法与无效条目在列表展示时剔除、安全第一；UI 过滤可被直接 Remote 调用绕过，因此门禁放在服务端，且 `findInstallable` 应用同一道门。

**以 `npm view user/repo` 作为可安装性探测。** 它会 clone 仓库、很慢，并且把匿名预算烧在传输上而不是一次 contents 抓取；经 GitHub contents API 读取根 `package.json` 只有一次请求和一次 base64 解码。

**同时限制网络的沙箱。** 随附沙箱后端（bwrap、landlock、seatbelt、Windows ACL）按策略都不限制网络；构建网络命名空间超出范围，因此脚本与外联风险由 `--ignore-scripts` 加信任门承担，沙箱把恶意包在安装步骤中的文件面框住。

**直接封禁网络安装。** 用户要的是让安装安全地工作，而不是让安装消失；收容、账本与显式确认保住了这条路径，同时让风险显式、让默认值安全。

**客户端轮询目录变化。** 轮询会让每个挂载的控制台按间隔花一次 Remote 读取；转发事件随推送的 Host 变化收敛，未挂载时零开销，改以标记过期处理。

**在本阶段做运行时隔离。** 子进程插件宿主才是恶意插件运行时代码的正解，但它是规模很大的架构阶段；本注把它记为下一阶段，而不是交付一个 JS 求值无法诚实提供的进程内门禁。

## 结果

剔除规则在服务端，因此列表已移除的条目无法被直接调用安装——控制台不可绕过。网络安装默认无法运行生命周期脚本，且 `installSandbox` 开启时无法裸跑；缺少后端时拒绝安装，而不是让 npm 裸奔。账本在 store 层面检测本地漂移，检测不了被攻破的上游 registry 或被更换的已发布 tarball。宿主强制的确认让信任决策显式且不可绕过控制台。客户端缓存两个面，只在挂载期间随推送事件收敛，因此重新选择标签页不再重新读取两个 Remote。代价：GitHub 速率限制约束探测预算，未探测的仓库被剔除而不是按仅供浏览显示（离线来源除外）；把 `installSandbox: false` 或 `requireInstallConfirmation: false` 的运维方接管了默认值本应承担的风险；在子进程插件宿主落地之前，社区插件代码仍在进程内运行。
