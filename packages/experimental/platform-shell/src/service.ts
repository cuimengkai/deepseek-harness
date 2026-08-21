/**
 * PlatformShell service: the in-process composition point that owns the
 * platform control-plane database, applies actor/workspace RBAC at every call,
 * and writes one audit row in the same mutation transaction as each mutation
 * (validated by validateSchemaForMutation before commit).
 * @module @deepseek-ai/dsh-experimental-platform-shell/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { DatabaseSync } from 'node:sqlite'
import {
  RoleId,
  UserId,
  WorkspaceId,
  type AccountRecord,
  type ApprovalTicket,
  type ApprovalTransition,
  type AssetId,
  type AssetRecord,
  type AuditEvent,
  type BusinessApprovalStatus,
  type CapabilityGate,
  type CapabilityId,
  type CapabilityRecord,
  type Config,
  type ConsumeCapabilityRequest,
  type LineageEdge,
  type Membership,
  type Permission,
  type PublishCapabilityRequest,
  type PublishScenarioRequest,
  type RegisterAssetRequest,
  type ResolveCapabilitiesRequest,
  type ResolvedCapabilitySet,
  type ReviewScope,
  type ScenarioBundle,
  type ScenarioId,
  type SettlementId,
  type SettlementRecord,
  type SettlementStatus,
  type TicketId,
  type UsageRecord,
} from './types.ts'
import { PlatformShellError } from './error.ts'
import {
  decodeAssetRow,
  openDatabase,
  validateSchemaForMutation,
} from './schema.ts'
import {
  createDatabaseFile,
  loadSqliteConstructor,
  prepareDatabasePath,
} from './database.ts'
import {
  assignRole,
  canAccessWorkspace,
  deleteUser,
  insertUser,
  insertWorkspace,
  membership,
  requirePermission,
  upsertRole,
} from './identity.ts'
import {
  getAsset,
  listAssets,
  registerAsset,
  validateKind,
} from './assets.ts'
import {
  ancestors as walkAncestors,
  children as directChildren,
  descendants as walkDescendants,
  linkAsset,
  parents as directParents,
} from './lineage.ts'
import {
  createTicket,
  getTicket,
  listTickets,
  nextTicketSequence,
  transitionTicket,
  transitions,
} from './approval.ts'
import { listAudit, writeAudit } from './audit.ts'
import {
  accrueSettlement,
  assertGateOpen,
  creditAccount,
  debitAccount,
  deleteCapability,
  deleteScenario,
  ensureAccount,
  ensureOpenSettlement,
  getAccount,
  getCapability,
  getScenario,
  getSettlement,
  insertCapability,
  insertCapabilityConflict,
  insertCapabilityDependency,
  insertScenario,
  insertScenarioCapability,
  insertUsage,
  listCapabilities,
  listScenarios,
  listUsage,
  loadCatalog,
  periodOf,
  requireCapability,
  requireScenario,
  resolveSelection,
  settleSettlement,
  setCapabilityGate,
  validateCapabilityRequest,
  validateScenarioRequest,
} from './capability-market.ts'
import { sql } from './sql.ts'

/** One seed entry in {@link DEFAULT_ROLES}. */
type DefaultRoleSeed = {
  readonly id: RoleId
  readonly displayName: string
  readonly permissions: readonly Permission[]
}

/** Default roles seeded into every fresh platform database. */
export const DEFAULT_ROLES: readonly DefaultRoleSeed[] = [
  { id: RoleId('product'), displayName: 'Product', permissions: ['asset.register', 'asset.read', 'approval.review', 'audit.read', 'capability.consume'] },
  { id: RoleId('dev'), displayName: 'Developer', permissions: ['asset.register', 'asset.read', 'capability.consume'] },
  { id: RoleId('qa'), displayName: 'QA', permissions: ['asset.register', 'asset.read', 'capability.consume'] },
  { id: RoleId('platform-admin'), displayName: 'Platform Admin', permissions: ['asset.read', 'approval.review', 'approval.release', 'audit.read', 'capability.publish', 'capability.consume', 'billing.read', 'billing.settle'] },
]

declare module '@deepseek-ai/cordis' {
  interface Context {
    platformShell: PlatformShellService
  }
}

/** One mutation wrapped in an immediate transaction with schema validation and audit. */
type Mutation = (db: DatabaseSync, now: number) => void

/**
 * The platform control-plane service.
 * Register via `ctx.plugin(PlatformShellService, config)`; the service is
 * injected as `ctx.platformShell`.
 */
