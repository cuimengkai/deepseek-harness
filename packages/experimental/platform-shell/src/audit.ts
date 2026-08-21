/**
 * Platform audit log: every mutation writes one audit row inside the same
 * begin-immediate transaction that performs the mutation, and reads filter by
 * workspace and action. The log is the authoritative record for platform
 * activity, independent of the dsh session log.
 * @module @deepseek-ai/dsh-experimental-platform-shell/audit
 */

import type { DatabaseSync } from 'node:sqlite'
import type { AuditEvent, AuditEventId, UserId, WorkspaceId } from './types.ts'
import { decodeAuditRow } from './schema.ts'
import { sql } from './sql.ts'

/** One row written to the audit log. */
export interface AuditWrite {
  readonly actorUserId: UserId
  readonly workspaceId: WorkspaceId | null
  readonly action: string
  readonly targetKind: string | null
  readonly targetId: string | null
  readonly detail: string | null
}

/**
 * Write one audit row inside the caller's mutation transaction.
 * @param db - the SQLite database handle.
 * @param entry - the audit row to write.
 * @param now - the epoch-ms timestamp.
 */
export function writeAudit(db: DatabaseSync, entry: AuditWrite, now: number): void {
  db.prepare(sql('insert-audit')).run(
    entry.actorUserId,
    entry.workspaceId,
    entry.action,
    entry.targetKind,
    entry.targetId,
    entry.detail,
    now,
  )
}

/**
 * List audit rows, optionally filtered by workspace and action.
 * @param db - the SQLite database handle.
 * @param filter - optional workspace and action filters.
 * @returns the matching audit events.
 */
export function listAudit(
  db: DatabaseSync,
  filter: { readonly workspaceId?: WorkspaceId; readonly action?: string } = {},
): AuditEvent[] {
  const { workspaceId, action } = filter
  const rows = workspaceId !== undefined && action !== undefined
    ? db.prepare(sql('select-audit-by-workspace-action')).all(workspaceId, action)
    : workspaceId !== undefined
      ? db.prepare(sql('select-audit-by-workspace')).all(workspaceId)
      : action !== undefined
        ? db.prepare(sql('select-audit-by-action')).all(action)
        : db.prepare(sql('select-audit')).all()
  return rows.map(row => decodeAuditRow(row))
}

/**
 * Read one audit row by its event identity.
 * @param db - the SQLite database handle.
 * @param id - the event's branded id.
 * @returns the audit event, or undefined when absent.
 */
export function getAudit(db: DatabaseSync, id: AuditEventId): AuditEvent | undefined {
  const rows = db.prepare(sql('select-audit')).all() as unknown
  for (const row of rows as { event_id: number }[]) {
    if (String(row.event_id) === id) return decodeAuditRow(row)
  }
  return undefined
}
