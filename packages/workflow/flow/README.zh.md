# @deepseek-ai/dsh-flow

[English](README.md) | 中文

可视化流引擎（`ctx.flowEngine`）把一个节点/边流图编译成 `@deepseek-ai/dsh-workflow` 脚本并在循环外执行。画布负责编排流图——start、agent、condition、loop、end——引擎把它编译成模型手写的那种递归脚本形态，因此分支、并行与子编排无需手写工作流脚本。

## 流图词汇

`FlowGraph` 携带 `nodes` 与 `edges`。节点类型：`start`（有且仅有一个，带一条出边）、`end`（终止节点；任何无出边的节点同样终止流程）、`agent`（subagent 提示词，可带可选的按节点 `provider`/`model` 覆盖以及按类型 `modelKinds` 路由）、`condition`（两条出边，标记为 `true`/`false`，由 JS 布尔 `expression` 决定）、`loop`（两条出边，标记为 `body`/`after`，由 `iterable` 与绑定到每个条目的 `variable` 驱动）。其余边都不带标签。

agent 节点也可以内嵌一个 `subgraph`——自包含的 `FlowGraph`，该节点运行它来代替 subagent，因此子图自身的 agent 节点就是编排。它的提示词不被使用（内嵌节点可携带空提示词），其 `agentOptions` 作为子节点省略自身路由时的继承路由默认值。

agent 节点还可携带可选的 `composition` 字段——`{ module, id?, group?, config?, disabled?, inject? }`——当该图兼作 preset 组合图时，它为节点标注 preset 行的语义。引擎不读取它：校验、编译与运行都把该节点当作普通 agent，字段的含义由 preset 域（`@deepseek-ai/dsh-agent-presets`）负责。

## 编译

每个节点编译成 `NODES` 映射中的一个条目，脚本从 `visit("start")` 开始。带一条边的 agent 运行子调用、记录 `OUT[id]`、再访问该边；带多条边的 agent 通过引擎的 `parallel()` 钩子扇出；condition 调用 `phase(id)` 并返回两个分支的三元表达式；loop 调用 `phase(id)`、在 `for...of` 中运行主体、再访问 `after` 分支；end 或终止节点返回 `OUT`。

编译先展开流图：内嵌 agent 节点被拍平，其子图节点共享同一个 `NODES` 映射，节点 id 以 `${embedId}-sub-${subId}` 命名空间化（嵌套内嵌时递归），内嵌节点的函数体先运行子图的 start（`await visit("...-sub-start")`），再继续它自己的出边。子图自身的 `agent()` 调用就是编排；它的 `OUT` 引用——提示词、condition 表达式与 loop 迭代式中的——被改写到命名空间化 id，从而继续指向它自己的输出。终止型子图返回共享的 `OUT`，因此内嵌节点不记录自己的输出。

agent 提示词编译为 JS 模板字符串，因此提示词可以插值外层循环的 `${variable}` 与先前的输出 `${OUT['<nodeId>']}`；字面反引号转义为 `\``。condition 表达式与 loop 迭代式按原样注入并在工作流脚本域中求值，`OUT` 与 `args` 都在作用域内——与模型编写的工作流脚本采用相同的信任模型。编译是确定性的：未变化的流图重新编译出完全相同的脚本。

## 校验

`validateFlow` 强制执行结构规则（一个 start 节点、kebab-case id、无环边、分支标签、可达性、每条路径都通向终止节点），外加分支上下文分析。入边多于一条的节点是汇聚点，只有每对入边分支都互斥时汇聚点才有效：分支只在 condition 处互斥分叉（恰好一条分支执行），而并行扇出或 loop 的 body/after 分叉可能执行多条分支，因此在其后汇聚会被拒绝。内嵌 agent 节点的 `subgraph` 会被递归地作为独立流程校验——子图只有一个入口且其终止节点没有出边，因此并图无环且类型良好当且仅当每一层都如此。

## 运行

`run({ graph, input?, parent, signal? })` 校验、编译并通过 `workflowEngine.start` 启动脚本，返回一个 `FlowRunHandle`：其 `result` 兑现（绝不拒绝）为 `{ status, error?, agentsStarted }`，其 `cancel(reason?)` 取消运行。`parent` agent 把每个子调用归属于调用方 agent。`stop(runId)` 取消一个活动运行；`listRuns(flowId?)` 按最新优先列出运行；`getRun(runId)` 读取活动快照。