export class PlatformShellService extends Service {
  static Config: z<Config> = z.object({
    path: z.string().default(':memory:'),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.number().step(1).min(1).default(5000),
  })

  private db: DatabaseSync | null = null
  private databasePath = ':memory:'
  private databaseConstructor: typeof import('node:sqlite')['DatabaseSync'] = null as never

  constructor(
    ctx: Context,
    public readonly config: Config,
  ) {
    super(ctx, 'platformShell')
    ctx.effect(() => () => {
      this.db?.close()
      this.db = null
    }, 'platformShell.database()')
  }

  /** Open and validate the control-plane database on service start. */
  async [Service.init](): Promise<void> {
    const path = this.config.path ?? ':memory:'
    const journalMode = this.config.journalMode ?? 'wal'
    const busyTimeoutMs = this.config.busyTimeoutMs ?? 5000
    const actual = await prepareDatabasePath(path)
    if (actual !== ':memory:') await createDatabaseFile(actual)
    this.databasePath = actual
    const module = await loadSqliteConstructor()
    this.databaseConstructor = module.DatabaseSync
    this.db = await openDatabase(module.DatabaseSync, actual, journalMode, busyTimeoutMs)
    this.seedRoles()
  }

  /** Seed default roles into a fresh database. */
  private seedRoles(): void {
    this.mutate((db) => {
      for (const role of DEFAULT_ROLES) upsertRole(db, role.id, role.displayName, role.permissions)
    })
  }

  private mutate(mutation: Mutation): void {
    const db = this.requireDb()
    db.exec(sql('begin-immediate'))
    try {
      validateSchemaForMutation(this.databaseConstructor, db, this.databasePath)
      mutation(db, Date.now())
      db.exec(sql('commit'))
    } catch (error: unknown) {
      try {
        db.exec(sql('rollback'))
      } catch {
        // The original mutation failure remains actionable.
      }
      throw error
    }
  }

  /** The open owned database, or a structured error when uninitialized. */
  private requireDb(): DatabaseSync {
    if (this.db === null) {
      throw new PlatformShellError('INVALID_ARGUMENT', 'platform database is not open')
    }
    return this.db
  }

  /** Require a platform-level permission via the actor's single membership workspace. */
  private requirePlatformPermission(db: DatabaseSync, actor: UserId, permission: Permission): void {
    requirePermission(db, actor, onlyWorkspaceOf(db, actor), permission)
  }

  // --- identity / tenant / rbac ---

  /**
   * Register one platform user.
   * @param name - the user's display name.
   * @returns the registered platform user identity.
   */
  registerUser(name: string): UserId {
    const base = Date.now()
    let userId = UserId(`user-${base}`)
    this.mutate((db, mutationNow) => {
      userId = allocateUserId(db, base)
      insertUser(db, userId, name, mutationNow)
      writeAudit(db, { actorUserId: userId, workspaceId: null, action: 'tenant.user.register', targetKind: 'user', targetId: userId, detail: null }, mutationNow)
    })
    return userId
  }

  /**
   * Create one workspace.
   * @param name - the workspace's display name.
   * @returns the created workspace identity.
   */
  createWorkspace(name: string): WorkspaceId {
    const workspaceId = WorkspaceId(`ws-${Date.now()}`)
    this.mutate((db, now) => {
      insertWorkspace(db, workspaceId, name, now)
      writeAudit(db, { actorUserId: UserId('system'), workspaceId: null, action: 'tenant.workspace.create', targetKind: 'workspace', targetId: workspaceId, detail: null }, now)
    })
    return workspaceId
  }

  /**
   * Register or merge one role with its permission set (idempotent).
   * @param roleId - the role identity to register or overwrite.
   * @param displayName - the role's display name.
   * @param permissions - the permission set the role holds within a workspace.
   */
  registerRole(roleId: RoleId, displayName: string, permissions: readonly Permission[]): void {
    this.mutate((db, now) => {
      upsertRole(db, roleId, displayName, permissions)
      writeAudit(db, { actorUserId: UserId('system'), workspaceId: null, action: 'rbac.role.register', targetKind: 'role', targetId: roleId, detail: JSON.stringify({ permissions }) }, now)
    })
  }

  /**
   * Assign one role to a user within one workspace.
   * @param workspaceId - the workspace the membership belongs to.
   * @param userId - the user being assigned.
   * @param roleId - the role to assign.
   */
  assignRole(workspaceId: WorkspaceId, userId: UserId, roleId: RoleId): void {
    this.mutate((db, now) => {
      assignRole(db, workspaceId, userId, roleId)
      writeAudit(db, { actorUserId: userId, workspaceId, action: 'rbac.membership.assign', targetKind: 'role', targetId: roleId, detail: null }, now)
    })
  }

