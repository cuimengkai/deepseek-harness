# 资产 schema 规范

[English](platform-asset-schema.md) | 中文

> [platform-architecture.md](platform-architecture.md)(D5、D7)的配套文档:schema 化资产是能力打包单元(插件 + 预设 + 资产 schema)的三分之一。本规范定义资产记录、其 kinds、id 方案与投影规则——以 `examples/platform-agent-demo/` 及其 `platformService` 为依托。

## 1. 资产记录

平台上的每个产出物都是一条 `PlatformAsset`:

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | `string` | 持久、唯一、带 kind 前缀(见 §3) |
| `kind` | `string` | 产物类别(见 §2) |
| `content` | `string` | 产物的 AI 可读投影 |
| `role` | `string` | 产出角色 |

该记录是血缘桥引用的单元(见配套规范的 §5)。它由平台自建的业务对象库存储,绝不放入 dsh session 日志内部。

## 2. 资产 kinds

MVP 纵切固定一个封闭集合,可经 merge-extensible 注册扩展:

| kind | 产出者 | content 是 |
|---|---|---|
| `requirement` | product | 需求文本 |
| `design` | ui | 设计决策与引用 |
| `code` | dev | 实现代码摘要与文件清单 |
| `test-case` | qa | 派生的测试用例 |
| `handoff` | 任意 | 跨角色交接说明 |

kinds 在工具边界校验:`register_asset` 对照已注册集合校验 kind,未知 kind 响亮拒绝。

## 3. id 方案

`<kind>-<sequence>`,sequence 按存储单调递增——原型中即 `requirement-1`、`code-2`、`test-case-3`。id 持久:产出资产的角色把 id 交给下一角色,后者用 `get_asset` 读回,血缘桥记录该引用。kind 前缀使 id 在工具调用历史与 session 日志中自描述。

## 4. 内容投影

`content` 是 AI 可读投影,不是产物的完整字节。设计文档、快照与大文件存在对象存储;资产携带指针加一段下一角色可据以行动的摘要投影。投影按角色裁剪:dev 读需求的意图,而非原始会议记录。原型展示了投影纪律——`content` 字符串是简明摘要(`Login page with SSO`、`Implemented login page (SSO) in src/`)。

## 5. Merge-extensible 注册

新 kinds 通过仓库对事件与 schema 图使用的同一 merge-extensible 机制注册:插件在一处声明 kind、其产出角色与投影规则,注册后校验门禁接受之。未知 kind 注册失败,因此产出者不能静默发明一个血缘桥不理解的 kind。

## 6. 验证

原型无密钥端到端使用了该记录:三个角色产出三种 kind,id 链为 `requirement-1 → code-2 → test-case-3`,demo JSON 中的 `lineage.chainComplete` 断言该链。本规范的增量是封闭 kind 集 + 响亮拒绝、对象存储指针规则、merge-extensible 注册——即 §9 中的 D5 后续。
