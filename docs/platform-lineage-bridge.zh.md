# 血缘桥数据模型

[English](platform-lineage-bridge.md) | 中文

> [platform-architecture.zh.md](platform-architecture.zh.md)(D7)的配套文档:血缘桥通过引用关系把业务对象表与 session 日志事件互联。本规范定义桥的数据模型——引用事件、血缘表与查询语义——以 `examples/platform-agent-demo/` 为依托。

## 1. 桥的两侧

- **业务对象侧**:平台自建库持有 `PlatformAsset` 记录(见 [platform-asset-schema.zh.md](platform-asset-schema.zh.md))。每条记录持久,有稳定 `id`。
- **session 日志侧**:dsh session 日志记录每一个 AI 可见的输入与输出。触及业务对象的 AI 行为写入一条**引用事件**,指名该对象的 `id`。

桥即连接:session 日志中的一行事件指向一个业务对象 id,血缘表记录该关系,使查询能从任一对象走到其祖先与后代。

## 2. 引用事件

当 agent 读取或产出业务对象时,session 日志携带一条引用:

| 字段 | 含义 |
|---|---|
| `type` | 事件类型,如 `asset/read`、`asset/register` |
| `assetId` | 被引用的 `PlatformAsset.id` |
| `kind` | 资产 kind(requirement、code、……) |
| `role` | 行动角色 |

引用是模型可见输入,因此必须**记入日志**:`模型可见 ⟺ 已记录` 不变量成立。原型中工具调用携带 id(`get_asset { id: 'code-2' }`);引用事件就是该调用的持久投影。

## 3. 血缘表

平台业务库维护一条 `lineage` 关系:

| 列 | 含义 |
|---|---|
| `asset_id` | 后代资产 |
| `parent_id` | 派生来源资产(可空) |
| `role` | 产出角色 |
| `created_at` | 记录该关系的时间 |

一个资产可有多个父(一份设计引用多条需求);该关系是多对多边表,而非资产上的单列。

## 4. 查询语义

- **Ancestors(id)**:沿 `parent_id` 向源传递地走——原型中即 `test-case-3 → code-2 → requirement-1`。
- **Descendants(id)**:反向走,从一条需求下探到最终验证它的测试用例。
- **跨角色追溯**:因为每条边都记录产出角色,一次行走得到角色序列——product → dev → qa——这正是平台核心卖点承诺的"谁为谁产出了什么"答案。

## 5. 构造性保证

桥是构造性的,而非尽力而为:session 日志中引用业务对象的任何模型可见输入都有其引用事件;任何引用事件都指名一个已存在的资产 id。原型的 `lineage.chainComplete` 恰好断言构造出的链 `requirement-1 → code-2 → test-case-3`。

## 6. 验证

原型无密钥演示了写路径:三个角色产出三个资产,引用链被记录并断言。本规范的增量是血缘表形态、多对多边语义、祖先/后代查询——即 §9 中的 D7 后续。
