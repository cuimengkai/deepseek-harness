# Agent Note: 合并 Web 设置中插件清单与目录为一个列表

Status: implemented

[English](2026-08-22-merge-plugin-inventory-sections.md) | 中文

## Problem

Web 设置的“插件”标签页在同一个 `settings.plugins.tab` 贡献（id 为 `all`）内堆叠了两个独立分区。“可安装插件”分区——标题、条目数、刷新按钮、按源状态行与可安装卡片网格——位于第二个“插件列表”分区上方，后者有自己的搜索框与标题，覆盖 Loader 清单卡片。重复的“插件列表”命名让页面看起来像把同样的东西列了两遍，且两个分区各自的搜索互不可见。

## Decision

`ui-settings-plugin-inventory` 把两个面渲染成一个列表。分区标题与按分区计数的条目数被移除；顶部是源状态条与一个包含搜索框和刷新按钮的工具栏。Loader 清单行保留折叠卡片行为；目录条目保留带来源徽标的安装/卸载操作。

受管理的安装被去重：条目 id 携带 `dsh-managed-` 所有权前缀的 Loader 行，合并进对应的目录卡片（该卡片显示已安装标签与卸载操作），而不是出现两次。比较前会剥离 Loader 条目 id 携带的 `include:` 获取器前缀，让折叠匹配 plugin-manager 补丁所使用的裸 `options.id`（[topic](../architecture/2026-08-22-live-home-patch-plugin-install.zh.md)）。

标签页标签改为“插件”/“Plugins”。被移除的本地化键（`catalog`、`installable`、`loadingInstallable`、`noInstallable`）已从两个字典中删除。

这次两面对一的合并是 [统一插件管理器](../feature/2026-08-23-unified-plugin-manager.zh.md) 的前半部分：后续决定把同样的行按分类分组、加入分类筛选、统一所有插件（含 harness spine）的安装/卸载操作，并超驰本笔记中的表面细节。

## Alternatives considered

- 保留两个分区，仅去掉重复的标题。已拒绝：用户可见的问题在于堆叠的分区本身，而非标题措辞；两个各自带搜索的网格仍然比一个列表更难扫读。
- 把目录行放在清单上方。已拒绝：已挂载的 Host 插件是标签页的主要对象，因此已安装在前能把运行状态保持在顶部。后续的统一插件管理器决定用分类分组取代了固定排序。
- 为合并后的列表添加 aria-label。已拒绝：单个列表无需额外标签；测试通过既有的 `data-plugin-entry`/`data-catalog-entry` 属性定位行。

## Consequences

- “插件”标签页成为一个列表：源状态、搜索+刷新工具栏，然后是 Loader 行与可安装行。后续的统一插件管理器决定把这些行按分类分组，并带筛选菜单与详情面板。
- 目录读取失败显示内联提示，Loader 行仍然可用；整页失败与重试只保留给 Loader 读取失败。
- 空结果与无匹配状态以两个面都就绪为前提。
- 测试：merged-plugin-list 分组覆盖排序、`dsh-managed-` 折叠、跨种类的单查询过滤与内联目录失败；针对已移除标题与计数的断言被替换。