  /**
   * Resolve one user's membership in one workspace.
   * @param userId - the platform user.
   * @param workspaceId - the workspace to resolve against.
   * @returns the membership, or `undefined` when the user is not a member.
   */
  membership(userId: UserId, workspaceId: WorkspaceId): Membership | undefined {
    return membership(this.requireDb(), userId, workspaceId)
  }

  /**
   * Whether one user may access one workspace.
   * @param userId - the platform user.
   * @param workspaceId - the workspace to test.
   * @returns whether the user holds any membership in the workspace.
   */
  canAccessWorkspace(userId: UserId, workspaceId: WorkspaceId): boolean {
    return canAccessWorkspace(this.requireDb(), userId, workspaceId)
  }

  /**
   * Remove one user.
   * @param userId - the platform user to remove.
   */
  deleteUser(userId: UserId): void {
    this.mutate((db, now) => {
      deleteUser(db, userId)
      writeAudit(db, { actorUserId: userId, workspaceId: null, action: 'tenant.user.delete', targetKind: 'user', targetId: userId, detail: null }, now)
    })
  }

  // --- asset store ---

  /**
   * Register one asset under the caller's produce role, in one workspace.
   * @param actor - the platform user producing the asset.
   * @param request - workspace, kind, content, and the caller's producing role.
   * @returns the committed asset record.
   */
  registerAsset(actor: UserId, request: RegisterAssetRequest): AssetRecord {
    validateKind(request.kind)
    let created: AssetRecord | undefined
    this.mutate((db, now) => {
      requirePermission(db, actor, request.workspaceId, 'asset.register')
      const member = membership(db, actor, request.workspaceId)
      if (member?.roleId !== request.roleId) {
        throw new PlatformShellError('PERMISSION_DENIED', `user ${actor} is not a ${request.roleId} in ${request.workspaceId}`)
      }
      created = registerAsset(db, request.workspaceId, request.kind, request.content, request.roleId, now)
      writeAudit(db, {
        actorUserId: actor,
        workspaceId: request.workspaceId,
        action: 'asset.register',
        targetKind: 'asset',
        targetId: created.id,
        detail: JSON.stringify({ kind: created.kind, roleId: created.roleId }),
      }, now)
    })
    return created as AssetRecord
  }

  /**
   * Read one asset, workspace-scoped to the caller.
   * @param actor - the platform user reading the asset.
   * @param assetId - the asset to read.
   * @returns the asset record, or `undefined` when absent.
   */
  getAsset(actor: UserId, assetId: AssetId): AssetRecord | undefined {
    const db = this.requireDb()
    const asset = requireAsset(db, assetId)
    requirePermission(db, actor, asset.workspaceId, 'asset.read')
    const result = getAsset(db, assetId, asset.workspaceId)
    if (result === undefined) return undefined
    writeAudit(db, {
      actorUserId: actor,
      workspaceId: result.workspaceId,
      action: 'asset.read',
      targetKind: 'asset',
      targetId: result.id,
      detail: JSON.stringify({ kind: result.kind, roleId: result.roleId }),
    }, Date.now())
    return result
  }

  /**
   * List assets in one workspace visible to the caller.
   * @param actor - the platform user listing the workspace.
   * @param workspaceId - the workspace to list.
   * @returns the workspace's asset records.
   */
  listAssets(actor: UserId, workspaceId: WorkspaceId): AssetRecord[] {
    const db = this.requireDb()
    requirePermission(db, actor, workspaceId, 'asset.read')
    return listAssets(db, workspaceId)
  }

  // --- lineage ---

  /**
   * Record that one asset derives from another.
   * @param actor - the platform user linking the assets.
   * @param assetId - the derived asset.
   * @param parentId - the asset it derives from.
   */
  linkAsset(actor: UserId, assetId: AssetId, parentId: AssetId): void {
    this.mutate((db, now) => {
      const asset = requireAsset(db, assetId)
      const parent = requireAsset(db, parentId)
      if (asset.workspaceId !== parent.workspaceId) {
        throw new PlatformShellError('INVALID_ARGUMENT', `assets ${assetId} and ${parentId} are not in the same workspace`)
      }
      requirePermission(db, actor, asset.workspaceId, 'asset.register')
      linkAsset(db, assetId, parentId, asset.roleId, now)
      writeAudit(db, { actorUserId: actor, workspaceId: asset.workspaceId, action: 'lineage.link', targetKind: 'asset', targetId: assetId, detail: JSON.stringify({ parentId }) }, now)
    })
  }

