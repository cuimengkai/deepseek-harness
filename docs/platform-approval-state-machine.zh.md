# 审批流状态机

[English](platform-approval-state-machine.md) | 中文

> [platform-architecture.zh.md](platform-architecture.zh.md)(D6)的配套文档:业务审批(平台自建状态机)与 AI 执行审批(`interaction` 缝)是两层,串接而成——业务审批授予授权范围,范围内的敏感 AI 操作再过执行审批。本规范为两层建模,以 `examples/platform-agent-demo/` 为依托。

## 1. 两层,一条链

| 层 | 拥有 | 机制 | demo 表面 |
|---|---|---|---|
| 业务审批 | 项目门禁:立项、需求评审、上线放行 | 平台自建状态机 | 超出 demo 范围 |
| AI 执行审批 | 运行中 agent 想执行的敏感操作 | `dsh-user-approval` 缝 | `approval/asked` → `approval/decided` |

链是:业务审批放行 → agent 持有授权范围 → 范围内的一步敏感操作仍要过执行审批。

## 2. 业务审批状态机

业务工件(需求、发布)在平台控制面自有的状态间转移:

```
draft → review → approved → released
          ↓
        rejected → draft
```

转移是平台自有的记录,不是 dsh 事件。业务审批授予一个**范围**:哪些角色、哪些能力、哪个工作区,有效期到何时。该范围作为执行上下文的一部分交给 agent。

## 3. AI 执行审批状态

`interaction` 缝的审批是短生命周期的、逐请求的决策:

```
requested → asked → decided (allowed-once | rejected | cancelled | unavailable)
```

answerer 是 `approval/request` 上的 waterfall 监听;没有 answerer 时请求 fail-closed 为 `unavailable`。`allowed-once` 恰好授予一次执行——原型中的重试写入就是实时示例。

## 4. 原型中的串接

dev agent 的越工作区写入即走查:

1. 写入被 fs 沙箱拒绝(`FS_SANDBOX_DENIED`)——provider 边界在审批介入之前就强制了工作区范围。
2. 模型携带 `sandbox_permissions: danger-full-access` 与 justification 重试——这是拒绝携带的升级广告。
3. 升级经 `ctx.approval`(`approval/request`)路由,脚本化 answerer 授予 `allowed-once`,写入执行。

真实平台上,步骤 1 的范围来自业务审批(§2);demo 硬编码 dev 角色的 `workspace-write` 范围,让原型单独证明执行审批层。

## 5. 持久审计

`approval/asked` 与 `approval/decided` 对是 session 事件,进入 session 日志,持久且可重放。原型对持久化 JSONL 断言 `approvalEnforcement.auditPairPersisted`。业务审批转移是平台自有的记录;当两层都指名同一业务对象时,由血缘桥对账两条审计轨迹。

## 6. 验证

原型无密钥证明执行审批层:拒绝 → 升级 → `allowed-once` → 执行,带持久审计对。本规范的增量是业务状态机、授予范围的转移、两层链——即 §9 中的 D6 后续。
