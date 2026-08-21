/**
 * Platform business-approval state machine: draft → review → approved →
 * released, with rejected → draft reopen. Every transition appends one row to
 * the per-ticket transition log inside the same mutation transaction, and
 * approval grants the review scope (approval-state-machine §2/§4).
 * @module @deepseek-ai/dsh-experimental-platform-shell/approval
 */

import type { DatabaseSync } from 'node:sqlite'
import {
  TicketId,
  type ApprovalTicket,
  type ApprovalTransition,
  type AssetId,
  type AssetKind,
  type BusinessApprovalStatus,
  type ReviewScope,
  type UserId,
  type WorkspaceId,
} from './types.ts'
import { PlatformShellError } from './error.ts'
import { decodeTicketRow, decodeTransitionRow } from './schema.ts'
import { sql } from './sql.ts'

/** Transition edges permitted by the state machine. */
const TRANSITIONS: Readonly<Record<BusinessApprovalStatus, readonly BusinessApprovalStatus[]>> = {
  draft: ['review'],
  review: ['approved', 'rejected'],
  approved: ['released'],
  rejected: ['draft'],
  released: [],
}

/**
 * Create one ticket in `draft`, referencing a business asset.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace the subject asset belongs to.
 * @param subjectKind - the subject asset's kind.
 * @param subjectId - the subject asset's branded id.
 * @param actorUserId - the platform user creating the ticket.
 * @param now - the epoch-ms timestamp.
 * @param sequence - the ticket-local deterministic sequence.
 * @returns the committed draft ticket.
 */
export function createTicket(
  db: DatabaseSync,
  workspaceId: WorkspaceId,
  subjectKind: AssetKind,
  subjectId: AssetId,
  actorUserId: UserId,
  now: number,
  sequence: number,
): ApprovalTicket {
  const id = TicketId(`approval-${sequence}`)
  db.prepare(sql('insert-ticket')).run(
    id,
    workspaceId,
    subjectKind,
    subjectId,
    'draft',
    actorUserId,
    null,
    now,
    now,
  )
  recordTransition(db, id, null, 'draft', actorUserId, now)
  return {
    id,
    workspaceId,
    subjectKind,
    subjectId,
    status: 'draft',
    actorUserId,
    reviewScope: null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Move one ticket across an allowed edge, appending its transition row.
 * @param db - the SQLite database handle.
 * @param ticket - the ticket to move.
 * @param to - the target status.
 * @param actorUserId - the platform user authorizing the transition.
 * @param now - the epoch-ms timestamp.
 * @param scope - the review scope the `approved` edge requires, else omitted.
 * @returns the committed ticket.
 */
export function transitionTicket(
  db: DatabaseSync,
  ticket: ApprovalTicket,
  to: BusinessApprovalStatus,
  actorUserId: UserId,
  now: number,
  scope: ReviewScope | null = null,
): ApprovalTicket {
  if (!TRANSITIONS[ticket.status].includes(to)) {
    throw new PlatformShellError(
      'INVALID_TRANSITION',
      `cannot move ticket ${ticket.id} from ${ticket.status} to ${to}`,
    )
  }
  if (to === 'approved' && scope === null) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'approval must grant a review scope')
  }
  db.prepare(sql('update-ticket')).run(to, scope === null ? null : JSON.stringify(scope), now, ticket.id)
  recordTransition(db, ticket.id, ticket.status, to, actorUserId, now)
  return { ...ticket, status: to, reviewScope: scope, updatedAt: now }
}

/**
 * Read one ticket.
 * @param db - the SQLite database handle.
 * @param ticketId - the ticket's branded id.
 * @returns the ticket, or undefined when absent.
 */
export function getTicket(db: DatabaseSync, ticketId: TicketId): ApprovalTicket | undefined {
  const row = db.prepare(sql('select-ticket')).get(ticketId)
  return row === undefined ? undefined : decodeTicketRow(row)
}

/**
 * List tickets in one workspace.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace to list.
 * @returns the workspace's tickets.
 */
export function listTickets(db: DatabaseSync, workspaceId: WorkspaceId): ApprovalTicket[] {
  const rows = db.prepare(sql('select-tickets-by-workspace')).all(workspaceId)
  return rows.map(row => decodeTicketRow(row))
}

/**
 * Read one ticket's transition log in deterministic order.
 * @param db - the SQLite database handle.
 * @param ticketId - the ticket's branded id.
 * @returns the ticket's transition records.
 */
export function transitions(db: DatabaseSync, ticketId: TicketId): ApprovalTransition[] {
  const rows = db.prepare(sql('select-transitions')).all(ticketId)
  return rows.map(row => decodeTransitionRow(row))
}

/**
 * Assert that one ticket exists.
 * @param db - the SQLite database handle.
 * @param ticketId - the ticket's branded id.
 */
export function assertTicketExists(db: DatabaseSync, ticketId: TicketId): void {
  if (getTicket(db, ticketId) === undefined) {
    throw new PlatformShellError('TICKET_NOT_FOUND', `unknown ticket ${ticketId}`)
  }
}

/**
 * The next approval sequence derived from the stored ticket ids.
 * @param db - the SQLite database handle.
 * @returns the next unused approval sequence.
 */
export function nextTicketSequence(db: DatabaseSync): number {
  const rows = db.prepare(sql('select-ticket-ids')).all() as { ticket_id: string }[]
  let max = 0
  for (const entry of rows) {
    const suffix = entry.ticket_id.slice(entry.ticket_id.lastIndexOf('-') + 1)
    const parsed = Number.parseInt(suffix, 10)
    if (!Number.isNaN(parsed) && parsed > max) max = parsed
  }
  return max + 1
}

/** Append one transition row with the ticket-local deterministic sequence. */
function recordTransition(
  db: DatabaseSync,
  ticketId: TicketId,
  from: BusinessApprovalStatus | null,
  to: BusinessApprovalStatus,
  actorUserId: UserId,
  now: number,
): void {
  const existing = db.prepare(sql('select-transitions')).all(ticketId) as unknown[]
  const seq = existing.length + 1
  db.prepare(sql('insert-transition')).run(ticketId, seq, from, to, actorUserId, now)
}