  /**
   * All transitive ancestors toward the derivation source.
   * @param actor - the platform user tracing the lineage.
   * @param assetId - the asset to trace.
   * @returns ancestor edges in derivation order.
   */
  ancestors(actor: UserId, assetId: AssetId): LineageEdge[] {
    const db = this.requireDb()
    const asset = requireAsset(db, assetId)
    requirePermission(db, actor, asset.workspaceId, 'asset.read')
    return walkAncestors(db, assetId)
  }

  /**
   * All transitive descendants.
   * @param actor - the platform user tracing the lineage.
   * @param assetId - the asset to trace.
   * @returns descendant edges in derivation order.
   */
  descendants(actor: UserId, assetId: AssetId): LineageEdge[] {
    const db = this.requireDb()
    const asset = requireAsset(db, assetId)
    requirePermission(db, actor, asset.workspaceId, 'asset.read')
    return walkDescendants(db, assetId)
  }

  /**
   * One asset's direct derivation parents.
   * @param actor - the platform user tracing the lineage.
   * @param assetId - the asset to trace.
   * @returns direct parent edges.
   */
  parents(actor: UserId, assetId: AssetId): LineageEdge[] {
    const db = this.requireDb()
    const asset = requireAsset(db, assetId)
    requirePermission(db, actor, asset.workspaceId, 'asset.read')
    return directParents(db, assetId)
  }

  /**
   * One asset's direct derivation children.
   * @param actor - the platform user tracing the lineage.
   * @param assetId - the asset to trace.
   * @returns direct child edges.
   */
  children(actor: UserId, assetId: AssetId): LineageEdge[] {
    const db = this.requireDb()
    const asset = requireAsset(db, assetId)
    requirePermission(db, actor, asset.workspaceId, 'asset.read')
    return directChildren(db, assetId)
  }

  // --- business approval ---

  /**
   * Submit one ticket for a subject asset, starting in `draft`.
   * @param actor - the platform user submitting the ticket.
   * @param workspaceId - the workspace the subject asset belongs to.
   * @param subjectAssetId - the asset the ticket reviews.
   * @returns the committed draft ticket.
   */
  submitTicket(actor: UserId, workspaceId: WorkspaceId, subjectAssetId: AssetId): ApprovalTicket {
    const db = this.requireDb()
    requirePermission(db, actor, workspaceId, 'asset.register')
    const asset = requireAsset(db, subjectAssetId)
    if (asset.workspaceId !== workspaceId) {
      throw new PlatformShellError('INVALID_ARGUMENT', `asset ${subjectAssetId} is not in workspace ${workspaceId}`)
    }
    let ticket: ApprovalTicket | undefined
    this.mutate((db, now) => {
      ticket = createTicket(db, workspaceId, asset.kind, subjectAssetId, actor, now, nextTicketSequence(db))
      writeAudit(db, { actorUserId: actor, workspaceId, action: 'approval.submit', targetKind: 'ticket', targetId: ticket.id, detail: JSON.stringify({ subjectAssetId }) }, now)
    })
    return ticket as ApprovalTicket
  }

  /**
   * Move one ticket across an allowed edge.
   * @param actor - the platform user authorizing the transition.
   * @param ticketId - the ticket to move.
   * @param to - the target status.
   * @param scope - review scope the `approved` edge requires, else omitted.
   * @returns the committed ticket.
   */
  transition(actor: UserId, ticketId: TicketId, to: BusinessApprovalStatus, scope?: ReviewScope): ApprovalTicket {
    const db = this.requireDb()
    const ticket = requireTicket(db, ticketId)
    requirePermission(db, actor, ticket.workspaceId, to === 'released' ? 'approval.release' : 'approval.review')
    let updated: ApprovalTicket | undefined
    this.mutate((db, now) => {
      updated = transitionTicket(db, ticket, to, actor, now, scope ?? null)
      writeAudit(db, { actorUserId: actor, workspaceId: ticket.workspaceId, action: 'approval.transition', targetKind: 'ticket', targetId: ticketId, detail: JSON.stringify({ from: ticket.status, to }) }, now)
    })
    return updated as ApprovalTicket
  }

