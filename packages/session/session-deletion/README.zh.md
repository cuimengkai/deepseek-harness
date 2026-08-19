# @deepseek-ai/dsh-session-deletion

[English](README.md) | 中文

级联物理会话删除 + 持久化删除台账。`ctx.sessionDeletion.deleteSession(id)` 删除一个会话的持久化日志及其全部子代理后代树,树中任一成员活跃时整体拒绝,并在台账域中记录每次删除。

## 为什么需要删除

会话持久化是事件溯源 + append-only:持久化日志永不改写,所以会话无限累积、没有官方清理入口。删除是显式的、用户发起的例外,物理移除一个会话的日志。它删除**整棵子代理树**,因为子代理的可续跑性依赖其血缘,而删父留子会产生无法恢复的孤儿。由于子会话的续跑状态是自包含的(只折叠自己的后缀),整树删除保持了"模型可见 ⟺ 可重建"不变量——不会让任何到达模型请求的输入变得不可重建。

## 契约

- `deleteSession(id, options?)` 返回 `{ deleted, notFound }`——被物理移除的范围内成员(根在前)和没有持久化工件(不存在)的成员。
- **live 拒绝**:范围内任一成员活跃(`ctx.sessions.get(member)` 有值),整个操作抛 `SessionDeletionError`(`code: 'live'`),且不删除任何东西。live 会话在下一次 flush 时会重新物化日志,所以在其运行时删除会立即被撤销。
- **级联范围**:根 + 所有 `origin: 'subagent'` 且 `parentSession` 追溯链到达根的 header,广度优先前序(环安全,会清扫已孤儿的子节点)。从合并的 live + 持久化 header 语料一次计算。
- **台账**:至少删到一个成员时,向 `session_deletion` 域写入一条 `DeletionRecord`,按根 id 键控。台账是诊断性的——回答"这个 id 是否被删过、何时删的",而不是"每个会话发生了什么"。
- **消费者清理**:删除成功后,对每个被删成员可选调用 `sessionProjectionCache.evict(id)` 与 `workspaceRegistry.forgetSession(id)`,不残留陈旧的投影行或工作区 `sessionIds` 成员关系。未挂载的消费者跳过。

## 组成

生产者注入 `storageDomain`、`sessions`、`sessionPersistence`。挂载一个 storage-domain 后端(web-app bundle 的 json 后端把台账落在 `$DSH_HOME/storages/session_deletion.json`):

```yaml
- id: storage-domain
  name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json

- id: session-deletion
  name: '@deepseek-ai/dsh-session-deletion'
```

配合 [`@deepseek-ai/dsh-command-session-delete`](../command-session-delete/README.md) 提供 `/session-delete` 斜杠命令,或通过 host API proxy 暴露 `session.delete`。

## 错误模型

| 错误 | 条件 |
|---|---|
| `SessionDeletionError`(`code: 'live'`) | 范围内有成员活跃;整个操作被拒绝。 |

不存在不是错误:未知根 id 返回 `{ deleted: [], notFound: [id] }`,且不写台账记录。
