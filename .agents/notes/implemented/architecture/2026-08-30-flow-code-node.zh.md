# Agent Note：流程 Code 节点绑定到 ctx.codeRuntime（绝不裸 eval）

Status: implemented

[English](2026-08-30-flow-code-node.md) | 中文

## 问题

流程画布（[packages/workflow/flow](../../../../packages/workflow/flow)）此前有七种节点类型（`start`/`end`/`agent`/`condition`/`loop`/`http`/`template`），却没有一种方式能对上游输出运行一小段程序而不启动 subagent 或插值字符串——而 Dify 的节点面板恰好为此提供了一个专属的 Code 节点。诱人的实现是在工作流脚本自己的 `node:vm` 域里 `eval`/`new Function`；那会让作者代码获得与编排脚本相同的权限，并跳过 `dsh-code-runtime` 已经拥有的每一项计算、输出与堆上限。

## 决定

1. **`FlowCodeNode`**（[types.ts](../../../../packages/workflow/flow/src/types.ts)）携带一个必填的 `source`（JS/TS 程序体）。`validateFlow` 拒绝空的 `source`；`compile.ts` 的 `codeBody` 生成 `OUT[id] = await code(<加引号的 source>, { phase: id, out: OUT })`，再访问其出边（有多条出边时同 agent 一样通过 `parallel()` 扇出）。源码用 `q()`（JSON 字符串）加引号，绝不用 `templateLiteral`：其中的 `${...}` 对沙箱保持字面程序语法。`expand.ts` 按照改写提示词、`http` `url` 与 template 的同一方式，改写子图 `source` 中的 `OUT[...]` 引用。
2. **主机/worker RPC，而不是 worker 内 eval** — `dsh-workflow-worker-thread` 新增 `code()` 钩子，向主机发送 `CodeExecute`；主机调用 `ctx.codeRuntime.run()`（`dsh-code-runtime-worker-thread`）并回复 `CodeExecuted` / `CodeExecuteError`。当钩子收到 `out` 时，会在 `source` 前拼接 `const OUT = <json>;`，让沙箱程序以 `OUT['<nodeId>']` 读取先前节点输出。程序失败仍是一次兑现的 `CodeRunResult`（value/error/logs）；只有不可用的 runtime 才是致命的 `CODE_EXECUTE` 工作流错误。该钩子与 `http()` 一样配对 `workflow/node-start`/`workflow/node-end`。
3. **`codeRuntime` 是引擎的硬依赖** — 拒绝在缺失 runtime 时跳过：引擎的 `static inject` 现在在 `web` 旁边包含 `codeRuntime`，加载引擎却没有 `CodeRuntime` 提供方的组合会在加载期响亮失败。`dsh-code-runtime-worker-thread` 挂在主机平面（`dsh-base`）上，因此 PTC 与工作流 Code 节点共享同一个沙箱提供方；Web 与 headless 覆盖层不再重复挂载它。
4. **画布接线** — `mode-graph.ts` 把 `code` 加入可放置类型，并走与 `http`/`template` 相同的无标签 `wireOutgoing` 路径；`ModeComposer.tsx` 在 Transform 面板分组下新增 Code 条目、节点卡片预览与源码检查器文本域（`setSelectedSource`）；`AgentModeSection.module.css` 用 `--dsw-static-deepseek-600` 为该节点着色，以便与 `http`（蓝）和 `template`（琥珀）区分。
5. **Preset 组合图拒绝 `code` 节点** — `graphToRows` 对 `code` 节点抛错，与它已对 `condition`/`loop`/`http`/`template` 所做的完全一致：preset 行是 agent 组合条目，而 code 节点不携带任何可投影到其上的 agent 语义。

## 考虑过的替代方案

- **在工作流 worker 的 vm 里裸 `eval` / `new Function`** — 已拒绝：那与编排脚本是同一信任域，没有计算/输出/堆上限，还会让 Code 节点与恶意脚本注入无法区分。路线图里的「绝不裸 eval」规则，正是这个节点必须做成宿主侧沙箱调用的原因。
- **把 e2b 或 shell/subprocess 当作第一个沙箱** — 考虑过并在 v1 拒绝：`ctx.codeRuntime` + `dsh-code-runtime-worker-thread` 是 PTC 已经在用的、生产就绪的 worker-thread 隔离，主机 RPC 模式与 `http()` 相同。e2b 仍是实验性的；shell/subprocess 会强制一种语言和进程启动策略，而本节点并不需要。
- **把 `source` 编译成与 agent 提示词一样的 JS 模板字符串** — 已拒绝：Code 节点的源码是程序文本。在编译期拼接 `${OUT['id']}` 会把作者写的模板语法变成工作流脚本插值，并把真实程序从沙箱里藏起来。先前输出改为以 JSON `OUT` 前奏传递。

## 后果

- `dsh-workflow-worker-thread` 现在要求同一组合内同时存在 `web` 与 `codeRuntime`；任何加载该引擎的宿主（直接加载，或经由 `dsh-tool-workflow`/`dsh-tool-ralph`）也必须加载 `dsh-code-runtime-worker-thread`，否则在加载期响亮失败。
- code 节点参与今天仅做互斥分析的汇聚规则，与 agent 或 http 节点完全一样：它可以通过 `parallel()` 扇出，但不能作为再汇聚点（并行扇出后的汇合仍暂缓，见[引擎后续工作](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.zh.md)）。
- 该沙箱是隔离而不是安全边界——与 `dsh-code-runtime-worker-thread` 已经为 PTC 记录的注意事项相同。Code 节点仍然优于在工作流 vm 里 `eval`，因为它能获得该 runtime 的上限和独立 worker。

## 测试

无密钥：`packages/workflow/flow/tests/{compile,validate,service}.spec.ts`（code 节点编译，含不透明加引号、扇出与子图 `source` 改写；空 `source` 校验；分支标签与扇出互斥；`node-start`/`node-end` 生命周期投影），`packages/workflow/workflow-worker-thread/tests/{session,workflow-worker-thread}.spec.ts`（`code()` 钩子经 stub 与真实 `ctx.codeRuntime.run` 往返、`OUT` 前奏拼接、被拒绝的运行以致命 `CODE_EXECUTE` 错误出现、以及取消与运行竞态的时序用例）。`packages/client/ui-agent-mode/tests/mode-graph.client.spec.ts` 覆盖 Code 节点的默认工厂、类型解析与出边接线。`ModeComposer.tsx` 中新增的 Code 面板条目、卡片与检查器字段尚无客户端渲染测试——与检查清单面板、HTTP 节点和 Template 节点是同一笔债务；`apps/web/tests/orchestration-studio.e2e.ts` 会行使编排器的一般界面，但不专门断言 Code 节点。