  /**
   * Read one ticket.
   * @param actor - the platform user reading the ticket.
   * @param ticketId - the ticket to read.
   * @returns the ticket, or `undefined` when absent.
   */
  getTicket(actor: UserId, ticketId: TicketId): ApprovalTicket | undefined {
    const db = this.requireDb()
    const ticket = requireTicket(db, ticketId)
    requirePermission(db, actor, ticket.workspaceId, 'approval.review')
    return getTicket(db, ticketId)
  }

  /**
   * List tickets in one workspace.
   * @param actor - the platform user listing the workspace.
   * @param workspaceId - the workspace to list.
   * @returns the workspace's tickets.
   */
  listTickets(actor: UserId, workspaceId: WorkspaceId): ApprovalTicket[] {
    const db = this.requireDb()
    requirePermission(db, actor, workspaceId, 'approval.review')
    return listTickets(db, workspaceId)
  }

  /**
   * One ticket's recorded transition log.
   * @param actor - the platform user reading the log.
   * @param ticketId - the ticket to trace.
   * @returns the ticket's transition records.
   */
  transitions(actor: UserId, ticketId: TicketId): ApprovalTransition[] {
    const db = this.requireDb()
    const ticket = requireTicket(db, ticketId)
    requirePermission(db, actor, ticket.workspaceId, 'approval.review')
    return transitions(db, ticketId)
  }

  /**
   * Whether one asset exists in the control-plane store.
   * @param assetId - the asset to test.
   * @returns whether a stored asset carries the identity.
   */
  assetExists(assetId: AssetId): boolean {
    const db = this.requireDb()
    return db.prepare(sql('select-asset')).get(assetId) !== undefined
  }

  /**
   * One ticket's committed status, or `undefined` when absent.
   * @param ticketId - the ticket to inspect.
   * @returns the committed status, or `undefined` for an unknown ticket.
   */
  ticketStatus(ticketId: TicketId): BusinessApprovalStatus | undefined {
    return getTicket(this.requireDb(), ticketId)?.status
  }

  // --- capability market ---

  /**
   * Publish one capability to the market catalog.
   * @param actor - the operator publishing the capability.
   * @param request - catalog entry fields, dependency and conflict edges, and the execution gate.
   * @returns the committed catalog entry.
   */
  publishCapability(actor: UserId, request: PublishCapabilityRequest): CapabilityRecord {
    validateCapabilityRequest(request)
    let published: CapabilityRecord | undefined
    this.mutate((db, now) => {
      this.requirePlatformPermission(db, actor, 'capability.publish')
      if (getCapability(db, request.id) !== undefined) {
        throw new PlatformShellError('DUPLICATE_CAPABILITY', `capability ${request.id} is already published`)
      }
      for (const dependency of request.dependencies ?? []) requireCapability(db, dependency.id)
      for (const conflict of request.conflictsWith ?? []) requireCapability(db, conflict)
      insertCapability(db, request, now)
      for (const dependency of request.dependencies ?? []) {
        insertCapabilityDependency(db, request.id, dependency.id, dependency.range ?? null, now)
      }
      for (const conflict of request.conflictsWith ?? []) {
        insertCapabilityConflict(db, request.id, conflict, now)
      }
      published = getCapability(db, request.id)
      writeAudit(db, {
        actorUserId: actor,
        workspaceId: onlyWorkspaceOf(db, actor),
        action: 'market.capability.publish',
        targetKind: 'capability',
        targetId: request.id,
        detail: JSON.stringify({
          name: request.name,
          version: request.version,
          execution: request.execution,
          roleId: request.roleId,
          rate: request.rate,
        }),
      }, now)
    })
    return published as CapabilityRecord
  }

  /**
   * Remove one capability from the market catalog.
   * @param actor - the operator unpublishing the capability.
   * @param capabilityId - the catalog entry to remove.
   */
  unpublishCapability(actor: UserId, capabilityId: CapabilityId): void {
    this.mutate((db, now) => {
      this.requirePlatformPermission(db, actor, 'capability.publish')
      requireCapability(db, capabilityId)
      deleteCapability(db, capabilityId)
      writeAudit(db, { actorUserId: actor, workspaceId: onlyWorkspaceOf(db, actor), action: 'market.capability.unpublish', targetKind: 'capability', targetId: capabilityId, detail: null }, now)
    })
  }

  /**
   * List every catalog entry in identity order.
   * @param actor - the platform user listing the catalog.
   * @returns the catalog entries.
   */
  listCapabilities(actor: UserId): CapabilityRecord[] {
    const db = this.requireDb()
    this.requirePlatformPermission(db, actor, 'capability.consume')
    return listCapabilities(db)
  }

