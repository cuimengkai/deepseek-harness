import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/schema.ts'
import { sql } from '../src/sql.ts'
import {
  createTicket,
  getTicket,
  listTickets,
  nextTicketSequence,
  transitionTicket,
  transitions,
} from '../src/approval.ts'
import { insertUser, insertWorkspace, upsertRole, assignRole } from '../src/identity.ts'
import { registerAsset } from '../src/assets.ts'
import { AssetId, RoleId, TicketId, UserId, WorkspaceId } from '../src/types.ts'
import { expectPlatformError } from './expect-platform-error.ts'

async function freshDb(): Promise<DatabaseSync> {
  return openDatabase(DatabaseSync, ':memory:', 'wal', 1000)
}

/** Seed a workspace with one product-owned requirement asset and one user. */
function seedWorkspace(db: DatabaseSync): { ws: WorkspaceId; asset: AssetId } {
  const ws = WorkspaceId('ws-1')
  db.exec(sql('begin-immediate'))
  insertUser(db, UserId('user-p'), 'Producer', 1)
  insertWorkspace(db, ws, 'Platform', 1)
  upsertRole(db, RoleId('product'), 'Product', ['asset.register', 'approval.review'])
  assignRole(db, ws, UserId('user-p'), RoleId('product'))
  const asset = registerAsset(db, ws, 'requirement', 'R1', RoleId('product'), 1).id
  db.exec(sql('commit'))
  return { ws, asset }
}

const scope = { roles: [RoleId('product')], workspace: WorkspaceId('ws-1'), expiresAt: 99 }

describe('approval state machine', () => {
  it('starts a ticket in draft with one transition row', async () => {
    const db = await freshDb()
    try {
      const { ws, asset } = seedWorkspace(db)
      db.exec(sql('begin-immediate'))
      const ticket = createTicket(db, ws, 'requirement', asset, UserId('user-p'), 1, nextTicketSequence(db))
      db.exec(sql('commit'))
      expect(ticket.status).toBe('draft')
      expect(ticket.reviewScope).toBeNull()
      expect(getTicket(db, ticket.id)?.status).toBe('draft')
      const log = transitions(db, ticket.id)
      expect(log.map(t => t.to)).toEqual(['draft'])
    } finally {
      db.close()
    }
  })

  it('walks the full lifecycle to released', async () => {
    const db = await freshDb()
    try {
      const { ws, asset } = seedWorkspace(db)
      db.exec(sql('begin-immediate'))
      const created = createTicket(db, ws, 'requirement', asset, UserId('user-p'), 1, nextTicketSequence(db))
      const reviewed = transitionTicket(db, created, 'review', UserId('user-p'), 2)
      const approved = transitionTicket(db, reviewed, 'approved', UserId('user-p'), 3, scope)
      const released = transitionTicket(db, approved, 'released', UserId('user-p'), 4)
      db.exec(sql('commit'))
      expect(released.status).toBe('released')
      expect(approved.reviewScope).toEqual(scope)
      expect(transitions(db, released.id).map(t => `${t.from}→${t.to}`)).toEqual([
        'null→draft',
        'draft→review',
        'review→approved',
        'approved→released',
      ])
    } finally {
      db.close()
    }
  })

  it('rejects a disallowed transition', async () => {
    const db = await freshDb()
    try {
      const { ws, asset } = seedWorkspace(db)
      db.exec(sql('begin-immediate'))
      const created = createTicket(db, ws, 'requirement', asset, UserId('user-p'), 1, nextTicketSequence(db))
      expectPlatformError(() => transitionTicket(db, created, 'released', UserId('user-p'), 2), 'INVALID_TRANSITION')
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('requires a review scope when approving', async () => {
    const db = await freshDb()
    try {
      const { ws, asset } = seedWorkspace(db)
      db.exec(sql('begin-immediate'))
      const created = createTicket(db, ws, 'requirement', asset, UserId('user-p'), 1, nextTicketSequence(db))
      const reviewed = transitionTicket(db, created, 'review', UserId('user-p'), 2)
      expectPlatformError(() => transitionTicket(db, reviewed, 'approved', UserId('user-p'), 3), 'INVALID_ARGUMENT')
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('reopens a rejected ticket back to draft', async () => {
    const db = await freshDb()
    try {
      const { ws, asset } = seedWorkspace(db)
      db.exec(sql('begin-immediate'))
      const created = createTicket(db, ws, 'requirement', asset, UserId('user-p'), 1, nextTicketSequence(db))
      const reviewed = transitionTicket(db, created, 'review', UserId('user-p'), 2)
      const rejected = transitionTicket(db, reviewed, 'rejected', UserId('user-p'), 3)
      const reopened = transitionTicket(db, rejected, 'draft', UserId('user-p'), 4)
      db.exec(sql('commit'))
      expect(reopened.status).toBe('draft')
    } finally {
      db.close()
    }
  })

  it('advances ticket sequences across tickets', async () => {
    const db = await freshDb()
    try {
      const { ws, asset } = seedWorkspace(db)
      db.exec(sql('begin-immediate'))
      createTicket(db, ws, 'requirement', asset, UserId('user-p'), 1, nextTicketSequence(db))
      expect(nextTicketSequence(db)).toBe(2)
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('lists tickets in one workspace and reads one ticket', async () => {
    const db = await freshDb()
    try {
      const { ws, asset } = seedWorkspace(db)
      db.exec(sql('begin-immediate'))
      const ticket = createTicket(db, ws, 'requirement', asset, UserId('user-p'), 1, nextTicketSequence(db))
      db.exec(sql('commit'))
      expect(listTickets(db, ws).map(t => t.id)).toEqual([ticket.id])
      expect(listTickets(db, WorkspaceId('ws-empty'))).toEqual([])
      expect(getTicket(db, ticket.id)?.id).toBe(ticket.id)
      expect(getTicket(db, TicketId('approval-999'))).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
