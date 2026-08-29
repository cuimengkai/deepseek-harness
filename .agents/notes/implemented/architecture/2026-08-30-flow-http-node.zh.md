# Agent Note：流程 HTTP 请求节点与通用处理节点生命周期

Status: implemented

[English](2026-08-30-flow-http-node.md) | 中文

## 问题

流程画布（[packages/workflow/flow](../../../../packages/workflow/flow)）此前只有五种节点类型（`start`/`end`/`agent`/`condition`/`loop`），没有触达外部 HTTP 端点的方式——而 HTTP Request 节点是 Dify 节点面板中最常用的外部集成类型之一。运行面也只有一对子生命周期事件（`workflow/agent-start`/`workflow/agent-end`），因此非 agent 处理节点没有办法向画布报告 `running`/`done` 状态或耗时。

## 决定

1. **`FlowHttpNode`**（[types.ts](../../../../packages/workflow/flow/src/types.ts)）携带一个必填的 `url`（JS 模板字符串表达式，插值规则与 agent 提示词相同：`${variable}`、`${OUT['<nodeId>']}`），不带 method、header 或 body 字段。`validateFlow` 拒绝空的 `url`；`compile.ts` 生成 `await http('<url>', { phase: '<id>' })`，记录 `OUT[id]`，再访问其出边（有多条出边时同 agent 一样通过 `parallel()` 扇出）。`expand.ts` 按照改写提示词的同一方式，改写子图 `url` 中的 `OUT[...]` 引用。
2. **范围收窄到仅 GET、无自定义 header，直接复用 `ctx.web.fetch()`**——拒绝为流程发明一套专属的 URL 允许列表 `Config`：任何宿主发起的 fetch 本就已经由 `dsh-web` 自身的 SSRF、重定向与大小/时间策略作为部署侧可配置的把关，再造一套允许列表只会带来重复策略与各自漂移的风险。`dsh-workflow-worker-thread` 现在要求同一组合中存在 `web` 服务，缺失时在加载期直接响亮失败（已加到 `apps/cli` 的测试 profile，以及挂载该引擎的 `dsh-tool-workflow`、`dsh-tool-ralph` 测试 setup 中）。
3. **通用的 `workflow/node-start`/`workflow/node-end` 事件对**（[dsh-workflow types.ts](../../../../packages/workflow/workflow/src/types.ts)、[index.ts](../../../../packages/workflow/workflow/src/index.ts)）——拒绝为 `http` 单独造一对事件：同一套基础设施（一个按 `seq` 配对的 `WorkflowNodeInfo`/`WorkflowNodeEndInfo`，与 `agent-start`/`agent-end` 的配对方式一致）将承载未来所有非 agent 处理节点（Template、Code、Aggregator），而不必每种节点类型都新增一对事件。`dsh-workflow-worker-thread` 的 worker（`runtime.ts`）在其 `http()` 钩子调用前后发出这对事件；宿主侧（`host.ts`）转发它们；`dsh-flow` 的服务（`service.ts`）把它们投影到 `FlowRunSnapshot.nodeStatuses`/`nodeDurationsMs`/`nodeOutputs` 上，与 agent 节点完全一致。`dsh-workflow` 的不变式（`invariant.ts`）把配对校验扩展到节点生命周期，方式与 agent 生命周期一致，包括在宽限期强制结算、为孤立的 start 合成一个 `cancelled` 结束的路径。
4. **画布接线**——`mode-graph.ts` 把 `http` 加入可放置节点类型；`ModeComposer.tsx` 新增 HTTP 面板条目、节点卡片预览与 URL 检查器字段（`setSelectedUrl` 动作沿用既有的 `setSelectedExpression`/`setSelectedIterable` 模式）；`AgentModeSection.module.css` 新增该节点的图标/卡片/类型样式。

## 考虑过的替代方案

- **v1 就支持完整的 HTTP method/header/body**——出于范围考虑而拒绝：仅 GET 加 `ctx.web.fetch()` 已覆盖"调用一个 webhook / 读取一个 API"的常见场景；method/header/body 需要自己的、经校验的 `Config` 面（哪些 header/method 被允许），应作为后续工作单独交付，而不是临时拼装进来。
- **让流图节点直接发起 RPC（worker 直接进程内调用 `ctx.web`）**——拒绝：worker 线程无法直接访问宿主服务；`agent()` 已经使用的宿主/worker RPC 模式（一对带取消与回复竞态的类型化请求/回复，即 `protocol.ts` 中的 `HttpFetch`/`HttpFetched`/`HttpFetchError`）是任何脚本需要的宿主侧能力的既定、已充分测试的模式。

## 后果

- 需要 POST、自定义 header 或请求体的画布作者暂时无法表达；`http` 节点目前只能触达不带 header 的 `GET`。
- `dsh-workflow-worker-thread` 现在有一个硬性的 `web` 服务依赖，不再只是形似 `agent()` 的依赖；任何加载该引擎的组合（直接加载，或经由 `dsh-tool-workflow`/`dsh-tool-ralph`）都必须同时加载 `dsh-web` 与一个 fetch provider（`dsh-web-fetch-http`），否则加载期直接响亮失败。
- `workflow/node-start`/`workflow/node-end` 是除 `agent-start`/`agent-end` 之外，第一对要求 `WorkflowRun` 实现正确配对（或交由宽限期强制结算合成一个 cancelled 结束）的事件；未来若某个引擎跳过它们，只会让画布调用方看不到该节点的生命周期叙述，不会破坏其他行为，因为它们是附加性的、实践中可选的事件。
- 并行后汇合与变量检查器（按节点输入、编辑、单节点重跑）仍属后续工作（[engine followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.zh.md)）；`http` 节点在今天仅支持互斥合并的规则下，与 agent 节点完全一致地参与合并判定。

## 测试

无需密钥：`packages/workflow/flow/tests/{compile,validate,service}.spec.ts`（http 节点编译，包括扇出与子图 `url` 改写、空 `url` 校验、node-start/node-end 生命周期投影）、`packages/workflow/workflow/tests/invariant.spec.ts`（node-start/node-end 配对，包括格式错误/未配对的情形）、`packages/workflow/workflow-worker-thread/tests/session.spec.ts` 与 `tests/workflow-worker-thread.spec.ts`（`http()` 钩子经真实与经模拟的 `ctx.web.fetch` 往返、被拒绝的 fetch 表现为致命的 `HTTP_FETCH` 错误、以及取消与 fetch 竞态的各种时序情形）。`ModeComposer.tsx` 中新增的 HTTP 面板条目、卡片与检查器字段尚无客户端渲染测试——与其 Checklist 面板同样的技术债（[mode-composer-checklist-gating](2026-08-30-mode-composer-checklist-gating.zh.md)）；`apps/web/tests/orchestration-studio.e2e.ts` 覆盖编排器的通用外壳，但未专门断言 HTTP 节点。
