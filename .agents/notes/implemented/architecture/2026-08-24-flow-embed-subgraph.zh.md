# Agent Note: Embed sub-graphs for flow sub-orchestration

Status: implemented

[English](2026-08-24-flow-embed-subgraph.md) | 中文

## 问题

流程引擎已经支持分支（`condition`/`loop`）与扇出（出边 ≥2 的 agent 编译成 `parallel`），但 agent 节点只能运行单个 subagent。要组合出编排层级——一个 agent 的决策派发整个自包含的多 agent 流程——就必须手写工作流脚本，因为扁平图无法让某个节点拥有一个子流程。需求正是多 agent 编排与分支，本笔记是让一个图节点运行子图的引擎切片。

## 决策

agent 节点可携带 `subgraph`——自包含的 `FlowGraph`，该节点运行它来代替 subagent。子图自身的 `agent()` 调用就是编排，没有任何外层机制去调度它的节点。内嵌节点的 `agentOptions` 作为子节点省略自身路由时的继承路由默认值，其提示词不被使用，因此内嵌节点可携带空提示词（空提示词检查跳过它）。

编译先展开。`expandGraph(graph)` 返回一张扁平图加一份 owner 映射：子节点与子边 id 以 `${embedId}-sub-${subId}` 命名空间化（递归，嵌套内嵌产生 `embed-sub-embed-sub-…`），内嵌节点的编译函数体先运行子图的命名空间化 start（`await visit("…-sub-start")`），再继续自己的延续——一条出边则访问子调用、终止则返回 `OUT`、两条及以上出边经 `parallel` 扇出。脚本从根 start 开始，即 owner 是自己的那个节点。

子图内部的 `OUT` 引用——agent 提示词、condition 表达式与 loop 迭代式中的——由严格 token 替换从裸子节点 id 改写到命名空间化 id：只有当 `a` 是该子图内的节点 id、且 `OUT` 不是更长表达式的一部分时，`OUT['a']`/`OUT["a"]`/`OUT.a` 才被改写（`MYOUT.a`、`foo.OUT.a` 以及对外层或兄弟节点的引用保持不变）。在流程词汇里那种写法就是引用语法，因此从未打算作引用的字面量也会被改写——这是文档化的契约，不是 bug（记入 README 的已知限制）。

校验按层级递归，而不是对扁平图整体校验：每个 `subgraph` 作为独立流程校验（恰好一个 start、无环、分支标签、互斥），`checkIdentity` 为 false，因为子图的 `id`/`name` 是标签，不是持久化的文件名。经由内嵌节点的并图无环且类型良好当且仅当每一层都如此——子图只有一个入口且其终止节点没有出边，因此环、不可达节点、错误分支标签或再汇聚的合并只会出现在某一层，而校验扁平图会在它的多个 start 型节点上误触「恰好一个 start」规则。

运行面以展开后的 id 集合为种子，因此 `getRun` 以其命名空间化 id 上报每个子节点的状态，`WorkflowMeta.phases` 携带展开后的命名空间化标题，与子图的 `phase()` 调用按精确字符串匹配。内嵌节点本身在子图运行期间保持 `pending`。

## 测试

`compile.spec.ts` 钉住编译出的内嵌形态（命名空间化键、改写的引用、`visit(nsStart)`、确定性重编译）；`validate.spec.ts` 接受普通与分支子图，拒绝环子图、缺 true/false 边与不可达子节点；`service.spec.ts` 以展开 id 集合播种、把嵌套分支转发到两个终止节点、并从 `phase` 与 agent 事件推导命名空间化子节点状态。flow 全量测试套件绿色（compile 13、validate 24、service 17），`tsc` 干净。

## 备选方案

**对扁平图整体校验。** 扁平图携带全部子 start，都是 start 型，因此「恰好一个 start」规则会拒绝每一个内嵌图。按层级递归校验保留每一层自身的规则，而单入口/终止节点无出边的性质使并图的健全性由两层的健全性推出。

**捕获内嵌节点的输出并聚合其状态。** 终止型子图返回共享的 `OUT`；以内嵌节点的 id 记录它会自引用，因此该节点不记录输出，受支持的读取方式是按命名空间化 id 读子节点的输出（`OUT['e-sub-x']`）。把子图状态聚合到内嵌节点上随画布一起暂缓。

**把子图作为嵌套流程运行。** 每个内嵌节点一次独立引擎运行会带来两套运行面、两套 phase 词汇与两个取消域，还会在跨运行处重新打开合并互斥问题。内联进一张扁平图保持各一套，并平凡地保住无环保证。

## 影响

引擎切片现在已上线：`FlowAgentNode.subgraph` 在进程内完成编译、校验与运行，带展开后的运行面与改写的引用。子编排的编排 UX（在画布上内嵌子图）、子图的 `flow.run` wire（请求模式剥离 `subgraph`，因此远程 `flow.run` 会把内嵌节点当作普通 subagent）以及把运行状态聚合到内嵌节点上，都随画布一起暂缓。没有 `FLOW_FORMAT_VERSION` 变更——`subgraph` 是可选节点字段，携带它的持久化图在读取时照常通过校验。
