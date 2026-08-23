# Agent Note: 面向 Web 设置中每一个插件的统一插件管理器

Status: implemented

[English](2026-08-23-unified-plugin-manager.md) | 中文

## 问题

Web 设置的插件标签页对两类插件采取了不同的管理方式。可安装目录（`pluginManager/listAvailable`）有安装/卸载、分类与来源徽标；Loader 清单（`pluginInventory/list`）则把约 168 个 harness spine 插件显示为已挂载行，带一个启停标签，却**完全没有卸载操作**。用户不接受这种隐式的“内置”类别：harness 插件无法移除、无法重装、没有分类，除了 Loader 树条目 id 之外也没有任何详情视图。他们原话要求对每一个插件——无论内置还是外置——都用同一套安装与卸载来管理，按分类分组，并提供详情查看。

阅读两个面时又暴露出两个缺陷。经 manager 安装的插件以带 `dsh-managed-` 所有权前缀的 Loader 条目 id 挂载，但这些 id 在线上以 `include:` 获取器前缀出现；客户端按裸前缀折叠，于是一次受管理安装会出现两次——既是目录卡片，又是一张裸 Loader 卡片。此外 spine 没有任何展示元数据：Loader 条目只携带 `{ id, name }`，因此对 harness 插件进行分组与描述没有数据来源。

## 决定

**统一管理。** 客户端把两个面渲染成一张按分类分组的、同构折叠卡片列表。Loader 条目的 `enabled` 标志即安装状态，因此两个面都经由相同的 `installPlugin(name)` 与 `uninstallPlugin(name)` Remote；每张卡片上的操作按钮都在安装/卸载之间切换。不存在“内置”类别：harness 插件与任何目录条目一样可卸载、可重装。

**spine 卸载是持久化停用。** 补丁无法删除行，因此卸载某个随附的 spine 插件会在用户 home 补丁中往其裸行 id 上写入一条 `disabled: true` 覆盖（`upsertDisabledOverride`，带锁的读-改-写）；config-HMR 监视器重组后 fiber 卸载。安装则清除这条覆盖（`disabled: false`）。两个方向都可逆且幂等。`uninstall` 的路由顺序是账本命中（网络安装）→ 随附 spine 条目 → 受管理的 static 行；`install` 则路由目录名 → 随附 spine 条目 → static 路径。Host 侧机制归属于 [在线 home 补丁插件安装笔记](../architecture/2026-08-22-live-home-patch-plugin-install.zh.md)。

**对运行时底座做硬保护。** manager 赖以执行的那五个模块无法在进程内停用——plugin-manager 自身、它所渲染的清单，以及承载其 wire 调用的 API/typert 网关（`IRREMOVABLE_MODULES`）：`@deepseek-ai/dsh-host-plugin-manager`、`@deepseek-ai/dsh-host-plugin-inventory`、`@deepseek-ai/dsh-host-apiproxy`、`@deepseek-ai/dsh-api-gateway`、`@deepseek-ai/dsh-typert-registry`。卸载以新的 `in-use` 码拒绝它们，本地化为“正在运行中,无法在此卸载”。这是运行时状态，不是分类；`include` 与 `hmr` 行被有意排除——include 根是程序化创建的（不是补丁行），且 profile 启动会在其行被停用时重建一个仅监视的 HMR 实例。Host 是执行点；客户端不复制这份 guard 清单。

**分类与描述元数据。** spine 行不带分类或用途，因此 `plugin-inventory` 持有以模块名为键的只读 `SPINE_META` 映射（`spine-meta.ts`）。`list()` 把可选的 `category` 与 `description` 投影到每个清单条目上；未知模块（用户安装、自定义覆盖行）两者都不投影。13 个分类标签与插件市场分类法同名（`ui`、`security`、`workflow`、`tools`、`session`、`skill`、`model`……），因此统一筛选使用同一套词汇。

**客户端表面。** 工具栏包含搜索框、分类筛选菜单（每个分类带行数，外加全部分类）与刷新按钮。列表按分类分组，每组带组头与计数；没有分类的行归入“未分类”。搜索匹配模块名、裸条目 id、短名称、分类与描述。展开卡片后展示详情面板：spine 行列出状态、Cordis 状态与模块；目录行列出来源、安装规格以及星数/仓库链接；并附一条提示停用的运行时组件可用「安装」恢复的 harness 说明。`dsh-managed-` 折叠现在先剥离 `include:` 获取器前缀再比较，因此受管理安装恰好出现一次。业务拒绝——包括 `in-use`——从传输层 Result 本地化，而不是当作传输层失败暴露。

本笔记超驰 [合并清单的简化笔记](../simplification/2026-08-22-merge-plugin-inventory-sections.zh.md)，其两面对一的合并正是本决定的前半部分。

## 备选方案

**保留一个独立的、不可管理的“内置”类别。** 用户拒绝：他们原话要求对内置与外置插件统一管理安装和卸载，并把卸载路径设计好。

**允许在警告后卸载 guard 集合。** 拒绝：用户选择了硬保护。在进程内停用 manager 自身的运行时底座会孤立执行卸载的页面与承载其 wire 调用的网关；`in-use` 拒绝是唯一安全的答案，而且它读起来是运行时事实而非分类。

**把分类/描述写到 bundle 补丁行。** 拒绝：展示元数据不属于部署组合，而且需要在已经承载 spine 的 `dsh-base` 与 `dsh-web-app` 两层里对约 168 行逐一编写。清单内一张只读映射把编写收敛到一处，并且对未知模块干净地退化。

**按裸 `dsh-managed-` 前缀折叠受管理行。** 在重复卡片报告后拒绝：Loader 获取器 id 带 `include:` 前缀到达，因此必须先剥离前缀再比较；修复是统一使用同一个 `bareEntryId` 助手来比较所有权标记。

## 测试

Plugin-manager REAL-composition 测试启动 loader 并驱动网关：随附卸载写入停用覆盖、HMR 监视器卸载 fiber、清单报告 `enabled: false`；安装抬起覆盖并重新挂载；guard 模块以 `in-use` 拒绝且 home 补丁保持不变。Plugin-inventory 测试钉住 `SPINE_META` 的 `category`/`description` 投影与未知模块两者皆无的退化。客户端组件测试覆盖统一卡片、分类分组与筛选菜单、`include:` 前缀折叠，以及 `in-use` → `errorInUse` 的本地化；browser-plugin 快照锁定渲染后的设置标签页。

## 后果

harness 中的每一个插件——包括约 168 个 spine 行——现在都能从同一表面安装与卸载，按分类分组并带详情视图。卸载 harness 插件是持久化停用：行保留在 home 补丁中、fiber 卸载、「安装」恢复它；操作完全可逆且幂等。五个运行时底座模块显示无法从该表面切换的“运行中”状态。`include:` 前缀折叠消除了受管理安装此前产生的重复卡片。只读的 `SPINE_META` 映射是 spine 展示元数据的唯一编写处；同样的 13 个标签同时服务于筛选菜单与市场分类法。
