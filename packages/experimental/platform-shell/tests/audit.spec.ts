import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/schema.ts'
import { sql } from '../src/sql.ts'
import { getAudit, listAudit, writeAudit } from '../src/audit.ts'
import { insertUser, insertWorkspace, upsertRole, assignRole } from '../src/identity.ts'
import { registerAsset } from '../src/assets.ts'
import { RoleId, UserId, WorkspaceId } from '../src/types.ts'

async function freshDb(): Promise<DatabaseSync> {
  return openDatabase(DatabaseSync, ':memory:', 'wal', 1000)
}

function seed(db: DatabaseSync): { alice: UserId; ws: WorkspaceId } {
  const alice = UserId('user-a')
  const ws = WorkspaceId('ws-1')
  db.exec(sql('begin-immediate'))
  insertUser(db, alice, 'Alice', 1)
  insertWorkspace(db, ws, 'Platform', false, 1)
  upsertRole(db, RoleId('product'), 'Product', ['asset.register'])
  assignRole(db, ws, alice, RoleId('product'))
  db.exec(sql('commit'))
  return { alice, ws }
}

describe('audit log', () => {
  it('writes an audit row inside the caller mutation transaction', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seed(db)
      db.exec(sql('begin-immediate'))
      writeAudit(db, { actorUserId: alice, workspaceId: ws, action: 'asset.register', targetKind: 'asset', targetId: 'requirement-1', detail: null }, 1)
      db.exec(sql('commit'))
      const rows = listAudit(db)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('asset.register')
      expect(rows[0]?.actorUserId).toBe(alice)
    } finally {
      db.close()
    }
  })

  it('rolls back the audit row with the mutation', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seed(db)
      db.exec(sql('begin-immediate'))
      writeAudit(db, { actorUserId: alice, workspaceId: ws, action: 'asset.register', targetKind: null, targetId: null, detail: null }, 1)
      db.exec(sql('rollback'))
      expect(listAudit(db)).toEqual([])
    } finally {
      db.close()
    }
  })

  it('filters by workspace, action, or both', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seed(db)
      const other = WorkspaceId('ws-2')
      db.exec(sql('begin-immediate'))
      insertWorkspace(db, other, 'Other', false, 2)
      writeAudit(db, { actorUserId: alice, workspaceId: ws, action: 'asset.register', targetKind: 'asset', targetId: 'requirement-1', detail: null }, 3)
      writeAudit(db, { actorUserId: alice, workspaceId: ws, action: 'asset.read', targetKind: 'asset', targetId: 'requirement-1', detail: null }, 4)
      writeAudit(db, { actorUserId: alice, workspaceId: other, action: 'asset.register', targetKind: 'asset', targetId: 'requirement-2', detail: null }, 5)
      db.exec(sql('commit'))
      expect(listAudit(db, { workspaceId: ws })).toHaveLength(2)
      expect(listAudit(db, { action: 'asset.read' })).toHaveLength(1)
      expect(listAudit(db, { workspaceId: ws, action: 'asset.register' })).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('reads one audit row by its event identity', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seed(db)
      db.exec(sql('begin-immediate'))
      writeAudit(db, { actorUserId: alice, workspaceId: ws, action: 'asset.register', targetKind: 'asset', targetId: 'requirement-1', detail: null }, 1)
      db.exec(sql('commit'))
      const written = listAudit(db)[0]!
      expect(getAudit(db, written.id)?.action).toBe('asset.register')
      expect(getAudit(db, 'event-does-not-exist' as never)).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('persists the audit row for an asset registration end to end', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seed(db)
      db.exec(sql('begin-immediate'))
      registerAsset(db, ws, 'requirement', 'R1', RoleId('product'), 1)
      writeAudit(db, { actorUserId: alice, workspaceId: ws, action: 'asset.register', targetKind: 'asset', targetId: 'requirement-1', detail: JSON.stringify({ kind: 'requirement' }) }, 1)
      db.exec(sql('commit'))
      const row = listAudit(db, { action: 'asset.register' })[0]!
      expect(row.targetId).toBe('requirement-1')
      expect(JSON.parse(row.detail as string).kind).toBe('requirement')
    } finally {
      db.close()
    }
  })
})