  /**
   * Read one catalog entry.
   * @param actor - the platform user reading the catalog.
   * @param capabilityId - the catalog entry to read.
   * @returns the entry, or `undefined` when absent.
   */
  getCapability(actor: UserId, capabilityId: CapabilityId): CapabilityRecord | undefined {
    const db = this.requireDb()
    this.requirePlatformPermission(db, actor, 'capability.consume')
    return getCapability(db, capabilityId)
  }

  /**
   * Set one catalog entry's execution gate.
   * @param actor - the operator setting the gate.
   * @param capabilityId - the catalog entry to gate.
   * @param gate - enabled flag and 0..1 rollout fraction.
   * @returns the committed entry.
   */
  setCapabilityGate(actor: UserId, capabilityId: CapabilityId, gate: CapabilityGate): CapabilityRecord {
    if (gate.rollout < 0 || gate.rollout > 1) {
      throw new PlatformShellError('INVALID_ARGUMENT', 'capability rollout must be within 0..1')
    }
    let updated: CapabilityRecord | undefined
    this.mutate((db, now) => {
      this.requirePlatformPermission(db, actor, 'capability.publish')
      updated = setCapabilityGate(db, capabilityId, gate.enabled, gate.rollout)
      writeAudit(db, { actorUserId: actor, workspaceId: onlyWorkspaceOf(db, actor), action: 'market.capability.gate', targetKind: 'capability', targetId: capabilityId, detail: JSON.stringify({ enabled: gate.enabled, rollout: gate.rollout }) }, now)
    })
    return updated as CapabilityRecord
  }

  /**
   * Register one scenario bundle (a pluggable C-side workbench surface).
   * @param actor - the operator publishing the scenario.
   * @param request - bundle fields and the workbench's capability set.
   * @returns the committed scenario bundle.
   */
  publishScenario(actor: UserId, request: PublishScenarioRequest): ScenarioBundle {
    validateScenarioRequest(request)
    let published: ScenarioBundle | undefined
    this.mutate((db, now) => {
      this.requirePlatformPermission(db, actor, 'capability.publish')
      if (getScenario(db, request.id) !== undefined) {
        throw new PlatformShellError('DUPLICATE_SCENARIO', `scenario ${request.id} is already published`)
      }
      for (const capabilityId of request.capabilityIds) requireCapability(db, capabilityId)
      insertScenario(db, request, now)
      for (const capabilityId of request.capabilityIds) {
        insertScenarioCapability(db, request.id, capabilityId)
      }
      published = getScenario(db, request.id)
      writeAudit(db, {
        actorUserId: actor,
        workspaceId: onlyWorkspaceOf(db, actor),
        action: 'market.scenario.publish',
        targetKind: 'scenario',
        targetId: request.id,
        detail: JSON.stringify({ name: request.name, workbenchId: request.workbenchId, preset: request.preset }),
      }, now)
    })
    return published as ScenarioBundle
  }

  /**
   * Remove one scenario bundle (a pluggable C-side workbench surface).
   * @param actor - the operator unpublishing the scenario.
   * @param scenarioId - the scenario to remove.
   */
  unpublishScenario(actor: UserId, scenarioId: ScenarioId): void {
    this.mutate((db, now) => {
      this.requirePlatformPermission(db, actor, 'capability.publish')
      requireScenario(db, scenarioId)
      deleteScenario(db, scenarioId)
      writeAudit(db, { actorUserId: actor, workspaceId: onlyWorkspaceOf(db, actor), action: 'market.scenario.unpublish', targetKind: 'scenario', targetId: scenarioId, detail: null }, now)
    })
  }

  /**
   * List every scenario bundle in identity order.
   * @param actor - the platform user listing the workbenches.
   * @returns the scenario bundles.
   */
  listScenarios(actor: UserId): ScenarioBundle[] {
    const db = this.requireDb()
    this.requirePlatformPermission(db, actor, 'capability.consume')
    return listScenarios(db)
  }

  /**
   * Read one scenario bundle.
   * @param actor - the platform user reading the workbench.
   * @param scenarioId - the scenario to read.
   * @returns the bundle, or `undefined` when absent.
   */
  getScenario(actor: UserId, scenarioId: ScenarioId): ScenarioBundle | undefined {
    const db = this.requireDb()
    this.requirePlatformPermission(db, actor, 'capability.consume')
    return getScenario(db, scenarioId)
  }

