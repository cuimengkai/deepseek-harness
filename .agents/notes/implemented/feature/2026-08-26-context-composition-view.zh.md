# Agent Note：上下文组成视图（宿主折叠 + 浏览器标签页）

Status: implemented

[English](2026-08-26-context-composition-view.md) | 中文

## 问题

Web 应用对"模型现在的上下文里有什么"有三个不完整的答案：ContextMeter 弹层（token-meter 的 `contextBreakdown` 投影——三个数字）、轨迹台账（完整事件日志——不是请求表面）、压力投影（提供商报告的采样——滞后且粗）。没有一个展示推理压缩所需的形态：哪些消息在表面上、信封（系统提示词 + 工具目录）花多少、窗口多满、过去的压缩实际移除了什么。

缺的是一个"循环下一次会构造的请求"的投影，而不是又一个计量表。它必须读运行时使用的同一组折叠（表面、请求头、路由容量），并用同一估算器计价，否则它的数字会与既有数字互相矛盾，拖垮所有数字的公信力。

## 决策

### 只读宿主服务，而非投影单元

`@deepseek-ai/dsh-context-composition` 提供 `ctx.contextComposition`，仅一个方法：`read(session)` 把持久日志的不可变快照折叠成一个独立的 `ContextComposition`（信封、计价表面行、最新路由容量、压缩历史、`logRevision`）。

它刻意**不是**又一个 `SessionProjectionStateMap` 单元。投影注册表持有按推送帧推进的 O(1) 持久逐键状态——对三个计数器理想，对一个 194 行带预览、仅一个标签页按需读取的数组是错误工具。每次读取 O(n) 的折叠不持有任何状态；README 记录了推迟的检查点式折叠，等真实会话的读取成本显现再做。服务不注册事件、配置与可变状态，因此其不变量 companion 什么都不注册——计价正确性是由单元测试（`packages/session/context-composition/tests/context-composition.spec.ts`）钉住的纯函数性质：断言行等于估算器自身的输出，而非魔法数字。

### 一套词汇，一处定义

wire 类型放在一个零运行时导入的纯 `./types` 子路径。apiproxy 的 zod schema、浏览器 store、fixture 平行实现与测试都重述该模块，因此 `ContextSurfaceRow`/`ContextEnvelope`/`ContextCompactionEntry` 只有唯一定义。按工具的 token 行被文档化为**提示性**：目录总额是 `estimateToolsTokens` 的精确数字，而单行用同一密度对该工具自身的 JSON 计价——各行用于给工具排序，但加总不等于总额（投影自己的测试最初断言相等；估算器对 `JSON.stringify(header.tools)` 的框架处理使二者按构造就不同）。

### 计价纪律：meter 的口径，原样

标签页展示的每个数字都来自 `@deepseek-ai/dsh-token-meter/estimate`——表面行用 `estimateMessage`，信封用 `estimateSystemTokens`/`estimateToolsTokens`。表面行重放 `foldSurface`（append 入列、`replace` 遮蔽闭区间），因此标签页的行就是下一次请求派生的行。宿主测试钉住等式：`composition.surface[0].tokens === estimateMessage(first)`。fixture 连接（`packages/client/connection/src/client/fixture.ts`）为离线路路在客户端镜像同一组常数，与它已镜像 `contextBreakdown` 的方式一致。

### RPC 面与 fixture 通道

`contextComposition.read` 是 apiproxy 上的特权一元方法（`RpcMethodMap` 中路由键 `contextComposition.*`），在可选服务边界上解析 `ctx.get('contextComposition')`——未挂载该插件的组合以内部拒绝响亮失败，而不是让标签页静默空白。`FixtureApiClient` 增加了对自身已提交日志的平行折叠（`fixtureContextCompositionOf`），因此 fixture 驱动的应用与组装 jsdom 快照通道都能无密钥渲染该标签页；其 `dispatch` 按键路由方法，所以该通道端到端走真实 bundle 路径。

### 标签页：按表面修订读取，最新写入胜出

`@deepseek-ai/dsh-client-ui-context` 注册一个 `conversation.view` 条目（id `context`、order 15——在轨迹之后，不按 preset 门控：上下文是每个会话的属性，不是模式）。注册沿用 ui-trajectory 的形状：`slots.inject('conversation.view', …)` 在 inject 回调里返回每（标签页 × 会话）一个 `ContextCompositionController`，因此渲染器的 face 缓存保持闭包身份稳定，卸载时的 dispose 停止读取循环。

