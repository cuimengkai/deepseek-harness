/**
 * Platform shell identities, durable records, and service request values.
 * @module @deepseek-ai/dsh-experimental-platform-shell/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
/* Tie the SessionEventMap merge below to the session package's program file so
 * the augmented module resolves against a built source in composite builds. */
import type {} from '@deepseek-ai/dsh-session'

/** A platform user (one principal; distinct from dsh's anonymous identity). */
export type UserId = Branded<'UserId'>

/**
 * Brand a platform user identity.
 * @param id - validated user identity string.
 * @returns the same string branded as a UserId.
 */
export function UserId(id: string): UserId {
  return id as UserId
}

/** A platform workspace (the isolation unit per architecture D2). */
export type WorkspaceId = Branded<'WorkspaceId'>

/**
 * Brand a workspace identity.
 * @param id - validated workspace identity string.
 * @returns the same string branded as a WorkspaceId.
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

/** A role id within a workspace (product, dev, qa, platform-admin). */
export type RoleId = Branded<'RoleId'>

/**
 * Brand a role identity.
 * @param id - validated role identity string.
 * @returns the same string branded as a RoleId.
 */
export function RoleId(id: string): RoleId {
  return id as RoleId
}

/** A business-object asset identity (`<kind>-<seq>`). */
export type AssetId = Branded<'AssetId'>

/**
 * Brand an asset identity.
 * @param id - generated asset identity (`<kind>-<seq>`).
 * @returns the same string branded as an AssetId.
 */
export function AssetId(id: string): AssetId {
  return id as AssetId
}

/** A business-approval ticket identity (`approval-<seq>`). */
export type TicketId = Branded<'TicketId'>

/**
 * Brand an approval ticket identity.
 * @param id - generated ticket identity (`approval-<seq>`).
 * @returns the same string branded as a TicketId.
 */
export function TicketId(id: string): TicketId {
  return id as TicketId
}

/** A durable audit event identity. */
export type AuditEventId = Branded<'AuditEventId'>

/**
 * Brand an audit event identity.
 * @param id - generated audit event identity.
 * @returns the same string branded as an AuditEventId.
 */
export function AuditEventId(id: string): AuditEventId {
  return id as AuditEventId
}

/** One permission held by a role within a workspace. */
export type Permission = 'asset.read' | 'asset.register' | 'approval.review' | 'approval.release' | 'audit.read'

/** The closed set of asset kinds the store validates against (asset-schema §2). */
export type AssetKind = 'requirement' | 'design' | 'code' | 'test-case' | 'handoff'

/** A registered asset kind, with the roles allowed to produce it (asset-schema §2). */
export interface AssetKindRegistration {
  readonly kind: AssetKind
  readonly allowedRoles: readonly RoleId[]
}

/** One durable business-object asset (asset-schema §1). */
export interface AssetRecord {
  readonly id: AssetId
  readonly kind: AssetKind
  readonly content: string
  readonly roleId: RoleId
  readonly workspaceId: WorkspaceId
  readonly createdAt: number
}

/** One lineage edge: `assetId` derives from `parentId` (lineage-bridge §3). */
export interface LineageEdge {
  readonly assetId: AssetId
  readonly parentId: AssetId
  readonly roleId: RoleId
  readonly createdAt: number
}

/** Membership of one user in one workspace. */
export interface Membership {
  readonly roleId: RoleId
  readonly permissions: readonly Permission[]
}

/** The scope a business approval grants on transition (approval-state-machine §2). */
export interface ReviewScope {
  readonly roles: readonly RoleId[]
  readonly workspace: WorkspaceId
  readonly expiresAt: number
}

/** Business-approval lifecycle (approval-state-machine §2). */
export type BusinessApprovalStatus = 'draft' | 'review' | 'approved' | 'rejected' | 'released'

/** One durable business-approval ticket. */
export interface ApprovalTicket {
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

/** One recorded approval transition. */
export interface ApprovalTransition {
  readonly ticketId: TicketId
  readonly from: BusinessApprovalStatus | null
  readonly to: BusinessApprovalStatus
  readonly actorUserId: UserId
  readonly createdAt: number
}

/** One durable audit event (the platform audit log). */
export interface AuditEvent {
  readonly id: AuditEventId
  readonly actorUserId: UserId
  readonly workspaceId: WorkspaceId | null
  readonly action: string
  readonly targetKind: string | null
  readonly targetId: string | null
  readonly detail: string | null
  readonly createdAt: number
}

/** Input for registering one asset. */
export interface RegisterAssetRequest {
  readonly workspaceId: WorkspaceId
  readonly kind: AssetKind
  readonly content: string
  readonly roleId: RoleId
}

/** Platform-shell deployment configuration. */
export interface Config {
  /** Database path; `:memory:` for ephemeral stores. */
  readonly path?: string
  /** Journal mode forwarded to SQLite. */
  readonly journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  /** Maximum milliseconds to wait for a competing SQLite lock. */
  readonly busyTimeoutMs?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** The agent read a platform asset — the reference event of the lineage bridge. */
    'asset/read': {
      assetId: AssetId
      kind: AssetKind
      roleId: RoleId
      workspaceId: WorkspaceId
    }
    /** The agent produced a platform asset — the reference event of the lineage bridge. */
    'asset/register': {
      assetId: AssetId
      kind: AssetKind
      roleId: RoleId
      workspaceId: WorkspaceId
    }
    /** A business approval ticket crossed a state-machine edge. */
    'platform/approval/transition': {
      ticketId: TicketId
      /** The status the ticket left; `null` marks the initial draft creation. */
      from: BusinessApprovalStatus | null
      to: BusinessApprovalStatus
      actorUserId: UserId
      workspaceId: WorkspaceId
    }
  }
}
