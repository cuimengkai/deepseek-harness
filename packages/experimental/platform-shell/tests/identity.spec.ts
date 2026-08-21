import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/schema.ts'
import { sql } from '../src/sql.ts'
import {
  assignRole,
  canAccessWorkspace,
  deleteUser,
  insertUser,
  insertWorkspace,
  membership,
  requirePermission,
  upsertRole,
} from '../src/identity.ts'
import { RoleId, UserId, WorkspaceId } from '../src/types.ts'
import { expectPlatformError } from './expect-platform-error.ts'
import { writeAudit } from '../src/audit.ts'

async function freshDb(): Promise<DatabaseSync> {
  return openDatabase(DatabaseSync, ':memory:', 'wal', 1000)
}

function seedUsersAndWorkspace(db: DatabaseSync): { alice: UserId; bob: UserId; ws: WorkspaceId } {
  const alice = UserId('user-alice')
  const bob = UserId('user-bob')
  const ws = WorkspaceId('ws-1')
  db.exec(sql('begin-immediate'))
  insertUser(db, alice, 'Alice', 1)
  insertUser(db, bob, 'Bob', 1)
  insertWorkspace(db, ws, 'Platform', 1)
  upsertRole(db, RoleId('product'), 'Product', ['asset.register', 'asset.read'])
  assignRole(db, ws, alice, RoleId('product'))
  db.exec(sql('commit'))
  return { alice, bob, ws }
}

describe('identity and RBAC', () => {
  it('resolves membership with the role permission set', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seedUsersAndWorkspace(db)
      const member = membership(db, alice, ws)
      expect(member?.roleId).toBe(RoleId('product'))
      expect(member?.permissions).toContain('asset.register')
    } finally {
      db.close()
    }
  })

  it('returns undefined membership for a non-member user', async () => {
    const db = await freshDb()
    try {
      const { bob, ws } = seedUsersAndWorkspace(db)
      expect(membership(db, bob, ws)).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('grants and denies workspace access', async () => {
    const db = await freshDb()
    try {
      const { alice, bob, ws } = seedUsersAndWorkspace(db)
      expect(canAccessWorkspace(db, alice, ws)).toBe(true)
      expect(canAccessWorkspace(db, bob, ws)).toBe(false)
    } finally {
      db.close()
    }
  })

  it('throws UNKNOWN_ACTOR for an unknown user in canAccessWorkspace', async () => {
    const db = await freshDb()
    try {
      const { ws } = seedUsersAndWorkspace(db)
      expectPlatformError(() => canAccessWorkspace(db, UserId('ghost'), ws), 'UNKNOWN_ACTOR')
    } finally {
      db.close()
    }
  })

  it('requirePermission passes for a role holding the permission', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seedUsersAndWorkspace(db)
      expect(() => requirePermission(db, alice, ws, 'asset.read')).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('requirePermission denies a role missing the permission', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seedUsersAndWorkspace(db)
      expectPlatformError(() => requirePermission(db, alice, ws, 'approval.release'), 'PERMISSION_DENIED')
    } finally {
      db.close()
    }
  })

  it('upsertRole merges permissions idempotently', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seedUsersAndWorkspace(db)
      db.exec(sql('begin-immediate'))
      upsertRole(db, RoleId('product'), 'Product', ['asset.register', 'audit.read'])
      db.exec(sql('commit'))
      expect(membership(db, alice, ws)?.permissions).toContain('audit.read')
    } finally {
      db.close()
    }
  })

  it('deleteUser removes the user and their audit remains readable', async () => {
    const db = await freshDb()
    try {
      const { alice, ws } = seedUsersAndWorkspace(db)
      db.exec(sql('begin-immediate'))
      writeAudit(db, { actorUserId: alice, workspaceId: ws, action: 'asset.register', targetKind: null, targetId: null, detail: null }, 1)
      deleteUser(db, alice)
      db.exec(sql('commit'))
      const rows = db.prepare(sql('select-user')).all(alice)
      expect(rows).toEqual([])
    } finally {
      db.close()
    }
  })
})
