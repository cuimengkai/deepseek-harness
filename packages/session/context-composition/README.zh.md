# @deepseek-ai/dsh-context-composition

[English](README.md) | 中文

一个会话当前模型可见上下文的宿主侧只读投影，以 `ctx.contextComposition` 提供。`read(session)` 把持久日志尾部折叠成一个独立快照：请求信封（系统提示词、工具目录）、按 token 计价的对话表面、最新记录的路由容量，以及压缩历史。浏览器上下文视图通过特权 `contextComposition.read` RPC 渲染该快照（信封行原样携带系统提示词——与 `session.history` 同类的侦察面）。

折叠是纯函数：`read()` 遍历会话事件数组的一个不可变快照，因此即使会话持续追加，结果也只描述一个日志修订。表面行重放运行时使用的同一表面折叠——append 入列、replace 遮蔽其闭区间——因此各行与下一次请求的构造内容一致。计价使用 token-meter 的共享估算器（`@deepseek-ai/dsh-token-meter/estimate`），因此数字不会与 meter 或 `contextBreakdown` 投影的口径相左：表面与目录总额是估算器自身的输出，按工具的行是对每个工具 JSON 的同密度提示性拆分。

## 服务：`ContextCompositionService`（ctx 键：`contextComposition`）

- `read(session)` 折叠会话当前日志尾部。信封取自最新的 `request/header` 事件（最新完整快照生效，模型或提示词切换会重述）；`contextWindow` 是最新的 `request/context` 广告值，无适配器报告时为 `null`；每个 `compaction/summary` 事件记录其写入路由与被替换区间的影子价格。尚无请求的会话读取为 `null` 信封与空表面。

无配置、无事件、无可变状态：该服务只拥有折叠本身，因此其 companion 不注册运行时不变量（计价正确性是由单元测试钉住的纯函数性质）。

## 读取结果

| 字段 | 含义 |
|---|---|
| `logRevision` | 本次快照消费的持久事件数（下一个未读事件 seq）。 |
| `envelope` | 最新请求头的提供方、模型、系统提示词文本及其 tokens、按工具各行、目录总额；无请求前为 `null`。 |
| `surface` | 每个存活表面节点一行，按位置顺序：seq、角色、估算器对精确派生消息的价格、首个文本块的首行。 |
| `surfaceTokens` | 表面各行价格之和。 |
| `contextWindow` | 最新广告的路由容量，或 `null`。 |
| `compactions` | 每个 `compaction/summary` 一条：写入模型/提供方、摘要文本、被遮蔽行数与影子价格。 |

见 [`./types` 子路径](src/types.ts)——一个纯的、无运行时导入的模块，wire schema 与浏览器标签页都重述它，因此词汇只有一处定义。

## 模型体验

无——该投影只读日志，不写入任何模型可见内容；不产生事件、表面操作或请求内容。

#### KV Cache 影响

无——折叠不改变任何模型请求，缓存键与内容均不受影响。

## 已知限制与后续工作

- **按工具 token 行是提示性的** — 目录总额是 meter 的精确 `estimateToolsTokens` 数字；按工具行用同一密度对该工具自身的 JSON 计价，因此各行之和不等于总额。各行用于排序工具；总额用于计价。
- **每次读取为 O(n)** — `read()` 遍历整条日志；上下文视图在活跃会话的表面修订时刷新，因此长会话每次刷新都付一次全量遍历。持久检查点式折叠（投影注册表的 O(1) 模式）推迟到真实会话的读取成本显现再做。
- **仅限活跃会话** — RPC 解析 `ctx.sessions`，已分离（关闭）的会话不可寻址；该标签页在设计上就是活跃会话视图。
