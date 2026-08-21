/**
 * Platform asset store: closed-kind registration, deterministic `<kind>-<seq>`
 * identities, and workspace-scoped reads. Kinds are validated against the
 * registered set and unknown kinds are rejected loudly (asset-schema §2/§5).
 * @module @deepseek-ai/dsh-experimental-platform-shell/assets
 */

import type { DatabaseSync } from 'node:sqlite'
import {
  AssetId,
  type AssetKind,
  type AssetRecord,
  type RoleId,
  type WorkspaceId,
} from './types.ts'
import { PlatformShellError } from './error.ts'
import { decodeAssetRow } from './schema.ts'
import { sql } from './sql.ts'

/** The closed set of asset kinds this build validates (asset-schema §2). */
export const KNOWN_ASSET_KINDS: readonly AssetKind[] = [
  'requirement',
  'design',
  'code',
  'test-case',
  'handoff',
]

/** Roles permitted to produce each kind; empty means any role. */
export const DEFAULT_KIND_ALLOWED_ROLES: Readonly<Record<AssetKind, readonly RoleId[]>> = {
  requirement: [],
  design: [],
  code: [],
  'test-case': [],
  handoff: [],
}

/**
 * Validate one asset kind against the closed set.
 * @param kind - the asset kind to validate.
 * @throws UNKNOWN_ASSET_KIND when the kind is not registered.
 */
export function validateKind(kind: AssetKind): void {
  if (!KNOWN_ASSET_KINDS.includes(kind)) {
    throw new PlatformShellError('UNKNOWN_ASSET_KIND', `unknown asset kind ${kind}`)
  }
}

/**
 * Read the next global asset sequence, allocating one per call.
 * @param db - the SQLite database handle.
 * @returns the next unused asset sequence.
 */
export function nextAssetSequence(db: DatabaseSync): number {
  const rows = db.prepare(sql('select-asset-ids')).all() as { asset_id: string }[]
  let max = 0
  for (const entry of rows) {
    const suffix = entry.asset_id.slice(entry.asset_id.lastIndexOf('-') + 1)
    const parsed = Number.parseInt(suffix, 10)
    if (!Number.isNaN(parsed) && parsed > max) max = parsed
  }
  return max + 1
}

/**
 * Register one asset, assigning `<kind>-<seq>` and recording the produce role.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace the asset belongs to.
 * @param kind - the asset's kind.
 * @param content - the asset's content.
 * @param roleId - the role producing the asset.
 * @param now - the epoch-ms timestamp.
 * @returns the committed asset record.
 */
export function registerAsset(
  db: DatabaseSync,
  workspaceId: WorkspaceId,
  kind: AssetKind,
  content: string,
  roleId: RoleId,
  now: number,
): AssetRecord {
  validateKind(kind)
  if (content.length === 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'asset content must not be empty')
  }
  const id = AssetId(`${kind}-${nextAssetSequence(db)}`)
  db.prepare(sql('insert-asset')).run(id, kind, content, roleId, workspaceId, now)
  return { id, kind, content, roleId, workspaceId, createdAt: now }
}

/**
 * Read one asset, scoped to the caller's workspace.
 * @param db - the SQLite database handle.
 * @param assetId - the asset's branded id.
 * @param workspaceId - the workspace to scope the read to.
 * @returns the asset record, or `undefined` when absent or not in the workspace.
 */
export function getAsset(db: DatabaseSync, assetId: AssetId, workspaceId: WorkspaceId): AssetRecord | undefined {
  const row = db.prepare(sql('select-asset')).get(assetId)
  if (row === undefined) return undefined
  const asset = decodeAssetRow(row)
  return asset.workspaceId === workspaceId ? asset : undefined
}

/**
 * List all assets in one workspace, ordered by identity.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace to list.
 * @returns the workspace's asset records.
 */
export function listAssets(db: DatabaseSync, workspaceId: WorkspaceId): AssetRecord[] {
  const rows = db.prepare(sql('select-assets-by-workspace')).all(workspaceId)
  return rows.map(row => decodeAssetRow(row))
}

/**
 * Assert that one asset exists.
 * @param db - the SQLite database handle.
 * @param assetId - the asset's branded id.
 * @throws ASSET_NOT_FOUND when the asset does not exist.
 */
export function assertAssetExists(db: DatabaseSync, assetId: AssetId): void {
  if (db.prepare(sql('select-asset')).get(assetId) === undefined) {
    throw new PlatformShellError('ASSET_NOT_FOUND', `unknown asset ${assetId}`)
  }
}
