# @deepseek-ai/dsh-client-ui-project-insight

[English](README.md) | 中文

开发模式的洞察标签：六个 `conversation.view` 注册，渲染会话项目的已提交 `project-insight.json` 文档。每个标签展示六个已扫描区段之一——模块依赖拓扑、组件依赖、技术栈、组件、提示词与 agent 相关技术——按环形顺序排在 trajectory 标签之后。文档及其六个区段由 host 服务 [`@deepseek-ai/dsh-project-insight`](../../insight/project-insight/README.zh.md) 生成。

标签通过会话级 `modes` 过滤器限定在 `develop` agent preset：过滤器仅在会话已解析 preset 属于其 `modes` 时显示标签，因此将会话切换进开发模式会默认显示六个标签，切换出去则隐藏它们。未声明 `modes` 的条目（chat、trajectory）始终显示。

每个标签拥有一个会话级 `ProjectInsightController`，通过特权 `projectInsight.read` RPC（读取项目文件即侦察）按会话当前 `cwd` 读取会话文档。全新文档立即渲染；`none` 与 `stale` 意味着 host 可能仍在扫描，因此控制器每隔两秒重新读取，直到线上报告 `fresh`。代数计数器使最新的 `load`（或 `dispose`）取代所有更早的在途读取与已排程轮询，因此会话切换绝不会闪现上一会话的文档。

## 模型体验

不直接涉及：标签渲染已提交文档，绝不触及模型。`projectInsight.read` RPC 读取项目文件但不产生任何模型输入，此处也不拥有任何提示词段、persona 或工具。

#### KV Cache 影响

无——标签不添加任何提示词内容，读取结果也不是任何模型请求的一部分。

## 已知局限与延后工作

- **扁平列表而非图**——每个区段渲染为有序行；图可视化与 diff 视图延后给拥有更丰富渲染的工作台 surface。
- **新鲜度滞后于文件变化**——`stale` 文档每两秒重新读取，直到 host 报告 `fresh`，因此标签更新前必须完成扫描并经过轮询间隔。
- **无项目则无标签**——没有 `cwd` 的会话没有可扫描内容，标签渲染为空。
- **仅开发模式**——除非会话已解析 preset 为 `develop`，否则标签保持隐藏；其他 preset 不显示本包的洞察标签。