服务要求同一组合中存在 `workflowEngine` 服务，缺失时在加载期响亮失败。`Config` 约束运行面：`maxLiveRuns`（默认 20）限制并发运行数，`maxRunHistory`（默认 100）限制内存中保留的已结算运行数。

运行面从引擎的 `workflow/*` 事件推导，并以展开后的 id 集合作为种子：agent 节点依据 `agent-start`/`agent-end` 在 `pending → running → done/failed/cancelled` 间流转；condition/loop 门（没有子调用事件）由其 `phase()` 调用标记为 running，再由下一个节点事件或 `workflow/end` 结算。子节点状态以其命名空间化 id 为键；内嵌节点本身在子图运行期间保持 `pending`（把子图状态聚合到它上面暂缓）。服务本身不发出任何事件——画布轮询 `getRun`。

## 持久化

`save(root, graph)` 把 `<root>/.dsh/flows/<id>.flow.json` 原子写入（模式 0600，dirMode 0700）。kebab-case `id` 兼作文件名，是防路径穿越的守卫。已保存文档携带 `FLOW_FORMAT_VERSION = 1`；`get(root, flowId)` 拒绝任何其他版本、超限文档（1 MiB）或不再通过校验的文档。`list(root)` 与 `delete(root, flowId)` 补齐该存储。

## 模型体验

经由 `@deepseek-ai/dsh-workflow` 间接实现：引擎的 `agent()` 调用创建子 agent 请求，并产生后续 condition 表达式、loop 迭代式与提示词所插值的 `OUT` 值。流引擎本身由程序驱动（画布 RPC），v1 不暴露任何面向模型的工具。

#### KV Cache 影响

不会直接导致 KV Cache 失效；流运行产生的子 agent 调用的任何请求前缀变化由 `dsh-workflow` 提供方配置负责。

## 已知限制与暂缓事项

- **没有面向模型的工具**：v1 只暴露 `FlowEngine` 服务及其 RPC 链路；模型无法在会话中途编排或运行流。`tool-flow` 消费方暂缓。
- **仅限无环图**：校验拒绝环，因此循环无法携带状态重访节点；超出 `loop` 节点 for-of 主体的控制流暂缓。
- **不支持汇聚型并行**：并行扇出或 loop body/after 分叉之后的汇聚会被拒绝，因此画布无法建模并发工作的汇合。
- **子图引用按字面改写**：展开会把子图的 `OUT['<subId>']` 与 `OUT.<subId>` 引用改写到命名空间化 id，因为那种写法就是引用语法；从未打算作引用的字面量也会被改写。指向外层节点的引用（`OUT['<outerId>']`）与近似写法（`MYOUT.x`、`foo.OUT.x`）保持不变。
- **还没有画布内嵌子图**：引擎在进程内编译并运行 `FlowAgentNode.subgraph`，但流程画布与 `flow.*` 线协议不携带它——经 RPC 发送的流图会丢掉其子图（请求模式剥离该字段），因此远程 `flow.run` 会把内嵌节点当作普通 subagent。通过画布编排与运行子编排是后续工作。
- **内嵌节点不聚合运行状态**：运行面以每个子节点的命名空间化 id 为种子，但内嵌节点本身在子图运行期间保持 `pending`；把子图状态聚合到内嵌节点上暂缓。
- **内嵌节点不记录输出**：终止型子图返回共享的 `OUT`，因此以内嵌节点的 id 捕获它会造成自引用；请改用命名空间化 id（`OUT['e-sub-x']`）读取子节点的输出。
- **没有日志化或恢复**：继承自 `dsh-workflow`；进程重启后无法继续运行。
- **按类型模型路由仅声明、不路由**：`agentOptions.modelKinds` 把某一类型绑定到 provider/model 路由，编译器会把它转发进子 `AgentOptions`，但请求路由尚未消费类型；已绑定的类型会被携带并忽略，直到路由落地。
- **运行状态靠轮询，不靠推送**：服务不发出任何 `flow/*` 事件，因此画布轮询 `getRun`，v1 无需转发 RPC 事件。
