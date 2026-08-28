# Agent Note: 新增流程是一个纵向弹窗——预设网格在上，预填的配置在下

Status: implemented

[English](2026-08-28-models-add-dialog-embedded-form.md) | 中文

## 问题

新增一个提供方要在多个窗口间穿行：挑选弹窗点名提供方，随后配置在第二个编辑弹窗中打开，声明自定义路由则是网格格子背后的第三个弹窗。用户的要求——"点击新增之后，上面显示提供方，下面显示配置信息，当选中某个提供方的时候，需要将该提供方的一些默认内置信息自动填入配置中……还要有高级选项……每次新增默认选中自定义"——指向 cc-switch `AddProviderDialog` 的形态：一个弹窗，预设在上、配置在下，选中的提供方预填其内置身份，高级字段折叠收起，自定义表单作为默认选中。

## 决策

- **一个纵向弹窗，绝不打开第二个窗口。** 挑选弹窗加宽到最小 75vw 并封顶于视口高度；预设与配置表单同住**一个**滚动容器，随内容自动撑高，越过上限便整体滚动——预设流绝不单独滚动，也绝不打开第二个窗口。`DialogState` 的 `pick` 种类内联携带选中的目标，`declare` 种类删除：点击格子换一份嵌入表单，再点另一格只是再换一次。声明弹窗及其 `customTitle` locale 键随之消亡。
- **预设流式排布，表单顺势接续同一表面。** 预设格子以自然宽度从左往右、再从上往下流式排布（`flex-wrap`，取代被拉伸的 `repeat(auto-fill, minmax(150px, 1fr))` 网格——宽弹窗换来的是更多列，而不是每个格子被撑宽），嵌入表单脱去独立编辑器所穿的模块底色（`ProviderEditor`/`CustomProviderCard` 的 `embedded` prop），上方的流与下方的表单读作一个区域而非两张叠放的卡片。为此 Modal 原语新增 `bodyClassName` prop：挑选弹窗卡片封顶于 `calc(100vh - 48px)`，其 content 与 body 区域可收缩（`min-height: 0`），钉住的搜索框之下唯一的滚动容器承接溢出。
- **自定义表单是默认选中。** 弹窗一打开，自定义创建卡片就挂在流之下——没有选中目标即自定义表单——且自定义格子带与被选预设相同的选中样式与 `aria-pressed` 状态，因此选中预设后再点它即切回。手工声明路由不再需要单独入口。
- **选中预设即预填其内置身份。** `ProviderEditor` 接受 `prefill` 标志，把目录条目的 `displayName` 种进草稿，因此被选提供方的名称既落在表单里也落在最终的写入里。端点刻意**不**预填：休眠预设的 schema 与 profile 都不带端点，没有可种的值，字段的占位符仍显示提供方默认。
- **每个家族都把高级字段折进「高级选项」。** pi-ai 表单以显示名、端点、密钥平铺领排——OpenClaw 形态——折叠区承载凭据引用、自定义 User-Agent、手工声明路由的协议与模型列表。deepseek 表单以密钥领排，`baseURL` 与模型目录留在同一折叠区。`customized` locale 键更名为 `advanced`，并新增 `userAgent`。
- **凭据引用可编辑，留空即派生。** 折叠区的凭据字段直接写 `apiKeyEnv`，占位符为 `deriveKeyRef(route)`：具名引用是共享或预置凭据唯一需要的旋钮，空字段保持页面已拥有的 `<ROUTE>_API_KEY` 派生。创建卡片同规则——具名引用胜过派生引用。
- **User-Agent 标头是 profile `headers` 字典的一个键。** 编辑它只写 `headers['User-Agent']`——字典的其余条目原样随行——清空后字典空了就整体删除，profile 绝不存空对象。

## 备选方案

- **保留第二个配置弹窗**——否决：用户明确要求 cc-switch 的纵向单弹窗流程；第二个窗口让新增变成三步巡游（挑选 → 第二个窗口 → 配置），声明卡片又添了第四条路径。
- **连端点也预填**——否决：休眠预设任何地方都不带端点，种一个等于发明目录从未拥有过的值；占位符点名提供方默认才是诚实的填充。
- **固定的凭据引用、不做字段**——否决：派生引用覆盖常规情形，但指向共享或预置密钥的部署需要点名它——那正是折叠区暴露的唯一旋钮。
- **完整的配置 JSON 编辑、代理覆盖与兜底模型字段**——暂缓：精选集合的局限保持不变；集合之外的字段仍归 `settings.yaml` 所有，在这里为它们发明 schema 面会与各 namespace 自己的 schema 漂移。

## 后果

- 少一种弹窗种类、少一个 locale 标题；新增流程的状态只剩 `edit` 与 `pick`。
- 新增流程的写入现在携带预填的 `displayName`（profile 写入在 `apiKeyEnv` 旁多出一条 `displayName` op），因此一次创建不再可能落成"空 profile 加一个密钥"。
- 被选编辑器里用于切换目标的提供方 `<select>` 消失——切换目标就是点另一个格子，与第一次选中同一手势。
- 折叠区更名改变了测试点击的目标（`advanced` 而非 `customized`），字段顺序用例现在为两个家族钉住"平铺领排 + 折叠收尾"的布局，取代旧的 pi-ai 全平铺断言。

## 验证

- `components.client.spec.tsx`：新增用例钉住嵌入流程——弹窗打开即自定义表单、选中预设嵌入预填编辑器（占位符仍是提供方默认、密钥占位符为原生）、被选格子 `aria-pressed`、创建时在 `apiKeyEnv` 旁写 `displayName` op、提供方原生创建只写 `displayName` op、冲突重试用例让 `displayName` 随刷新后的 fixture 一起走，从而只重试凭据阶段。
- `provider-form.client.spec.tsx`：创建卡片用例经默认自定义表单进入（无声明步骤），字段顺序用例钉住每个家族的布局（身份/端点/密钥平铺；协议、凭据引用、User-Agent 与模型折叠），取消/重开用例断言自定义表单的路由字段而非弹窗标题。
- `styles.client.spec.tsx`：样式表契约用例钉住单容器姿态——预设流换行（`flex-wrap`，无网格轨道、无独立滚动）、表单区域不带 border/background/padding、挑选弹窗封顶于 `calc(100vh - 48px)`、唯一的滚动容器是仅有的 `overflow-y: auto`。`ui-primitives` 的 Modal 测试覆盖封顶弹窗借以收缩的新 `bodyClassName` 钩子。
- `ui-settings-models` 套件 235/235；包内 `tsc -b` 绿；`pnpm run lint` 绿；`lib/client.js`（全部 client 包，含 `ui-primitives`）与 web 前端 `dist` 已重建。

## 相关

- [Models 设置提供方列表](2026-08-27-models-settings-card-grid.zh.md)——本新增流程所处的页面形态；其挑选弹窗与编辑器折叠的事实已同步为本次变更后的状态。
- [Web 配置平面](2026-07-30-web-config-plane.zh.md)——嵌入表单仍然经由的数据契约与只写凭据接缝。