  /**
   * Resolve one capability selection within one scenario's workbench surface.
   * @param actor - the platform user assembling capabilities.
   * @param request - the workspace, scenario, and selected capability ids.
   * @returns the ordered resolved set plus the scenario's preset id.
   */
  resolveCapabilities(actor: UserId, request: ResolveCapabilitiesRequest): ResolvedCapabilitySet {
    const db = this.requireDb()
    requirePermission(db, actor, request.workspaceId, 'capability.consume')
    const scenario = requireScenario(db, request.scenarioId)
    for (const id of request.selected) {
      if (!scenario.capabilityIds.includes(id)) {
        throw new PlatformShellError('INVALID_ARGUMENT', `capability ${id} is not part of workbench ${scenario.workbenchId}`)
      }
    }
    const resolved = resolveSelection(loadCatalog(db), request.workspaceId, request.selected)
    writeAudit(db, {
      actorUserId: actor,
      workspaceId: request.workspaceId,
      action: 'market.capability.resolve',
      targetKind: 'scenario',
      targetId: request.scenarioId,
      detail: JSON.stringify({ requested: request.selected, resolved: resolved.map(c => c.id) }),
    }, Date.now())
    return { requested: request.selected, resolved, preset: scenario.preset }
  }

  // --- billing ---

  /**
   * Credit one workspace's billing account.
   * @param actor - the operator crediting the account.
   * @param workspaceId - the workspace account to credit.
   * @param amount - non-negative credits to add.
   * @returns the updated account.
   */
  creditAccount(actor: UserId, workspaceId: WorkspaceId, amount: number): AccountRecord {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new PlatformShellError('INVALID_ARGUMENT', 'credit amount must be a non-negative integer of credits')
    }
    let account: AccountRecord | undefined
    this.mutate((db, now) => {
      this.requirePlatformPermission(db, actor, 'billing.settle')
      account = creditAccount(db, workspaceId, amount, now)
      writeAudit(db, { actorUserId: actor, workspaceId, action: 'billing.account.credit', targetKind: 'account', targetId: workspaceId, detail: JSON.stringify({ amount }) }, now)
    })
    return account as AccountRecord
  }

  /**
   * Read one workspace's billing account.
   * @param actor - the platform user reading the account.
   * @param workspaceId - the workspace account to read.
   * @returns the account, or `undefined` when no account has been opened.
   */
  accountBalance(actor: UserId, workspaceId: WorkspaceId): AccountRecord | undefined {
    const db = this.requireDb()
    requirePermission(db, actor, workspaceId, 'billing.read')
    return getAccount(db, workspaceId)
  }

  /**
   * List one workspace's usage records in billing order.
   * @param actor - the platform user reading the ledger.
   * @param workspaceId - the workspace whose usage to list.
   * @returns the usage records.
   */
  listUsage(actor: UserId, workspaceId: WorkspaceId): UsageRecord[] {
    const db = this.requireDb()
    requirePermission(db, actor, workspaceId, 'billing.read')
    return listUsage(db, workspaceId)
  }

  /**
   * Consume one capability against a workspace account, metering usage.
   * @param actor - the platform user consuming the capability.
   * @param request - the workspace, capability, and quantity.
   * @returns the committed usage record.
   */
  consumeCapability(actor: UserId, request: ConsumeCapabilityRequest): UsageRecord {
    const qty = request.qty ?? 1
    if (!Number.isSafeInteger(qty) || qty < 1) {
      throw new PlatformShellError('INVALID_ARGUMENT', 'consumption quantity must be a positive integer')
    }
    let usage: UsageRecord | undefined
    this.mutate((db, now) => {
      requirePermission(db, actor, request.workspaceId, 'capability.consume')
      const capability = requireCapability(db, request.capabilityId)
      assertGateOpen(capability, request.workspaceId)
      const account = ensureAccount(db, request.workspaceId, now)
      const cost = capability.rate * qty
      if (account.balance < cost) {
        throw new PlatformShellError('INSUFFICIENT_BALANCE', `workspace ${request.workspaceId} has ${account.balance} credits, needs ${cost}`)
      }
      const period = periodOf(now)
      debitAccount(db, request.workspaceId, cost)
      usage = insertUsage(db, request.workspaceId, request.capabilityId, qty, cost, now)
      const settlement = ensureOpenSettlement(db, request.workspaceId, period, now)
      accrueSettlement(db, settlement.id, settlement.amount + cost)
      writeAudit(db, {
        actorUserId: actor,
        workspaceId: request.workspaceId,
        action: 'billing.consume',
        targetKind: 'capability',
        targetId: request.capabilityId,
        detail: JSON.stringify({ qty, cost, balance: account.balance - cost }),
      }, now)
    })
    return usage as UsageRecord
  }

  /**
   * Close one workspace's open settlement for a period as `settled`.
   * @param actor - the operator settling the account.
   * @param workspaceId - the workspace whose period to settle.
   * @param period - the `YYYY-MM` billing period to close.
   * @returns the committed settlement.
   */
  settleAccount(actor: UserId, workspaceId: WorkspaceId, period: string): SettlementRecord {
    if (period.length === 0) {
      throw new PlatformShellError('INVALID_ARGUMENT', 'settlement period must not be empty')
    }
    let settlement: SettlementRecord | undefined
    this.mutate((db, now) => {
      this.requirePlatformPermission(db, actor, 'billing.settle')
      settlement = settleSettlement(db, workspaceId, period, now)
      writeAudit(db, { actorUserId: actor, workspaceId, action: 'billing.settlement.settle', targetKind: 'settlement', targetId: settlement.id, detail: JSON.stringify({ period, amount: settlement.amount }) }, now)
    })
    return settlement as SettlementRecord
  }

  // --- market probes (invariant backing) ---

  /**
   * Whether one capability exists in the market catalog.
   * @param capabilityId - the catalog entry to test.
   * @returns whether the catalog holds the entry.
   */
  capabilityExists(capabilityId: CapabilityId): boolean {
    return getCapability(this.requireDb(), capabilityId) !== undefined
  }

  /**
   * Whether one scenario bundle exists.
   * @param scenarioId - the scenario to test.
   * @returns whether the market holds the bundle.
   */
  scenarioExists(scenarioId: ScenarioId): boolean {
    return getScenario(this.requireDb(), scenarioId) !== undefined
  }

  /**
   * One settlement's committed status, or `undefined` when absent.
   * @param settlementId - the settlement to inspect.
   * @returns the committed status, or `undefined` for an unknown settlement.
   */
  settlementStatus(settlementId: SettlementId): SettlementStatus | undefined {
    return getSettlement(this.requireDb(), settlementId)?.status
  }

  // --- audit ---

  /**
   * List audit rows, filtered by workspace and action.
   * @param actor - the platform user reading the audit log.
   * @param filter - optional workspace and action filters; a workspace-less
   * actor resolves to its single membership.
   * @returns the matching audit events.
   */
  listAudit(actor: UserId, filter: { readonly workspaceId?: WorkspaceId; readonly action?: string } = {}): AuditEvent[] {
    const db = this.requireDb()
    const workspaceId = filter.workspaceId ?? onlyWorkspaceOf(db, actor)
    requirePermission(db, actor, workspaceId, 'audit.read')
    return listAudit(db, { ...filter, workspaceId })
  }
}

