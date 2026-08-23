# Agent Note: develop-mode project insight

Status: implemented

[English](2026-08-23-develop-mode-project-insight.md) | 中文

## Problem

开发模式会话会打开真实项目（OA/ERP、Element Plus 应用）并需要快速规划：定位 bug 修复或功能改动触及的文件、了解组件图与依赖栈，并让工作台按模式有内容可渲染。没有扫描，agent 每次会话都要靠 shell 探测，工作台也无从展示。用在线模型扫描既慢、又贵、还不确定，且使第二次打开与第一次同样昂贵。组合 develop preset 也曾被一行 bug 阻塞：当可写的 `~/.dsh/.agent-presets/` 根目录从未被创建时，通过 web 组合器创建任意 preset 都会以 `ENOENT` 失败，因为 `writeComposition` 使用了非递归的 `mkdir`。

## Decision

`@deepseek-ai/dsh-project-insight` 是新的 `insight/` 组下的 RELEASE host 平面包：一个确定性离线扫描器、一个带会话生命周期自动扫描钩子的服务、以及面向模型的 `scan_project` 工具。扫描器是树字节的纯函数——无 LLM、无网络、无凭证——因此扫描两次相同的受限树会得到逐字节一致的文档，且 `scannedAt` 不参与内容指纹。`<root>/.dsh/project-insight.json` 文档携带六个区段（模块拓扑、组件依赖、技术栈、组件、提示词、agent 相关技术），每个集合都按稳定键排序、每个路径都相对项目根，并带有硬上限（`MAX_SOURCE_FILES`、`MAX_EDGES`、`MAX_DOC_BYTES`），同时约束线上数据与浏览器渲染。

自动扫描钩子在 host 平面监听 `session/created` 与 `agent-preset/selected`，通过 `resolveSessionPreset`（最新的选择生效）解析会话 preset，仅当 preset 属于 `autoScanPresets`（默认 `['develop']`）且会话携带 `cwd` 时触发。扫描按根去抖且单飞；扫描期间到达的会话加入等待集合。文档以原子方式写入，且 `project-insight/updated` 仅在写入提交后发出——该事件是文档可读的证明。全新文档永不重写、也不发事件，因此重新打开已扫描项目是空操作。模型通过 `scan_project` 只看到紧凑摘要（绝不看到完整文档），`presentationMeta { code, modules, components }` 使结果满足模型可见 ⟺ 已记录。

文档通过特权 `projectInsight.read` RPC（读取项目文件即侦察）到达浏览器，并在由 `@deepseek-ai/dsh-client-ui-project-insight` 拥有的六个 `conversation.view` 标签（order 20–70，排在 trajectory 之后）中渲染。会话视图环新增会话级 `modes` 过滤器：声明了 `modes` 的条目仅在会话已解析 preset 属于其中时显示，因此每个模式都拥有自己的洞察标签，切换 preset 即默认显示该模式的标签。已发布的 `develop` preset（`apps/cli/config/agent-presets/develop`）挂载 `scan_project`，其 persona 指示模型在首次进入工作区与显著变化后扫描。作者 bug 通过把 `mkdir` 改为递归修复，与 `replaceComposition` 一致。

## Alternatives considered

**在会话打开时用在线模型扫描。** 拒绝：慢、贵且不确定，且使扫描在离线时不可用；开发模式要求严格仔细的无密钥扫描，因此分析是静态离线的，LLM 增强延后。

**对每个模式都自动扫描。** 拒绝：用户要求仅开发模式触发；其他模式不需要模块地图，且扫描会写入每个打开的项目。

**经 RPC 由客户端触发扫描。** 拒绝：触发必须在开发模式会话打开工作区时自动发生，只有 host 会话生命周期能观察到；RPC 保持只读，扫描由服务拥有。

**把文档放在内存或 host 状态中。** 拒绝：用户要求把结果存在被扫描项目自己的 `.dsh/` 下，使第二次打开无需重新扫描即可立即加载；按项目存放的文件也是 agent 的模型可见工件。

**完整、无上限的源码地图。** 拒绝：文档是浏览器线上数据的边界；硬上限在保持确定性的同时约束线上数据、渲染与指纹行走。

**把六个标签硬编码进 trajectory 插件。** 拒绝：用户要求每个模式拥有自己的洞察标签并在切换时默认显示，这应当是会话视图环上的通用会话级 `modes` 过滤器，而不是 trajectory 的特例。

## Consequences

开发模式会话对项目自动扫描一次；其他 preset 保持惰性，因为服务以已解析 preset 与 `cwd` 为门槛。切换进 develop 会重新触发对空白会话工作区的扫描。第二次打开已扫描项目会立即读取已提交文档；编辑使其 `stale`，下一次扫描刷新它。文档位于项目自己的树中，harness 不会将其加入 `.gitignore`——提交一切的项目会跟踪该缓存（记录在包 README 的已知局限中）。大树的首次扫描受上限约束且尽力而为（源码扫描与启发式，而非构建或类型检查）。`modes` 过滤器使标签环通用地感知模式：未来模式声明自己的标签，切换 preset 即可重渲染环，无需改动 trajectory 插件。
