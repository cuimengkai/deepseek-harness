# Agent Note: Models 设置页改为 cc-switch 形态的提供方列表——一键切默认、悬停浮现管理、弹窗编辑

Status: implemented

[English](2026-08-27-models-settings-card-grid.md) | 中文

## 问题

Models 页此前把提供方渲染成一列可展开的行：编辑就地展开（把下方的行挤下去），「新增」是底部一张行状卡片，而未来 Agent 的默认模型只能在输入框的按会话选择器里设置——这个专门呈现提供方的设置页却指名不了默认值。用户的要求——"参照cc-switch的供应商设置和模型设置，重构目前设置页面中的模型设置页面"——指向 cc-switch 的形态。中间一次尝试靠猜（卡片*网格*加单选默认弹窗）；阅读 cc-switch 源码（`src/components/providers/ProviderCard.tsx`、`ProviderActions.tsx`、`ProviderList.tsx`、`AddProviderDialog.tsx`）纠正了图景：**全宽横向卡片的纵向列表**、每张卡片上**醒目的一键启用/切换主按钮**（当前者呈禁用「使用中」态；提供方+模型选择有多个模型时为下拉——其 OpenClaw 变体），以及**悬停浮现的编辑/删除/测试图标操作**。

## 决策

页面保留原有联接（store 仍汇聚 `llm.providers`、settings 镜像与 `credentials.describe`），新增两个事实：`agent-default-model` namespace 视图（经共享镜像读取）与 `llm.models` 目录（同一轮加载中拉取，失败只降级不报错）。呈现遵循 cc-switch 源码，映射到本 harness 的接缝上：

- **全宽卡片的纵向列表，而非网格。** `space-y` 式堆叠；每行是头像、身份块（名称行 + 单行摘要），操作钉在右缘、每张卡同一位置——被比较的列表先读作选择。
- **默认切换是行的主命令——一键。** 当前默认带禁用的「使用中」命令（对勾图标、模型为 title）与品牌色描边。其余每个可用提供方以「设为默认」作为卡片按钮：目录只有一个模型时点击即提交；多个模型时在按钮上锚定打开 primitives 的 `Menu`（cc-switch 的 OpenClaw 形态——Zap 按钮后的多模型 `DropdownMenu`）；一个都没有则命令保持禁用、以 `defaultNoModels` 为 title，因为自由输入的 ID 是宿主注定拒绝解析的写入。该写入记录提供方与模型并 unset `reasoningEffort`（按模型的能力），携带 namespace 的 `revision`；结果落在页面状态区——成功为已存模型通知，失败为携带 wire 消息的 `role="alert"`，因为一键命令没有可内嵌失败的弹窗。
- **管理动作以常显图标操作骑在卡片上。** cc-switch 在每张卡片上都渲染操作行（编辑/复制/检测/删除）——其源码里的 `group-hover` 只放大头像——因此卡片在命令旁常显「详情、编辑、复制、删除」，不做悬停门控。「详情」就地展开卡片：接口地址、线上协议、凭据引用或其缺失、以及芯片化的在服务模型——全部是联接已持有的只读事实。「复制」把 `providers` 字典路由的 profile 经一次 `settings.mutate` 复制到新的同级键（`<id>-copy`、`-copy-2`……）；副本共享源的凭据引用，因为已存密钥只写——整分节路由与非 `providers` 字典布局没有同级键可接收副本，不提供复制。休眠目录提供方渲染为虚线卡片，其主命令「启用」打开预填的编辑器——cc-switch 累加模式的 Add 映射到采纳流程。
- **同一时刻一个弹窗。** 编辑、新增、声明共享一个 `dialog` 状态槽；打开一个即替换另一个。首启设置卡片仍内联在列表中（它的关闭不能依赖弹窗是否开着），且关闭它绝不影响弹窗里的草稿——旧共享关闭处理器曾出过的回归仍由测试覆盖。
- **新增分两步：先挑选，再编辑。** 列表添加磁贴先打开休眠目录挑选弹窗（含声明自定义入口）；休眠提供方自己的虚线行跳过挑选。选定后的编辑器保留提供方 `<select>` 用于切换目标，与旧新增卡片一致。
- **头像替代 cc-switch 的 logo。** cc-switch 为每个预设提供方发行图标；本仓库的路由集合是开放的（目录条目与手工声明路由并存），因此不发行 logo 资产——字母头像（圆角方块上的显示名首字符，底色由路由 id 哈希到主题色板）正是 cc-switch 给无预设提供方的同一兜底形态，跨加载确定，且休眠行、挑选弹窗行与卡片三处同色。