/** The workspace owning one asset. */
function requireAsset(db: DatabaseSync, assetId: AssetId): AssetRecord {
  const row = db.prepare(sql('select-asset')).get(assetId)
  if (row === undefined) throw new PlatformShellError('ASSET_NOT_FOUND', `unknown asset ${assetId}`)
  return decodeAssetRow(row)
}

/** The workspace owning one ticket. */
function requireTicket(db: DatabaseSync, ticketId: TicketId): ApprovalTicket {
  const ticket = getTicket(db, ticketId)
  if (ticket === undefined) throw new PlatformShellError('TICKET_NOT_FOUND', `unknown ticket ${ticketId}`)
  return ticket
}

/** The workspace the actor is a member of, used as the audit read scope. */
function onlyWorkspaceOf(db: DatabaseSync, actor: UserId): WorkspaceId {
  const rows = db.prepare(sql('select-member-workspaces')).all(actor) as { workspace_id: string }[]
  const first = rows[0]
  if (first === undefined) {
    throw new PlatformShellError('PERMISSION_DENIED', `user ${actor} is not a member of any workspace`)
  }
  return WorkspaceId(first.workspace_id)
}

/** Allocate a unique `user-<seq>` identity starting at `base` (same-millisecond safe). */
function allocateUserId(db: DatabaseSync, base: number): UserId {
  const taken = new Set(
    (db.prepare(sql('select-users')).all() as { user_id: string }[]).map(row => row.user_id),
  )
  let sequence = base
  while (taken.has(`user-${sequence}`)) sequence += 1
  return UserId(`user-${sequence}`)
}

export type { PlatformShellErrorCode } from './error.ts'
