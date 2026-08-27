import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/schema.ts'
import { sql } from '../src/sql.ts'
import { ancestors, children, descendants, linkAsset, parents } from '../src/lineage.ts'
import { registerAsset } from '../src/assets.ts'
import { insertUser, insertWorkspace, upsertRole, assignRole } from '../src/identity.ts'
import { AssetId, RoleId, UserId, WorkspaceId } from '../src/types.ts'
import { expectPlatformError } from './expect-platform-error.ts'

async function freshDb(): Promise<DatabaseSync> {
  return openDatabase(DatabaseSync, ':memory:', 'wal', 1000)
}

function seedChain(db: DatabaseSync): { req: AssetId; code: AssetId; test: AssetId } {
  const ws = WorkspaceId('ws-1')
  db.exec(sql('begin-immediate'))
  insertUser(db, UserId('user-a'), 'A', 1)
  insertWorkspace(db, ws, 'Platform', false, 1)
  upsertRole(db, RoleId('product'), 'Product', ['asset.register'])
  assignRole(db, ws, UserId('user-a'), RoleId('product'))
  const req = registerAsset(db, ws, 'requirement', 'R1', RoleId('product'), 1).id
  const code = registerAsset(db, ws, 'code', 'C1', RoleId('dev'), 2).id
  const test = registerAsset(db, ws, 'test-case', 'T1', RoleId('qa'), 3).id
  linkAsset(db, code, req, RoleId('dev'), 4)
  linkAsset(db, test, code, RoleId('qa'), 5)
  db.exec(sql('commit'))
  return { req, code, test }
}

describe('lineage', () => {
  it('records derivation edges and walks transitive ancestors', async () => {
    const db = await freshDb()
    try {
      const { req, code, test } = seedChain(db)
      expect(parents(db, code).map(e => e.parentId)).toEqual([req])
      const all = ancestors(db, test)
      expect(all.map(e => e.parentId)).toContain(req)
      expect(all.map(e => e.assetId)).toContain(code)
    } finally {
      db.close()
    }
  })

  it('walks transitive descendants', async () => {
    const db = await freshDb()
    try {
      const { req, test } = seedChain(db)
      const all = descendants(db, req)
      expect(all.map(e => e.assetId)).toContain(test)
      expect(all).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('rejects a self-edge', async () => {
    const db = await freshDb()
    try {
      const { req } = seedChain(db)
      db.exec(sql('begin-immediate'))
      expectPlatformError(() =>{  linkAsset(db, req, req, RoleId('product'), 1) }, 'INVALID_ARGUMENT')
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('rejects a cycle', async () => {
    const db = await freshDb()
    try {
      const { req, code } = seedChain(db)
      db.exec(sql('begin-immediate'))
      expectPlatformError(() =>{  linkAsset(db, req, code, RoleId('product'), 1) }, 'INVALID_ARGUMENT')
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('supports multiple parents (many-to-many)', async () => {
    const db = await freshDb()
    try {
      const { req, code } = seedChain(db)
      db.exec(sql('begin-immediate'))
      const design = registerAsset(db, WorkspaceId('ws-1'), 'design', 'D1', RoleId('product'), 6).id
      linkAsset(db, code, design, RoleId('dev'), 7)
      db.exec(sql('commit'))
      expect(parents(db, code)).toHaveLength(2)
      const all = ancestors(db, code)
      expect(all.map(e => e.parentId)).toContain(req)
      expect(all.map(e => e.parentId)).toContain(design)
    } finally {
      db.close()
    }
  })

  it('direct children lists edges where the asset is the parent', async () => {
    const db = await freshDb()
    try {
      const { req, code, test } = seedChain(db)
      expect(children(db, req).map(e => e.assetId)).toEqual([code])
      expect(children(db, code).map(e => e.assetId)).toEqual([test])
      expect(children(db, test)).toEqual([])
    } finally {
      db.close()
    }
  })

  it('is reachable across roles', async () => {
    const db = await freshDb()
    try {
      const { test } = seedChain(db)
      const roles = ancestors(db, test).map(e => e.roleId)
      expect(roles).toContain(RoleId('dev'))
      expect(roles).toContain(RoleId('qa'))
    } finally {
      db.close()
    }
  })

  it('rejects a lineage edge referencing a missing asset via FK cascade', async () => {
    const db = await freshDb()
    try {
      const { req } = seedChain(db)
      db.exec(sql('begin-immediate'))
      expect(() =>{  linkAsset(db, AssetId('ghost'), req, RoleId('dev'), 1) }).toThrow()
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })
})
