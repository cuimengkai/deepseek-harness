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
  type ApprovalTicket,
  type ApprovalTransition,
  type AssetId,
  type AssetRecord,
  type AuditEvent,
  type BusinessApprovalStatus,
  type Config,
  type LineageEdge,
  type Membership,
  type Permission,
  type RegisterAssetRequest,
  type ReviewScope,
  type TicketId,
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
import { sql } from './sql.ts'

/** One seed entry in {@link DEFAULT_ROLES}. */
type DefaultRoleSeed = {
  readonly id: RoleId
  readonly displayName: string
  readonly permissions: readonly Permission[]
}

/** Default roles seeded into every fresh platform database. */
export const DEFAULT_ROLES: readonly DefaultRoleSeed[] = [
  { id: RoleId('product'), displayName: 'Product', permissions: ['asset.register', 'asset.read', 'approval.review', 'audit.read'] },
  { id: RoleId('dev'), displayName: 'Developer', permissions: ['asset.register', 'asset.read'] },
  { id: RoleId('qa'), displayName: 'QA', permissions: ['asset.register', 'asset.read'] },
  { id: RoleId('platform-admin'), displayName: 'Platform Admin', permissions: ['asset.read', 'approval.review', 'approval.release', 'audit.read'] },
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