双语 locale 键：`addProvider`、`inUse`/`inUseTitle`、`setDefault`/`setDefaultProvider`、`defaultSetting`（忙碌）、`defaultNoModels`（禁用 title）、`defaultFailed`（告警前缀）、`savedDefault`、`modelsCount`、`notConfigured`、`addTitle`/`addPickHint`。中间版本的单选弹窗键（`defaultTitle`/`defaultDescription`/`defaultCurrent`/`defaultConfirm`）随弹窗一并移除。

## 备选方案

- **卡片网格（中间尝试）**——对照源码否决：cc-switch 的 `ProviderList` 堆叠全宽卡片；网格破坏了让一眼比较成立的右缘命令对齐。
- **默认切换用弹窗（单选列表）**——否决：cc-switch 的签名是一键启用按钮；它验证过的提供方+模型场景（OpenClaw）用的是下拉，不是弹窗。
- **拖拽排序与搜索（cc-switch 功能）**——超范围：这里的提供方以 settings namespace 为键、没有可写的顺序字段，页面也只服务少数提供方；两者都没有持久落点。
- **连通检测、用量统计、打开终端（cc-switch 卡片操作）**——没有接缝：已存密钥只写，任何客户端命令都无法对已存端点发起通过认证的探测（`llm.discoverModels` 对已描述路由从适配器注册表作答、不走网络）；没有 wire 领域上报提供方用量；终端归 harness 宿主所有。记入 README 已知限制，而不是发布注定失败的操作。
- **从 `llm.providers`（wire 字段）读取默认值**——否决：默认值已经是 `agent-default-model` 里的持久设置状态；并行的 wire 字段只会造出页面必须调和的第二个事实源。

## 后果

- 编辑提供方不再重排列表；长编辑器在自己的弹窗里滚动，而不是撑长页面。
- 页面加载多拉一个领域（`llm.models`）；目录失败只降级摘要与切换命令，绝不动摇行——与凭据补充信息的折叠方式相同。
- 按文本寻址旧行列表的 DOM 查询必须改为寻址卡片；测试按可访问名查询（每个提供方的编辑/删除/添加/设默认各带 `aria-label`），而非拼接的行文本。
- `CustomProviderCard` 不再渲染自己的标题（弹窗提供）；作为裸组件它无标题，标题由挂载处给。

## 验证

- `components.client.spec.tsx`：既有用例迁到弹窗流程（新增 = 磁贴 → 挑选 → 编辑器；编辑 = 弹窗开关；设置卡片回归保留独立用例），外加默认切换对——带「使用中」命令的目录缺失拒绝路径（禁用、带 title），以及一键菜单流写入 `agent-default-model` ops（含 `expectedRevision`）并在重载后移动「使用中」命令——以及操作集：两种路由形态的详情展开、复制写入（`providers.<id>-copy`、共享凭据引用、不可字典寻址的路由无操作）、休眠「启用」命令、`profileFactsOf`/`duplicablePathOf` 纯函数用例。
- `provider-form.client.spec.tsx`：声明卡片与模型拉取用例经挑选步骤进入各自弹窗；编辑器本身也是弹窗后，拉取选择器改按弹窗标题匹配；行开启器按 `aria-label` 匹配图标按钮。
- `styles.client.spec.ts`：卡片/编辑器分离用例改钉 `.card`，新增 `.cardDefault` 描边变色用例与 `.iconActions` 常显用例（钉住不做悬停门控的决策）；`readiness.client.spec.ts` 的 state fixture 携带四个新字段。
- `ui-settings-models` 套件 233/233；仓库 `typecheck` 通过；README.md/README.zh.md 按列表、一键切换、常显操作集重写，无接缝的否决项记入已知限制。

## 相关

- [Web config plane](2026-07-30-web-config-plane.zh.md) —— 本页的数据契约与只写凭据接缝，本次重构全部保留。
- [Context tab layout redesign](2026-08-27-context-tab-layout-redesign.zh.md) —— 有界视图的呈现先例；本页仍是普通滚动的设置分节。
