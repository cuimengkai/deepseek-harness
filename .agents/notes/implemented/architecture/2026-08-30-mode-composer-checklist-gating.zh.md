# Agent Note: ModeComposer 的实时 Checklist 与 Publish 门控

Status: implemented

[English](2026-08-30-mode-composer-checklist-gating.md) | 中文

## 问题

[ModeComposer](../../../../packages/client/ui-agent-mode/src/client/ModeComposer.tsx) 此前只在 `saveFlow` 内部运行 `validateFlow`，破损的草稿图会在保存时以抛错的方式暴露结构性错误。Dify 的 Checklist 面板在编辑期间持续展示发现项，并在其清空之前阻止 Publish；本仓库的 `validateFlow`（[packages/workflow/flow/src/validate.ts](../../../../packages/workflow/flow/src/validate.ts)）已经计算出同样的发现项，但没有一个只读、不落盘的入口供客户端轮询。

## 决策

1. **`AgentModes.validate` 远程方法**（[packages/preset/agent-modes/src/index.ts](../../../../packages/preset/agent-modes/src/index.ts)）包装 `validateFlow`，对未保存的图返回 `{ errors: readonly string[] }`；它从不写入，因此校验失败的草稿也能随意检查而不阻塞编辑。
2. **`section-store` 对检查做防抖。** `ComposeDraft.checklist` 保存最新发现项（首次检查返回前为 `undefined`）。`patchGraph` 调用 `scheduleChecklist()`，它会清除并重设一个 400 毫秒的定时器后再调用 `refreshChecklist()`；`beginCompose` 在打开时立即触发一次检查，`closeCompose` 清除待处理的定时器。一个单调递增的 `checklistGeneration` 计数器会丢弃被更晚编辑取代的响应，因此针对旧图的慢速校验调用永远不会覆盖更新的发现项。
3. **ModeComposer 在 Publish 旁展示 Checklist 按钮与面板**，附带错误数徽标；面板列出每一条发现项，或在检查挂起时展示"未发现问题"状态。**只要 `checklist` 中有一条或更多条目，Publish 就被禁用**，并附带说明原因的 `title` 属性。

## 考虑过的替代方案

- **每次按键都无防抖地校验** — 否决：`validateFlow` 遍历整张图，且 section-store 已经把图变更串行化通过 `patchGraph`；连续拖拽或输入时逐键请求会淹没 Remote 通道。
- **纯客户端校验（`validateFlow` 直接在浏览器运行，不走 Remote 调用）** — `validateFlow` 是纯函数、无依赖，本可直接在浏览器打包中运行。仍选择经由 `AgentModes.validate` 走一次往返，与 `agentModes` 其余读写路径（list/read/saveFlow/tryRun）保持一致，让客户端只有一种远程接口形状可供测试模拟，也让流程图业务规则只归属于一处（`agent-modes`）；额外代价只是以 400 毫秒防抖的一次 Remote 往返，而不是逐键。

## 后果

- Checklist 只反映 `validateFlow` 已经计算的结构性发现项（悬空边、缺失 start/end、分支互斥性违规、空提示词）；没有新增校验规则。
- Publish 门控只在客户端强制；`saveFlow` 自身在 Host 上的 `validateFlow` 调用仍是防止跳过 UI 直接调用 Remote 的权威门控。
- `modelKinds` 请求路由与并行汇合仍延后（[引擎后续](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.zh.md)）；Checklist 按现状报告分支互斥性违规错误，直到 A3 改变"有效"的判定标准。

## 测试

无密钥：`packages/preset/agent-modes/tests/service.spec.ts`（针对合法图与破损图的新 `validate` 远程方法）、`packages/client/ui-agent-mode/tests/section-store.client.spec.ts`（打开时立即检查、防抖再检查、过期世代守卫、关闭时的定时器清理）。`ModeComposer.tsx` 自身的渲染路径——Checklist 按钮/面板与被禁用的 Publish 按钮——尚无直接单元测试；`apps/web/tests/orchestration-studio.e2e.ts` 覆盖了编辑器的 Settings / Last Run 外壳，但未专门断言 Checklist / Publish。
