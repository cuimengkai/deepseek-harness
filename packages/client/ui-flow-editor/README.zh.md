# @deepseek-ai/dsh-client-ui-flow-editor

[English](README.md) | 中文

共享流程画布组件库：基于 React Flow（[`@xyflow/react`](https://reactflow.dev)）的 [`FlowGraph`](../../workflow/flow/README.zh.md) 视口——平移、缩放、节点拖拽、连线、调色板拖放与删除键手势，并附带 minimap 与缩放控件。它是组件库而非交互插件——唯一消费者是 新建Agent 中的 agent-preset 编排器，它通过 [`FlowCanvasSurface`](src/client/FlowCanvas.tsx) 接口在基于图的编排行上驱动相同的手势。浏览器花名册挂载本包仅为向模块表提供这些模块字节（编排器 require `@deepseek-ai/dsh-client-ui-flow-editor/client`）；原先的会话「流程」视图条目已被移除，因此本包不再注册任何视图。

画布只拥有几何。调用方提供的 `renderNode` 渲染每个节点卡片，调用方拥有的调色板提供拖放负载（`dropMime`，默认 `application/x-flow-node`）。平移、缩放与节点拖拽来自 React Flow 本身——视口将缩放限制在 0.2×–2×，节点位置限制在画布原点，新图在首次布局时适配一次；节点拖拽实时跟随指针，仅在拖拽结束时才提交给 surface。Delete/Backspace 删除选中的节点或连线（对节点内的可编辑内容有防护），从一个节点的端口拖到另一节点可画出连线。当调用方接入节点选择器时，每个节点上的悬浮「+」为它打开后继选择器，每条边中点的悬浮「+」可在两端点之间插入节点；只读模式下两个按钮都隐藏，拖拽、连线与拖放也被禁用。

`src/client/index.ts` 导出的 `apply()` 不挂载任何东西——空的插件入口让被挂载的行能通过启动内核的激活审计，而它的唯一效果是提供 bundle。

## 模型体验

Indirectly, through the graphs the canvas authors and runs, which compile into the sub-agent prompts [`@deepseek-ai/dsh-flow`](../../workflow/flow/README.zh.md) assembles; the canvas itself contributes no prompt content.

#### KV Cache 影响

无；本包既不组装也不发送任何 provider 请求。

## 已知局限与延后工作

- **会话级流程运行面已移除**——会话对话中不再有可编排、持久化、运行或观察分支 agent 流程的「流程」标签。host 流程引擎（`@deepseek-ai/dsh-flow`，即 `flow` host 行）及其八个 `flow.*` RPC 仍然挂载，供自动化与未来的已保存子流程复用；交互式编排面改由 agent-preset 编排器拥有。
- **画布只做几何，不是完整编辑器**——它只负责渲染与路由手势；节点级能力（agent 提示词、模型路由、运行控制）属于消费者的 `renderNode` 与其检查器，不属于本包。
- **无自动布局**——调色板拖放将节点落在拖放位置，节点选择器将节点插入到锚点之后，但没有任何自动排列；手工摆放的布局保持原样。
- **无推送通道**——本包只渲染落定的几何；实时运行状态的绘制由消费者负责。
