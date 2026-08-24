# Agent Note: 移除会话流程标签；画布改为组件提供者

Status: implemented

[English](2026-08-24-session-flow-tab-removed.md) | 中文

## 问题

会话对话带有一个「流程」标签（环形顺序 15 的 `conversation.view` 条目），可编排、持久化、运行并观察经 host 流程引擎的分支 agent 流程。这个位置是错误的：用户确认流程编排属于 新建Agent 的 agent-preset 编排器，那里用同一个 `FlowCanvas` 驱动基于图的编排行。该标签也未做门控——它对每个会话都注册，与 preset 无关，因此本无运行流程之意的会话也会显示画布标签。移除它后包的角色变得不清晰：画布现在是编排器消费的共享组件库，而不是会话界面。

## 决策

移除会话级流程界面，并把包改为组件提供者。

- `conversation.view` 注册（顺序 15）连同会话级 `FlowEditorController`、其 store、视图与 locale（`FlowEditorView.tsx`、`flow-store.ts`、`locales.ts`）一并删除。本包不再注册任何视图。
- `@deepseek-ai/dsh-client-ui-flow-editor` 成为组件库：`src/client/index.ts` 导出 `FlowCanvas` 与 `view.ts` 几何（`clientToGraph`、`panView`、`zoomAt`、`fitView`）。agent-preset 编排器以模块表行的方式 require `@deepseek-ai/dsh-client-ui-flow-editor/client`。
- Web 组合保留 `ui-flow-editor` 行并挂载为组件提供者：modules 节点半部扫描 loader 条目中声明 `dsh.client` 的包，把它们的 `lib/client.js` 提供给模块表——这正是编排器外部 require 所解析的字节。该行保留一个空的 `apply`，因为启动内核通过 `registry.plugin` 挂载每个花名册条目，而它对没有 `apply` 的模块会抛错（vendor/cordis/src/registry.ts）。
- host 流程引擎（`flow` host 行）及其八个 `flow.*` RPC 仍然挂载——这是主机平面能力，供自动化与未来的已保存子流程复用。被移除的只有会话级运行界面；README 在已知局限中记录了这一项。

## 备选方案

- **把标签限定到开发模式**——被否决：用户明确流程编排属于 新建Agent，因此无论预设门控如何，会话标签都是错的。
- **完全剥离插件契约、删除该行、把画布内联进编排器 bundle**——被否决：编排器的 `dsh.client.external` 从模块表 require `…/client`，因此该行必须保持挂载以提供这些字节；删除它会让编排器的 require 在启动时无法解析。改为内联则需要改动共享的 `tsdown.client.ts` 里的 `INLINE_SAFE`，这是一次仓库级客户端基础设施改动，界面移除并不值得。

## 后果

- 会话对话不再有「流程」标签；交互式流程编排只存在于 agent-preset 编排器。`flow-editor` 的 slot-catalog 占用条目已移除。
- 本包是带 `dsh.client` 块（声明 `platform: web`、无 inject 列表）的组件库；peer 依赖收窄为 `cordis`、`dsh-flow` 与 `dsh-invariants`。
- 画布只做几何：它渲染节点并路由手势；节点级能力（agent 提示词、模型路由、运行控制）属于消费者的 `renderNode` 与检查器。[画布交互能力](2026-08-24-flow-editor-canvas-affordances.zh.md)与[预设编排流程图](2026-08-24-preset-composition-flow-graph.zh.md)两项决策仍然有效。
- host `flow.*` RPC 面保留给自动化；未来的已保存子流程编辑器会为该引擎重新引入 UI 消费者，而无需恢复会话标签。