控制器原样采用 insight-store 模式：代数计数器、可重入的 `loading` 守卫、`dispose` 复位到初始（重挂载的读取不会被守卫挡住）、`ok:false` 与传输拒绝都呈现为错误。刷新以会话快照最后事件 seq 为键（partial 流式期间 `+1`）——返回原始值的选择器，因此只在真实移动时重渲染。已知限制写在 README：纯日志事件（请求头变化）在下一次表面移动前不刷新。

### Bundle 组合

`dsh-base` 在 `token-meter` 旁新增 `context-composition` 行（依赖已在 `packages/bundle/base/package.json` 声明）；`dsh-web-app` 在 `ui-trajectory` 旁新增 `ui-context` 浏览器行。两行都是宿主面新增——折叠读取 `ctx.sessions`，必须放在 apiproxy 可解析的位置；浏览器 roster 必须携带该标签页。`tsconfig.host.json`/`tsconfig.client.json` 引用两个新工程；`vitest.config.ts` 沿用其他 UI 包的覆盖率豁免。

## 备选方案

- **为该标签页做第三个投影单元** —— 注册表的推帧推进适合三个计数器，不适合一个按需读取、带预览的 194 行数组；每次读取的折叠不持有状态，也不需要不变量伴生。
- **在客户端对 wire 日志做折叠** —— 除非两侧复述同一计价，否则数字会偏离宿主估算器；读取宿主折叠并沿用估算器自身的词汇，使每个数字与 meter 已展示的数字相等。
- **按预设门控标签页** —— 上下文占用是每个会话的属性而非模式；注册保持不门控。

## 后果

- `dsh-base` 与 `dsh-web-app` 各携带一行宿主面新增（`context-composition`、`ui-context`）；无该插件的组合在 RPC 边界响亮失败，而不是渲染静默空标签页。
- 每工具 token 行按构造是参考值：目录总数是 `estimateToolsTokens` 的精确值，各行用于排序、不求和到它。
- 纯日志事件（请求头变化）在下一次表面移动前不刷新标签页；README 把它记录为刷新键的限度。
- `./types` 子路径的 `default` 必须指向 `lib/types/` 下的 tsc 产物——宿主面 tsdown 只在那里打包三个文件，指向不存在的 tsdown 输出的子路径只在运行时失败。

## 验证

- 宿主单元：纯折叠 11 例——空会话、最新请求头信封（数字等于估算器自身）、行计价、`replace` 遮蔽、容量广告、压缩条目、store 集成。
- 客户端 spec：控制器状态机 11 例（idle/loading/ready/empty/error、代数取代、dispose 后重启）。
- 无密钥快照：`apps/web/tests/context-tab.snapshot.ts`（构建 bundle + fixture wire 的组装 jsdom 通道）钉住容量图例、树、详情面板、页脚，以及表面选择的重渲染。golden 在详情面板之外按设计不随选择变化——第二段只重复 `detail=`/`footer=` 行。
- Web e2e golden：所有渲染会话标签环的 aria golden 各加一行 `- tab "Context"`（44 文件，共 +56 行；两处无关的预存漂移——flow 画布升级与开发模式菜单项——已还原到 HEAD，不并入本变更）。
- 两个聚合 typecheck 通过。

### 值得留存的构建面事实

host 面 tsdown 只打包 `lib/types/{index,invariant,startup}.js`；新增子路径 export 的 `default` 必须指向 `lib/types/` 下的 tsc 产物（如 `./client` 已做的），绝不能指向不存在的 tsdown 产物 `lib/<name>.js`。`./estimate` export 第一版指向 `lib/estimate.js`，所有拉起 dsh-web 的 e2e 在插件 import 处以 `ERR_MODULE_NOT_FOUND` 失败——loader 通过 `exports` 解析子路径，文件缺失只在运行时暴露，typecheck 抓不到。

## 已知缺口（推迟）

- fixture 常驻日志没有 `request/header` 事件，因此组装 golden 钉住的是 `envelope: null` 分支（图例 0 token）。信封有值的分支由宿主单元测试覆盖；带请求头的 fixture 轮次可在以后端到端钉住它。
- 第二阶段（标签页内范围选择压缩触发、`/compact` 范围参数）在此暂缓，并已作为 [manual range compaction note](2026-08-27-manual-range-compaction.zh.md) 交付。
