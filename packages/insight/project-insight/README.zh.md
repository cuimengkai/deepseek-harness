# @deepseek-ai/dsh-project-insight

[English](README.md) | 中文

开发模式项目洞察：一个 host 平面服务，将会话的工作区确定性地扫描为带版本的 `.dsh/project-insight.json` 文档，并通过 read/scan 服务面与面向模型的 `scan_project` 工具暴露该文档。扫描器离线且无密钥——无 LLM、无网络、无凭证——因此以开发模式会话打开项目会严格仔细地扫描它，而第二次打开直接读取已提交的文档，无需重新扫描。

文档有六个区段，每个区段对应工作台的一个洞察标签：模块依赖拓扑、组件依赖、技术栈、组件、提示词与 agent 相关技术。每个输出的集合都按稳定键排序，每个路径都是相对项目根路径，因此扫描两次相同的受限树会得到逐字节一致的文档；`scannedAt` 会被记录但不参与内容指纹。

## 自动扫描

服务监听 `session/created` 与 `session/event` 上的 `agent-preset/selected`，通过 `resolveSessionPreset` 解析每个会话的 agent preset（最新的选择生效），仅当解析出的 preset 属于 `config.autoScanPresets`（默认 `['develop']`）且会话携带工作目录时触发。扫描按项目根去抖（`config.scanDebounceMs`，默认 1500）且单飞；在其根正在扫描时到达的会话加入等待集合，而不是调度第二次扫描。文档以原子方式写入 `<root>/.dsh/project-insight.json`，且仅当写入提交后才会发出 `project-insight/updated`——该事件是文档可读的证明。全新文档（内容指纹相同）永不重写，也不产生事件。

## 服务面

`read(cwd)` 报告 `none` / `fresh` / `stale` / `error`，不触发扫描，通过重算内容指纹回答新鲜度。`scan(cwd, sessionId?, signal?)` 立即扫描、提交文档并报告 `scanned` / `unchanged` / `error`，返回与工具相同的紧凑摘要。从未扫描过的项目报告 `none`；超出上限、无法解析或版本错误的文档报告 `error`。

## 工具

`./tool` 入口将 `scan_project` 注册进 agent preset 的工具层。它要求 host 服务存在，缺失时在挂载点即大声失败；它读取会话的工作目录，不存在时以结构化的 `NO_CWD` / `NO_SESSION` 码失败；它返回紧凑的模型可见摘要——绝不返回完整文档。`presentationMeta` 投影出 `{ code, modules, components }`，使结果满足模型可见 ⟺ 已记录。

## 模型体验

间接地，通过其注册的 `scan_project` 工具：develop persona 指示模型在首次进入及文件显著变化后调用，返回的模块/组件摘要用于定位文件，完整文档绝不进入线上。

#### KV Cache 影响

`scan_project` 工具 schema（空参数）是稳定的请求前缀常量；摘要只追加一小段随工作区变化的尾部。自动扫描钩子不写入任何模型可见内容。

## 已知局限与延后工作

- **尽力而为的静态分析**——导入与组件通过源码扫描与启发式识别，而非构建或类型检查；漏掉的导入不会使扫描失败，框架识别可能把不寻常的组件误分类。
- **根发现向上行走**——`findProjectRoot` 解析到最近的携带标记的祖先，因此 monorepo 内的子应用在其自身没有标记时会扫描外层根。
- **别名解析仅限 tsconfig `paths`**——Vite 与 webpack 的 `resolve.alias` 配置延后；经由这些别名的导入解析为外部叶子。
- **文档写入项目自身**——`.dsh/project-insight.json` 位于被扫描项目自己的树中，harness 不会把它加入项目的 `.gitignore`，因此提交一切的项目会跟踪该缓存。
- **扫描受硬上限约束**——指纹行走止步于 `MAX_FINGERPRINT_FILES`，仅分析前 `MAX_SOURCE_FILES` 个源文件；上限与各区段的截断是文档 schema 上的常量。
