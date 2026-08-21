# Platform Shell

[English](platform-shell.md) | 中文

平台壳控制面的持久记录：租户／RBAC、业务对象资产仓库、血缘、业务审批流与审计日志，全部落在一个 SQLite 数据库上。[产品架构](../platform-architecture.zh.md)锁定了决策（D1-D8）；[资产模型](../platform-asset-schema.zh.md)、[血缘桥](../platform-lineage-bridge.zh.md)与[审批状态机](../platform-approval-state-machine.zh.md)规格文档负责 schema；本页记录 [`packages/experimental/platform-shell/src/types.ts`](../../packages/experimental/platform-shell/src/types.ts) 中的字面持久形式。

## 身份与租户

`UserId`、`WorkspaceId`、`RoleId`、`AssetId`、`TicketId` 与 `AuditEventId` 都是[品牌 id](core.zh.md#branded-ids)。workspace 是隔离单元（D2）；用户全局注册，而角色与成员关系按 workspace 划分。

```ts type-equiv
/** Membership of one user in one workspace. */
interface Membership {
  readonly roleId: RoleId
  readonly permissions: readonly Permission[]
}
```

`Permission` 是封闭并集（`asset.read`、`asset.register`、`approval.review`、`approval.release`、`audit.read`）。默认角色预置 `product`、`dev`、`qa`、`platform-admin`；权限在服务边界强制，而不是 UI 层（D8）。

## 资产仓库

每个资产是一个持久的业务对象，带有种类、产出角色、内容与 workspace。种类及其产出角色遵循 asset-schema §2。

```ts type-equiv
/** One durable business-object asset (asset-schema §1). */
interface AssetRecord {
  readonly id: AssetId
  readonly kind: AssetKind
  readonly content: string
  readonly roleId: RoleId
  readonly workspaceId: WorkspaceId
  readonly createdAt: number
}
```

`AssetId` 按 `<kind>-<seq>` 分配（asset-schema §3）。一次变更要么提交到存储并在同一事务写一条审计行，要么抛错；存储绝不会半应用。

## 血缘

血缘边把一个资产链到它所派生的资产，形成 `requirement-1 → code-2 → test-case-3` 这样的链，模型可见的追踪工具读取它。

```ts type-equiv
/** One lineage edge: `assetId` derives from `parentId` (lineage-bridge §3). */
interface LineageEdge {
  readonly assetId: AssetId
  readonly parentId: AssetId
  readonly roleId: RoleId
  readonly createdAt: number
}
```

血缘桥（规格 §2）还在每次读取与注册时发出会话参考事件，使 session log 与存储保持互链（D7）。

## 业务审批

一张 ticket 携带一个主题资产穿越业务状态机 `draft → review → approved → released`（approval-state-machine §2）。`approved` 转移必须带 review scope；release 转移会清空它。

```ts type-equiv
/** The scope a business approval grants on transition (approval-state-machine §2). */
interface ReviewScope {
  readonly roles: readonly RoleId[]
  readonly workspace: WorkspaceId
  readonly expiresAt: number
}
```

```ts type-equiv
/** One durable business-approval ticket. */
interface ApprovalTicket {
  readonly id: TicketId
  readonly workspaceId: WorkspaceId
  readonly subjectKind: AssetKind
  readonly subjectId: AssetId
  readonly status: BusinessApprovalStatus
  readonly actorUserId: UserId
  readonly reviewScope: ReviewScope | null
  readonly createdAt: number
  readonly updatedAt: number
}
```

```ts type-equiv
/** One recorded approval transition. */
interface ApprovalTransition {
  readonly ticketId: TicketId
  readonly from: BusinessApprovalStatus | null
  readonly to: BusinessApprovalStatus
  readonly actorUserId: UserId
  readonly createdAt: number
}
```

创建 ticket 时第一条转移记录写 `from: null → draft`，因此转移历史总是包含链的起点。

## 审计

每次变更写一条持久审计行；被拒绝的读取不写任何行，因此日志只记录真正提交的内容。

```ts type-equiv
/** One durable audit event (the platform audit log). */
interface AuditEvent {
  readonly id: AuditEventId
  readonly actorUserId: UserId
  readonly workspaceId: WorkspaceId | null
  readonly action: string
  readonly targetKind: string | null
  readonly targetId: string | null
  readonly detail: string | null
  readonly createdAt: number
}
```

## 持久化与重放

存储是一个 SQLite 数据库（`SCHEMA_VERSION` 单调递增；文件带 `application_id 0x504c5348`）。参考事件（`asset/read`、`asset/register`、`platform/approval/transition`）只在存储调用成功后写入 session log；包的 invariant 伴生在重放时校验每个已提交的参考事件都对应存储。包的 [README](../../packages/experimental/platform-shell/README.zh.md) 负责服务与工具行为；[keyless demo](../../examples/platform-shell-demo/README.zh.md) 驱动整个控制面。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxplatformshell--platformshellservice"></a>

### `ctx.platformShell` — `PlatformShellService`

The platform control-plane service. Register via `ctx.plugin(PlatformShellService, config)`; the service is injected as `ctx.platformShell`.

```ts cordis-catalog
/**
 * Register one platform user.
 * @param name - the user's display name.
 * @returns the registered platform user identity.
 */
registerUser(name: string): UserId

/**
 * Create one workspace.
 * @param name - the workspace's display name.
 * @param options - optional creation options.
 * @param options.isolated - whether the workspace demands on-demand physical
 * isolation (schema v3); the default shares the physical store.
 * @returns the created workspace identity.
 */
createWorkspace(name: string, options: { readonly isolated?: boolean } = {}): WorkspaceId

/**
 * Set whether one workspace demands on-demand physical isolation.
 * Requires the `platform.isolation` permission.
 * @param actor - the platform user making the change.
 * @param workspaceId - the workspace to re-flag.
 * @param isolated - the new isolation state.
 */
setWorkspaceIsolation(actor: UserId, workspaceId: WorkspaceId, isolated: boolean): void

/**
 * Whether one workspace demands on-demand physical isolation.
 * @param workspaceId - the workspace to inspect.
 * @returns true when the workspace is isolated, false when shared.
 */
workspaceIsolation(workspaceId: WorkspaceId): boolean

/**
 * Register or merge one role with its permission set (idempotent).
 * @param roleId - the role identity to register or overwrite.
 * @param displayName - the role's display name.
 * @param permissions - the permission set the role holds within a workspace.
 */
registerRole(roleId: RoleId, displayName: string, permissions: readonly Permission[]): void

/**
 * Assign one role to a user within one workspace.
 * @param workspaceId - the workspace the membership belongs to.
 * @param userId - the user being assigned.
 * @param roleId - the role to assign.
 */
assignRole(workspaceId: WorkspaceId, userId: UserId, roleId: RoleId): void

/**
 * Resolve one user's membership in one workspace.
 * @param userId - the platform user.
 * @param workspaceId - the workspace to resolve against.
 * @returns the membership, or `undefined` when the user is not a member.
 */
membership(userId: UserId, workspaceId: WorkspaceId): Membership | undefined

/**
 * Whether one user may access one workspace.
 * @param userId - the platform user.
 * @param workspaceId - the workspace to test.
 * @returns whether the user holds any membership in the workspace.
 */
canAccessWorkspace(userId: UserId, workspaceId: WorkspaceId): boolean

/**
 * Remove one user.
 * @param userId - the platform user to remove.
 */
deleteUser(userId: UserId): void

/**
 * Register one asset under the caller's produce role, in one workspace.
 * @param actor - the platform user producing the asset.
 * @param request - workspace, kind, content, and the caller's producing role.
 * @returns the committed asset record.
 */
registerAsset(actor: UserId, request: RegisterAssetRequest): AssetRecord

/**
 * Read one asset, workspace-scoped to the caller.
 * @param actor - the platform user reading the asset.
 * @param assetId - the asset to read.
 * @returns the asset record, or `undefined` when absent.
 */
getAsset(actor: UserId, assetId: AssetId): AssetRecord | undefined

/**
 * List assets in one workspace visible to the caller.
 * @param actor - the platform user listing the workspace.
 * @param workspaceId - the workspace to list.
 * @returns the workspace's asset records.
 */
listAssets(actor: UserId, workspaceId: WorkspaceId): AssetRecord[]

/**
 * Record that one asset derives from another.
 * @param actor - the platform user linking the assets.
 * @param assetId - the derived asset.
 * @param parentId - the asset it derives from.
 */
linkAsset(actor: UserId, assetId: AssetId, parentId: AssetId): void

/**
 * All transitive ancestors toward the derivation source.
 * @param actor - the platform user tracing the lineage.
 * @param assetId - the asset to trace.
 * @returns ancestor edges in derivation order.
 */
ancestors(actor: UserId, assetId: AssetId): LineageEdge[]

/**
 * All transitive descendants.
 * @param actor - the platform user tracing the lineage.
 * @param assetId - the asset to trace.
 * @returns descendant edges in derivation order.
 */
descendants(actor: UserId, assetId: AssetId): LineageEdge[]

/**
 * One asset's direct derivation parents.
 * @param actor - the platform user tracing the lineage.
 * @param assetId - the asset to trace.
 * @returns direct parent edges.
 */
parents(actor: UserId, assetId: AssetId): LineageEdge[]

/**
 * One asset's direct derivation children.
 * @param actor - the platform user tracing the lineage.
 * @param assetId - the asset to trace.
 * @returns direct child edges.
 */
children(actor: UserId, assetId: AssetId): LineageEdge[]

/**
 * Submit one ticket for a subject asset, starting in `draft`.
 * @param actor - the platform user submitting the ticket.
 * @param workspaceId - the workspace the subject asset belongs to.
 * @param subjectAssetId - the asset the ticket reviews.
 * @returns the committed draft ticket.
 */
submitTicket(actor: UserId, workspaceId: WorkspaceId, subjectAssetId: AssetId): ApprovalTicket

/**
 * Move one ticket across an allowed edge.
 * @param actor - the platform user authorizing the transition.
 * @param ticketId - the ticket to move.
 * @param to - the target status.
 * @param scope - review scope the `approved` edge requires, else omitted.
 * @returns the committed ticket.
 */
transition(actor: UserId, ticketId: TicketId, to: BusinessApprovalStatus, scope?: ReviewScope): ApprovalTicket

/**
 * Read one ticket.
 * @param actor - the platform user reading the ticket.
 * @param ticketId - the ticket to read.
 * @returns the ticket, or `undefined` when absent.
 */
getTicket(actor: UserId, ticketId: TicketId): ApprovalTicket | undefined

/**
 * List tickets in one workspace.
 * @param actor - the platform user listing the workspace.
 * @param workspaceId - the workspace to list.
 * @returns the workspace's tickets.
 */
listTickets(actor: UserId, workspaceId: WorkspaceId): ApprovalTicket[]

/**
 * One ticket's recorded transition log.
 * @param actor - the platform user reading the log.
 * @param ticketId - the ticket to trace.
 * @returns the ticket's transition records.
 */
transitions(actor: UserId, ticketId: TicketId): ApprovalTransition[]

/**
 * Whether one asset exists in the control-plane store.
 * @param assetId - the asset to test.
 * @returns whether a stored asset carries the identity.
 */
assetExists(assetId: AssetId): boolean

/**
 * One ticket's committed status, or `undefined` when absent.
 * @param ticketId - the ticket to inspect.
 * @returns the committed status, or `undefined` for an unknown ticket.
 */
ticketStatus(ticketId: TicketId): BusinessApprovalStatus | undefined

/**
 * Publish one capability to the market catalog.
 * @param actor - the operator publishing the capability.
 * @param request - catalog entry fields, dependency and conflict edges, and the execution gate.
 * @returns the committed catalog entry.
 */
publishCapability(actor: UserId, request: PublishCapabilityRequest): CapabilityRecord

/**
 * Remove one capability from the market catalog.
 * @param actor - the operator unpublishing the capability.
 * @param capabilityId - the catalog entry to remove.
 */
unpublishCapability(actor: UserId, capabilityId: CapabilityId): void

/**
 * List every catalog entry in identity order.
 * @param actor - the platform user listing the catalog.
 * @returns the catalog entries.
 */
listCapabilities(actor: UserId): CapabilityRecord[]

/**
 * Read one catalog entry.
 * @param actor - the platform user reading the catalog.
 * @param capabilityId - the catalog entry to read.
 * @returns the entry, or `undefined` when absent.
 */
getCapability(actor: UserId, capabilityId: CapabilityId): CapabilityRecord | undefined

/**
 * Set one catalog entry's execution gate.
 * @param actor - the operator setting the gate.
 * @param capabilityId - the catalog entry to gate.
 * @param gate - enabled flag and 0..1 rollout fraction.
 * @returns the committed entry.
 */
setCapabilityGate(actor: UserId, capabilityId: CapabilityId, gate: CapabilityGate): CapabilityRecord

/**
 * The fresh catalog record whose gate governs one tool's execution, or
 * `undefined` when no capability owns the tool. The execution-gate read: it
 * must never cache, because the operator may flip the gate between calls.
 * @param toolName - the tool name to resolve an owner for.
 * @returns the owning capability's fresh record, or undefined when unowned.
 */
runtimeCapabilityOwningTool(toolName: string): CapabilityRecord | undefined

/**
 * Register one scenario bundle (a pluggable C-side workbench surface).
 * @param actor - the operator publishing the scenario.
 * @param request - bundle fields and the workbench's capability set.
 * @returns the committed scenario bundle.
 */
publishScenario(actor: UserId, request: PublishScenarioRequest): ScenarioBundle

/**
 * Remove one scenario bundle (a pluggable C-side workbench surface).
 * @param actor - the operator unpublishing the scenario.
 * @param scenarioId - the scenario to remove.
 */
unpublishScenario(actor: UserId, scenarioId: ScenarioId): void

/**
 * List every scenario bundle in identity order.
 * @param actor - the platform user listing the workbenches.
 * @returns the scenario bundles.
 */
listScenarios(actor: UserId): ScenarioBundle[]

/**
 * Read one scenario bundle.
 * @param actor - the platform user reading the workbench.
 * @param scenarioId - the scenario to read.
 * @returns the bundle, or `undefined` when absent.
 */
getScenario(actor: UserId, scenarioId: ScenarioId): ScenarioBundle | undefined

/**
 * Resolve one capability selection within one scenario's workbench surface.
 * @param actor - the platform user assembling capabilities.
 * @param request - the workspace, scenario, and selected capability ids.
 * @returns the ordered resolved set plus the scenario's preset id.
 */
resolveCapabilities(actor: UserId, request: ResolveCapabilitiesRequest): ResolvedCapabilitySet

/**
 * Credit one workspace's billing account.
 * @param actor - the operator crediting the account.
 * @param workspaceId - the workspace account to credit.
 * @param amount - non-negative credits to add.
 * @returns the updated account.
 */
creditAccount(actor: UserId, workspaceId: WorkspaceId, amount: number): AccountRecord

/**
 * Read one workspace's billing account.
 * @param actor - the platform user reading the account.
 * @param workspaceId - the workspace account to read.
 * @returns the account, or `undefined` when no account has been opened.
 */
accountBalance(actor: UserId, workspaceId: WorkspaceId): AccountRecord | undefined

/**
 * List one workspace's usage records in billing order.
 * @param actor - the platform user reading the ledger.
 * @param workspaceId - the workspace whose usage to list.
 * @returns the usage records.
 */
listUsage(actor: UserId, workspaceId: WorkspaceId): UsageRecord[]

/**
 * Consume one capability against a workspace account, metering usage.
 * @param actor - the platform user consuming the capability.
 * @param request - the workspace, capability, and quantity.
 * @returns the committed usage record.
 */
consumeCapability(actor: UserId, request: ConsumeCapabilityRequest): UsageRecord

/**
 * Close one workspace's open settlement for a period as `settled`.
 * @param actor - the operator settling the account.
 * @param workspaceId - the workspace whose period to settle.
 * @param period - the `YYYY-MM` billing period to close.
 * @returns the committed settlement.
 */
settleAccount(actor: UserId, workspaceId: WorkspaceId, period: string): SettlementRecord

/**
 * Whether one capability exists in the market catalog.
 * @param capabilityId - the catalog entry to test.
 * @returns whether the catalog holds the entry.
 */
capabilityExists(capabilityId: CapabilityId): boolean

/**
 * Whether one scenario bundle exists.
 * @param scenarioId - the scenario to test.
 * @returns whether the market holds the bundle.
 */
scenarioExists(scenarioId: ScenarioId): boolean

/**
 * One settlement's committed status, or `undefined` when absent.
 * @param settlementId - the settlement to inspect.
 * @returns the committed status, or `undefined` for an unknown settlement.
 */
settlementStatus(settlementId: SettlementId): SettlementStatus | undefined

/**
 * List audit rows, filtered by workspace and action.
 * @param actor - the platform user reading the audit log.
 * @param filter - optional workspace and action filters; a workspace-less
 * actor resolves to its single membership.
 * @returns the matching audit events.
 */
listAudit(actor: UserId, filter: { readonly workspaceId?: WorkspaceId; readonly action?: string } = {}): AuditEvent[]
```

Types: [WorkspaceId](workspace.zh.md)

Source: [`packages/experimental/platform-shell/src/service.ts`](../../packages/experimental/platform-shell/src/service.ts)
<!-- END GENERATED cordis-surface -->
