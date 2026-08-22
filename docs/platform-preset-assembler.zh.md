# 预设装配器设计

[English](platform-preset-assembler.md) | 中文

> [platform-architecture.zh.md](platform-architecture.zh.md)(D5、D2、T7)的配套文档:装配器把"角色 + 一组已选能力"变成可运行的 agent 装配。这是 §9 列出的后续细化设计规格,以 `examples/platform-agent-demo/` 的无密钥原型为依托。渲染与「校验后提交」步骤(§3、§4)已在 `@deepseek-ai/dsh-experimental-platform-shell` 的 `preset-assembler` 模块中实现,并由 capability-market demo 的引导式构建无密钥证明。

## 1. 问题

预设是角色目录下的静态 `agent.cordis.yml` 树。能力市场(D5)承诺终端用户"按喜好组装能力":选角色、选能力、得到一个 agent。每个组合都手写预设无法扩展——市场必须从"角色模板 + 能力选择"**渲染**出 preset 配置,并在挂载前**校验**结果。

## 2. 输入与输出

| 输入 | 含义 | 来源 |
|---|---|---|
| 角色 | 角色的基础工具面与 persona | 角色预设目录 |
| 能力集 | 所选能力与选项 | 市场目录选择 |
| 上下文 | 工作区、会话默认值、配额 | 工作区记录 |

输出:一份**preset 配置树**(`cordis.yml` 行 + persona 文本),由 roster 挂载到新 agent 会话上。

## 3. 装配算法

1. **基底**:从角色预设复制该角色的行(identity、基础工具行)。
2. **追加**:把每个已选能力的行按目录顺序追加到基底之后。
3. **覆盖**:把能力选项与工作区上下文(cwd、配额)作为配置补丁应用。
4. **校验**:用 loader 使用的同一套检查运行配置——插件 id 可解析、注入的服务存在、按 id 无重复行、当前平台被禁用的行不会静默丢失兄弟行。
5. **提交**:把渲染出的树作为 `roster.mount` 的 preset 提交。

roster 在空白会话上的 `recompose` 就是同一算法的实时形态:原型中能力市场把 dev 预设装配到裸 assembler agent 上,持久的 `agent-preset/selected` 事件记录结果。

## 4. 依赖与冲突检查

- **id 唯一**:两个行向同一 agent 挂载同一插件 id 是冲突;市场在挂载前拒绝该组合。
- **服务注入**:某能力的行注入的角色未挂载的服务,除非该能力自己声明此服务,否则校验失败。
- **工具名遮蔽**:两个能力注册同一模型可见工具名是冲突;目录维护名称注册表。
- **禁用行**:在当前平台被禁用的行(如 macOS 上的 `tool-pwsh`)不是冲突,但装配器会报告,使用户看到工具面差异。

## 5. 渲染 vs 手写

渲染是确定性的:同样的角色、同样的能力集、同样的上下文——同一棵树。手写预设仍是合法输入;装配器将其归一化为同一渲染形态,使市场装配与手写装配的 agent 行为一致。原型的三个角色预设(`product`、`dev`、`qa`)是手写的;未来市场从角色模板 + 能力行渲染它们。

## 6. 验证

原型无密钥端到端证明了该机制:`roster.mount` 按 id 装配,`roster.recompose` 把空白 agent 换到另一预设,结果工具面恰好是预设的行(`roleIsolation`、`marketAssembly`,见 demo JSON)。实现补上了「校验后提交」这一步:`assemble_preset` 通过 `renderPresetTree` 渲染「基底 + 能力」树——确定性的,同样的请求渲染出深度相等的行——报告当前平台被禁用的行,并在任何树到达 roster 之前,以 `ROW_ID_CONFLICT` 拒绝重复的行 id、以 `TOOL_NAME_CONFLICT` 拒绝被遮蔽的工具名。capability-market demo 的引导式构建通过 `AgentPresets.write` 提交渲染出的行,挂载它们,并断言组合后的系统提示词按目录顺序携带基础 persona 与每个能力 persona,减去平台禁用行。
