import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/schema.ts'
import { sql } from '../src/sql.ts'
import { getAsset, listAssets, nextAssetSequence, registerAsset, validateKind } from '../src/assets.ts'
import { insertUser, insertWorkspace, assignRole, upsertRole } from '../src/identity.ts'
import { AssetId, RoleId, UserId, WorkspaceId, type AssetKind } from '../src/types.ts'
import { expectPlatformError } from './expect-platform-error.ts'

async function freshDb(): Promise<DatabaseSync> {
  return openDatabase(DatabaseSync, ':memory:', 'wal', 1000)
}

function seed(db: DatabaseSync): { ws: WorkspaceId } {
  const ws = WorkspaceId('ws-1')
  db.exec(sql('begin-immediate'))
  insertUser(db, UserId('user-a'), 'A', 1)
  insertWorkspace(db, ws, 'Platform', false, 1)
  upsertRole(db, RoleId('product'), 'Product', ['asset.register'])
  assignRole(db, ws, UserId('user-a'), RoleId('product'))
  db.exec(sql('commit'))
  return { ws }
}

describe('asset store', () => {
  it('assigns deterministic kind-sequence identities', async () => {
    const db = await freshDb()
    try {
      const { ws } = seed(db)
      db.exec(sql('begin-immediate'))
      const first = registerAsset(db, ws, 'requirement', 'A requirement', RoleId('product'), 1)
      const second = registerAsset(db, ws, 'code', 'Some code', RoleId('dev'), 2)
      db.exec(sql('commit'))
      expect(first.id).toBe(AssetId('requirement-1'))
      expect(second.id).toBe(AssetId('code-2'))
    } finally {
      db.close()
    }
  })

  it('advances the global sequence across kinds', async () => {
    const db = await freshDb()
    try {
      const { ws } = seed(db)
      db.exec(sql('begin-immediate'))
      registerAsset(db, ws, 'requirement', 'A', RoleId('product'), 1)
      registerAsset(db, ws, 'design', 'B', RoleId('product'), 2)
      db.exec(sql('commit'))
      expect(nextAssetSequence(db)).toBe(3)
    } finally {
      db.close()
    }
  })

  it('rejects an unknown kind loudly', async () => {
    const db = await freshDb()
    try {
      expectPlatformError(() =>{  validateKind('mystery' as AssetKind) }, 'UNKNOWN_ASSET_KIND')
      expectPlatformError(
        () => registerAsset(db, WorkspaceId('ws-1'), 'mystery' as AssetKind, 'x', RoleId('product'), 1),
        'UNKNOWN_ASSET_KIND',
      )
    } finally {
      db.close()
    }
  })

  it('rejects empty content', async () => {
    const db = await freshDb()
    try {
      const { ws } = seed(db)
      db.exec(sql('begin-immediate'))
      expectPlatformError(() => registerAsset(db, ws, 'requirement', '', RoleId('product'), 1), 'INVALID_ARGUMENT')
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('reads one asset scoped to its workspace', async () => {
    const db = await freshDb()
    try {
      const { ws } = seed(db)
      db.exec(sql('begin-immediate'))
      const created = registerAsset(db, ws, 'requirement', 'R1', RoleId('product'), 1)
      db.exec(sql('commit'))
      const asset = getAsset(db, created.id, ws)
      expect(asset?.content).toBe('R1')
      // A different workspace cannot see it.
      expect(getAsset(db, created.id, WorkspaceId('ws-other'))).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('lists assets in one workspace', async () => {
    const db = await freshDb()
    try {
      const { ws } = seed(db)
      db.exec(sql('begin-immediate'))
      registerAsset(db, ws, 'requirement', 'R1', RoleId('product'), 1)
      registerAsset(db, ws, 'code', 'C1', RoleId('dev'), 2)
      db.exec(sql('commit'))
      expect(listAssets(db, ws)).toHaveLength(2)
      expect(listAssets(db, WorkspaceId('ws-empty'))).toEqual([])
    } finally {
      db.close()
    }
  })
})
