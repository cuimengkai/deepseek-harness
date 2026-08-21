/**
 * Platform lineage: a many-to-many derivation edge table and transitive
 * ancestor/descendant walks. Each edge records the producing role of its
 * descendant, which cross-role traces aggregate into a role chain
 * (lineage-bridge §3/§4).
 * @module @deepseek-ai/dsh-experimental-platform-shell/lineage
 */

import type { DatabaseSync } from 'node:sqlite'
import type { AssetId, LineageEdge, RoleId } from './types.ts'
import { PlatformShellError } from './error.ts'
import { decodeLineageRow } from './schema.ts'
import { sql } from './sql.ts'

/**
 * Record that one asset derives from another, with the producing role.
 * @param db - the SQLite database handle.
 * @param assetId - the derived asset's branded id.
 * @param parentId - the asset it derives from.
 * @param roleId - the role producing the derived asset.
 * @param now - the epoch-ms timestamp.
 */
export function linkAsset(
  db: DatabaseSync,
  assetId: AssetId,
  parentId: AssetId,
  roleId: RoleId,
  now: number,
): void {
  if (assetId === parentId) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'an asset cannot link to itself')
  }
  // Reject a cycle before the edge is written: adding `assetId -> parentId`
  // closes a loop whenever the parent already derives transitively from the
  // asset (the asset already reaches the parent as an ancestor).
  if (reaches(db, assetId, parentId)) {
    throw new PlatformShellError('INVALID_ARGUMENT', `linking ${assetId} to ${parentId} would create a cycle`)
  }
  db.prepare(sql('insert-lineage')).run(assetId, parentId, roleId, now)
}

/**
 * One edge's direct parents.
 * @param db - the SQLite database handle.
 * @param assetId - the asset's branded id.
 * @returns the direct parent edges.
 */
export function parents(db: DatabaseSync, assetId: AssetId): LineageEdge[] {
  const rows = db.prepare(sql('select-lineage-parents')).all(assetId)
  return rows.map(row => decodeLineageRow(row))
}

/**
 * One edge's direct children.
 * @param db - the SQLite database handle.
 * @param assetId - the asset's branded id.
 * @returns the direct child edges.
 */
export function children(db: DatabaseSync, assetId: AssetId): LineageEdge[] {
  const rows = db.prepare(sql('select-lineage-children')).all(assetId)
  return rows.map(row => decodeLineageRow(row))
}

/**
 * Walk all transitive ancestors toward the derivation source.
 * @param db - the SQLite database handle.
 * @param assetId - the asset's branded id.
 * @returns ancestor edges in derivation order.
 */
export function ancestors(db: DatabaseSync, assetId: AssetId): LineageEdge[] {
  const result: LineageEdge[] = []
  const seen = new Set<string>()
  const frontier = [assetId]
  while (frontier.length > 0) {
    const current = frontier.pop() as AssetId
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of parents(db, current)) {
      result.push(edge)
      frontier.push(edge.parentId)
    }
  }
  return result
}

/**
 * Walk all transitive descendants.
 * @param db - the SQLite database handle.
 * @param assetId - the asset's branded id.
 * @returns descendant edges in derivation order.
 */
export function descendants(db: DatabaseSync, assetId: AssetId): LineageEdge[] {
  const result: LineageEdge[] = []
  const seen = new Set<string>()
  const frontier = [assetId]
  while (frontier.length > 0) {
    const current = frontier.pop() as AssetId
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of children(db, current)) {
      result.push(edge)
      frontier.push(edge.assetId)
    }
  }
  return result
}

/** Whether `from` transitively reaches `to` through lineage edges. */
function reaches(db: DatabaseSync, from: AssetId, to: AssetId): boolean {
  const seen = new Set<string>()
  const frontier = [from]
  while (frontier.length > 0) {
    const current = frontier.pop() as AssetId
    if (current === to) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of children(db, current)) frontier.push(edge.assetId)
  }
  return false
}
