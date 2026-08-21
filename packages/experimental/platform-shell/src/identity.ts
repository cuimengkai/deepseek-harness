/**
 * Platform identity and RBAC: users, workspaces, roles, role permissions,
 * and workspace membership. Membership resolution and workspace access are
 * authoritative reads over the same owned database that assets and approvals
 * write to, so ACL policy later consults this store.
 * @module @deepseek-ai/dsh-experimental-platform-shell/identity
 */

import type { DatabaseSync } from 'node:sqlite'
import {
  RoleId,
  type Membership,
  type Permission,
  type UserId,
  type WorkspaceId,
} from './types.ts'
import { PlatformShellError } from './error.ts'
import { sql } from './sql.ts'

/** A row returned by the membership join. */
export interface MembershipRow {
  readonly role_id: string
  readonly role_name: string
}

/**
 * Register one platform user.
 * @param db - the SQLite database handle.
 * @param userId - the user's branded id.
 * @param displayName - the user's display name.
 * @param now - the epoch-ms timestamp.
 */
export function insertUser(db: DatabaseSync, userId: UserId, displayName: string, now: number): void {
  db.prepare(sql('insert-user')).run(userId, displayName, now)
}

/**
 * Create one workspace.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @param name - the workspace's display name.
 * @param isolated - whether the workspace demands on-demand physical isolation.
 * @param now - the epoch-ms timestamp.
 */
export function insertWorkspace(
  db: DatabaseSync,
  workspaceId: WorkspaceId,
  name: string,
  isolated: boolean,
  now: number,
): void {
  db.prepare(sql('insert-workspace')).run(workspaceId, name, isolated ? 1 : 0, now)
}

/**
 * Whether one workspace demands on-demand physical isolation.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @returns whether the workspace is isolated.
 */
export function workspaceIsolation(db: DatabaseSync, workspaceId: WorkspaceId): boolean {
  const row = db.prepare(sql('select-workspace-isolation')).get(workspaceId) as { isolated: number } | undefined
  if (row === undefined) throw new PlatformShellError('UNKNOWN_WORKSPACE', `workspace ${workspaceId} does not exist`)
  return row.isolated === 1
}

/**
 * Set one workspace's on-demand physical-isolation flag.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace to re-flag.
 * @param isolated - the new isolation state.
 */
export function setWorkspaceIsolation(
  db: DatabaseSync,
  workspaceId: WorkspaceId,
  isolated: boolean,
): void {
  db.prepare(sql('update-workspace-isolation')).run(isolated ? 1 : 0, workspaceId)
}

/**
 * Register or merge one role with its permission set (idempotent).
 * @param db - the SQLite database handle.
 * @param roleId - the role's branded id.
 * @param displayName - the role's display name.
 * @param permissions - the permission set the role holds within a workspace.
 */
export function upsertRole(
  db: DatabaseSync,
  roleId: RoleId,
  displayName: string,
  permissions: readonly Permission[],
): void {
  db.prepare(sql('insert-role')).run(roleId, displayName)
  const statement = db.prepare(sql('insert-role-permission'))
  for (const permission of permissions) statement.run(roleId, permission)
}

/**
 * Assign one role to a user within a workspace.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace the membership belongs to.
 * @param userId - the user being assigned.
 * @param roleId - the role to assign.
 */
export function assignRole(db: DatabaseSync, workspaceId: WorkspaceId, userId: UserId, roleId: RoleId): void {
  db.prepare(sql('insert-member')).run(workspaceId, userId, roleId)
}

/**
 * Resolve one user's membership within one workspace.
 * @param db - the SQLite database handle.
 * @param userId - the platform user.
 * @param workspaceId - the workspace to resolve against.
 * @returns the resolved role and permission set, or `undefined` when the user
 * is not a member of the workspace.
 */
