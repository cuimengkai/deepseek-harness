# Agent Note: Preset composition as a chain-projected FlowGraph

Status: implemented

[English](2026-08-24-preset-composition-flow-graph.md) | 中文

## Problem

preset 的组装模型此前是一张有序的行列表，而流程引擎的 `FlowGraph` 是会话流画布的词汇。两者从未相遇：preset 无法作为图来编辑，图无法指认 preset 要挂载的插件，组装行与画布布局（节点 id、位置、边）也没有共同的创作路径。Phase B（「Agent 即 Flow」）要求 preset 组合器变成流画布，这就要求图成为组装的**创作源头**，同时行的顺序仍要承担挂载的次序语义。

## Decision

preset 组装是 `FlowGraph` 的**链式投影**：`start` → 每行一个 agent 节点 → `end`，按挂载顺序。行语义落在 `FlowAgentNode` 上一个新增的可选 `composition` 字段上——`{ module, id?, group?, config?, disabled?, inject? }`，恰好是 `ComposeRow` 的子集——因此 `graphToRows` 无损，`AgentPresets.compose` 的行校验原样接受其输出。`agentOptions` 仍属流程域的 LLM 绑定词汇；validate/compile/run 忽略 `composition`，会话流画布也从不设置它。

两层皮肤、一个创作原语。`agent.cordis.yml` 仍是发现标记与 MOUNT 源；`mount`、`read`、`readRows` 原样不动。其旁伴生一份 `agent.flow.json` 保存布局、位置与边。`composeGraph` 从图推导出行（`graphToRows`），并以一次原子提交写出两个文件；打开时，`readGraph` 只在 `graphToRows(stored)` 仍等于从组装文件解析出的行时才采用存储的图，否则从这些行重新投影一幅全新的链式图。这条过期规则正是双文件写一半的安全网：手改或旧版按行创作的写入获胜，没有图文件的旧 preset 在打开时重新生成。

存储属于 preset：`agent.flow.json` 位于 preset 目录之下，而非 `.dsh/flows`，因为 preset 的布局与它的组装同属按部署的作用域，而 `.dsh/flows` 是引擎的会话流存储。文档携带自己的 `formatVersion` 1 与 256 KiB 上限；不导入 flow 持久化。

传输层通过两个镜像 `read`/`compose` 的特权方法携带图：`agentPreset.readGraph` 与 `agentPreset.saveGraph`。载荷是结构——即图——绝不是组装文本或路径，与行属于同一信任级别。`saveGraph` 先跑 `graphToRows`，再走与 `compose` 相同的三重校验（行非空、每行一个模块、id 唯一；基于 inventory 的 `assertResolvable` 证明；user 创作的替换）。两个键都在 `dsh-client-connection` 中与其余五个组装方法一起被固定在环回地址。

## Alternatives considered

- **把行语义放到 `agentOptions` 上** —— 已否决：`agentOptions` 是流程域的 LLM 绑定词汇（provider/model/modelKinds）；拿它承载挂载行会把 preset 语义泄漏进引擎的编译路径。独立的 `composition` 字段让引擎保持无感，行投影保持无损。
- **每次打开都从行重新生成布局、不落盘文件** —— 已否决：画布必须跨编辑持久化节点 id、位置与边；落盘的布局文件正是图创作界面。
- **通过 flow 持久化把图存进 `.dsh/flows`** —— 已否决：那个存储是引擎的会话流存储，按 `<cwd>` 划分作用域、并持有引擎自己的格式版本；preset 的布局与它的组装一样按部署划分作用域，复用引擎存储会把两个域的格式与生命周期耦合在一起。
- **让存储的图成为权威、读取时从图重新生成行** —— 已否决：组装文件是挂载源、也是本包之外唯一的组装编辑器；若图成为权威，下一次保存图时会悄悄丢掉对 `agent.cordis.yml` 的手改。过期规则让组装保持权威、布局充当缓存。
- **给 `composeGraph` 单独一套校验而不是复用 `compose` 的** —— 已否决：投影出的行与 `compose` 校验的是同一个值，再来一套校验只会漂移；`composeTo` 是两个创作入口共享的同一套三重校验。

## Consequences

- `agentPreset.readGraph`/`saveGraph` 是面向画布的传输方法；`saveGraph` 复用 `compose` 的校验，因此无法投影出行的图在任何写入之前即被拒绝。
- 带 condition 或 loop 节点、带没有 `composition.module` 的 agent 节点、或带环的图，都会被「branching is a later phase」拒绝——在 B3 子编排切片之前，preset 域保持链式。
- `copyComposition` 是整目录复制，因此伴生图随副本逐字迁移，而 `preset.yml` 被重写；agent-presets README 的 Known Limitations 记录了这一分歧。
- 组装文件仍是挂载源与唯一的行真相。preset 图只用于创作、从不被编译或运行，因此 `model-visible ⟺ logged` 不受影响，本次改动不产生快照。
- B1b 的 preset 画布消费 `readGraph`/`saveGraph`，并复用 `ui-flow-editor` 的纯图工具函数；模块调色板取代 PipelineCanvas，后者退役。

## Testing

无密钥覆盖钉住域与传输层。`conversion.spec.ts` 证明往返无损（顺序、id、module、config、disabled、group、inject）、无 id 行、非链 DAG 的排序、condition/loop 与环的拒绝、以及 `graphRowsMatch` 的过期判定。`authoring.spec.ts` 覆盖双文件写入、`readGraph` 往返、过期布局重新生成、大小上限与覆写/占用拒绝。apiproxy 的传输套件覆盖完整 carrier 路径上的 `readGraph`/`saveGraph`。`web-agent-presets.e2e.ts` 里的实组合 e2e 证明：图组装的 preset 的 agent 经随附 bundle 挂载后带有预期工具。