export function membership(
  db: DatabaseSync,
  userId: UserId,
  workspaceId: WorkspaceId,
): Membership | undefined {
  const rows = db.prepare(sql('select-membership')).all(userId, workspaceId) as unknown as MembershipRow[]
  const first = rows[0]
  if (first === undefined) return undefined
  const permissions = rows.flatMap(row => readRolePermissions(db, RoleId(row.role_id)))
  return {
    roleId: RoleId(first.role_id),
    permissions,
  }
}

/**
 * Read one role's permission set.
 * @param db - the SQLite database handle.
 * @param roleId - the role's branded id.
 * @returns the role's stored permissions.
 */
export function readRolePermissions(db: DatabaseSync, roleId: RoleId): readonly Permission[] {
  const rows = db.prepare(sql('select-role-permissions')).all(roleId) as { permission: string }[]
  return rows.map(row => validatePermission(row.permission))
}

function validatePermission(value: string): Permission {
  if (value !== 'asset.read' && value !== 'asset.register' && value !== 'approval.review'
    && value !== 'approval.release' && value !== 'audit.read'
    && value !== 'capability.publish' && value !== 'capability.consume'
    && value !== 'billing.read' && value !== 'billing.settle'
    && value !== 'platform.isolation') {
    throw new PlatformShellError('INVALID_ARGUMENT', `stored permission "${value}" is not a known permission`)
  }
  return value
}

/**
 * Whether one user may access one workspace.
 * @param db - the SQLite database handle.
 * @param userId - the platform user.
 * @param workspaceId - the workspace to test.
 * @returns whether the user holds any membership in the workspace.
 * @throws UNKNOWN_ACTOR when the user does not exist.
 */
export function canAccessWorkspace(
  db: DatabaseSync,
  userId: UserId,
  workspaceId: WorkspaceId,
): boolean {
  assertUserExists(db, userId)
  assertWorkspaceExists(db, workspaceId)
  return membership(db, userId, workspaceId) !== undefined
}

/**
 * Whether one user holds a permission within one workspace.
 * @param db - the SQLite database handle.
 * @param userId - the platform user.
 * @param workspaceId - the workspace to test.
 * @param permission - the permission to require.
 * @throws UNKNOWN_ACTOR when the user does not exist.
 * @throws UNKNOWN_WORKSPACE when the workspace does not exist.
 */
export function requirePermission(
  db: DatabaseSync,
  userId: UserId,
  workspaceId: WorkspaceId,
  permission: Permission,
): void {
  assertUserExists(db, userId)
  assertWorkspaceExists(db, workspaceId)
  const member = membership(db, userId, workspaceId)
  if (member === undefined || !member.permissions.includes(permission)) {
    throw new PlatformShellError('PERMISSION_DENIED', `user ${userId} lacks ${permission} in workspace ${workspaceId}`)
  }
}

/**
 * Assert that one user exists.
 * @param db - the SQLite database handle.
 * @param userId - the user's branded id.
 * @throws UNKNOWN_ACTOR when the user does not exist.
 */
export function assertUserExists(db: DatabaseSync, userId: UserId): void {
  const row = db.prepare(sql('select-user')).get(userId)
  if (row === undefined) throw new PlatformShellError('UNKNOWN_ACTOR', `unknown actor ${userId}`)
}

/**
 * Assert that one workspace exists.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @throws UNKNOWN_WORKSPACE when the workspace does not exist.
 */
export function assertWorkspaceExists(db: DatabaseSync, workspaceId: WorkspaceId): void {
  const row = db.prepare(sql('select-workspace')).get(workspaceId)
  if (row === undefined) {
    throw new PlatformShellError('UNKNOWN_WORKSPACE', `unknown workspace ${workspaceId}`)
  }
}

/**
 * Remove one user and their memberships.
 * @param db - the SQLite database handle.
 * @param userId - the user's branded id.
 */
export function deleteUser(db: DatabaseSync, userId: UserId): void {
  db.prepare(sql('delete-user')).run(userId)
}
