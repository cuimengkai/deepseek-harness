import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  PLATFORM_SHELL_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
  decodeAssetRow,
  decodeAuditRow,
  decodeLineageRow,
  decodeTicketRow,
  decodeTransitionRow,
  openDatabase,
  validateSchemaForMutation,
} from '../src/schema.ts'
import { sql } from '../src/sql.ts'
import { testSql } from './test-sql.ts'
import { AssetId, RoleId, UserId, WorkspaceId } from '../src/types.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function freshDbPath(prefix = 'platform-shell-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(directory)
  return join(directory, 'platform.db')
}

async function openMemory(path = ':memory:'): Promise<DatabaseSync> {
  return openDatabase(DatabaseSync, path, 'wal', 1000)
}

describe('openDatabase ownership', () => {
  it('initializes a fresh database with the platform application id and schema version', async () => {
    const db = await openMemory()
    try {
      const applicationId = db.prepare(sql('select-application-id')).get() as { application_id: number }
      const version = db.prepare(sql('select-user-version')).get() as { user_version: number }
      expect(applicationId.application_id).toBe(PLATFORM_SHELL_SQLITE_APPLICATION_ID)
      expect(version.user_version).toBe(SCHEMA_VERSION)
    } finally {
      db.close()
    }
  })

  it('rejects a foreign application id on an existing database', async () => {
    const path = await freshDbPath()
    const db = await openDatabase(DatabaseSync, path, 'wal', 1000)
    db.exec(sql('begin-immediate'))
    db.exec(testSql('corrupt-row-with-wrong-app-id'))
    db.exec(sql('commit'))
    db.close()
    await expect(openDatabase(DatabaseSync, path, 'wal', 1000)).rejects.toThrow(/incompatible|application id/)
  })

  it('rejects an incompatible schema version', async () => {
    const path = await freshDbPath()
    const db = await openDatabase(DatabaseSync, path, 'wal', 1000)
    db.exec(sql('begin-immediate'))
    db.exec(testSql('set-user-version-99'))
    db.exec(sql('commit'))
    db.close()
    await expect(openDatabase(DatabaseSync, path, 'wal', 1000)).rejects.toThrow(/schema version/)
  })

  it('rejects the previous v4 on-disk format', async () => {
    // The v4 format (pre-`capabilities.rows`) has no migration path per the
    // pre-release stance: opening it refuses at the version gate before any
    // schema-object check can run.
    const path = await freshDbPath()
    const db = await openDatabase(DatabaseSync, path, 'wal', 1000)
    db.exec(sql('begin-immediate'))
    db.exec(testSql('set-user-version-4'))
    db.exec(sql('commit'))
    db.close()
    await expect(openDatabase(DatabaseSync, path, 'wal', 1000)).rejects.toThrow(/schema version/)
  })

  it('rejects a database missing required schema objects', async () => {
    const path = await freshDbPath()
    const db = await openDatabase(DatabaseSync, path, 'wal', 1000)
    db.exec(sql('begin-immediate'))
    db.exec(testSql('create-unrelated-table'))
    db.exec(sql('commit'))
    db.close()
    await expect(openDatabase(DatabaseSync, path, 'wal', 1000)).rejects.toThrow(/required schema objects|changes before mutation/)
  })

  it('configures foreign-key enforcement, WAL journaling, and synchronous FULL', async () => {
    const db = await openMemory()
    try {
      // Insert a member with an unknown role; the foreign key must reject it.
      db.exec(sql('begin-immediate'))
      db.prepare(sql('insert-user')).run('u-1', 'Alice', 1)
      db.prepare(sql('insert-workspace')).run('w-1', 'Platform', 0, 1)
      expect(() => db.prepare(sql('insert-member')).run('w-1', 'u-1', 'missing-role')).toThrow()
      db.exec(sql('rollback'))
      const journal = db.prepare(sql('select-journal-mode')).get() as { journal_mode: string }
      const synchronous = db.prepare(sql('select-synchronous')).get() as { synchronous: number }
      expect(journal.journal_mode).toBe('memory')
      expect(synchronous.synchronous).toBe(2)
    } finally {
      db.close()
    }
  })
})

describe('validateSchemaForMutation', () => {
  it('accepts an unchanged owned database inside the caller mutation transaction', async () => {
    const db = await openMemory()
    try {
      db.exec(sql('begin-immediate'))
      expect(() =>{  validateSchemaForMutation(DatabaseSync, db, ':memory:') }).not.toThrow()
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('rejects a changed application id before commit', async () => {
    const db = await openMemory()
    try {
      db.exec(sql('begin-immediate'))
      db.exec(testSql('corrupt-row-with-wrong-app-id'))
      expect(() =>{  validateSchemaForMutation(DatabaseSync, db, ':memory:') }).toThrow(/application id/)
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('rejects a changed schema version before commit', async () => {
    const db = await openMemory()
    try {
      db.exec(sql('begin-immediate'))
      db.exec(testSql('set-user-version-99'))
      expect(() =>{  validateSchemaForMutation(DatabaseSync, db, ':memory:') }).toThrow(/schema/)
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })

  it('rejects a schema-object change before commit', async () => {
    const db = await openMemory()
    try {
      db.exec(sql('begin-immediate'))
      db.exec(testSql('add-unexpected-column'))
      expect(() =>{  validateSchemaForMutation(DatabaseSync, db, ':memory:') }).toThrow(/schema/)
      db.exec(sql('rollback'))
    } finally {
      db.close()
    }
  })
})

describe('row decoders', () => {
  it('decodes a validated asset row', () => {
    const asset = decodeAssetRow({
      asset_id: 'requirement-1',
      kind: 'requirement',
      content: 'A requirement',
      role_id: 'product',
      workspace_id: 'ws-1',
      created_at: 1,
    })
    expect(asset).toEqual({
      id: AssetId('requirement-1'),
      kind: 'requirement',
      content: 'A requirement',
      roleId: RoleId('product'),
      workspaceId: WorkspaceId('ws-1'),
      createdAt: 1,
    })
  })

  it('rejects an unknown stored asset kind', () => {
    expect(() => decodeAssetRow({
      asset_id: 'requirement-1',
      kind: 'mystery',
      content: 'x',
      role_id: 'product',
      workspace_id: 'ws-1',
      created_at: 1,
    })).toThrow(/not a known kind/)
  })

  it('decodes a validated lineage row', () => {
    const edge = decodeLineageRow({
      asset_id: 'code-2',
      parent_id: 'requirement-1',
      role_id: 'dev',
      created_at: 1,
    })
    expect(edge.parentId).toBe(AssetId('requirement-1'))
    expect(edge.roleId).toBe(RoleId('dev'))
  })

  it('decodes a validated ticket row with a review scope', () => {
    const ticket = decodeTicketRow({
      ticket_id: 'approval-1',
      workspace_id: 'ws-1',
      subject_kind: 'requirement',
      subject_id: 'requirement-1',
      status: 'review',
      actor_user_id: 'u-1',
      review_scope: JSON.stringify({ roles: ['product'], workspace: 'ws-1', expiresAt: 5 }),
      created_at: 1,
      updated_at: 2,
    })
    expect(ticket.status).toBe('review')
    expect(ticket.reviewScope?.roles).toEqual([RoleId('product')])
  })

  it('rejects an invalid stored review scope JSON', () => {
    expect(() => decodeTicketRow({
      ticket_id: 'approval-1',
      workspace_id: 'ws-1',
      subject_kind: 'requirement',
      subject_id: 'requirement-1',
      status: 'review',
      actor_user_id: 'u-1',
      review_scope: 'not json',
      created_at: 1,
      updated_at: 2,
    })).toThrow(/review_scope/)
  })

  it('decodes a validated transition row', () => {
    const transition = decodeTransitionRow({
      ticket_id: 'approval-1',
      seq: 1,
      from_status: 'draft',
      to_status: 'review',
      actor_user_id: 'u-1',
      created_at: 1,
    })
    expect(transition.from).toBe('draft')
    expect(transition.to).toBe('review')
  })

  it('decodes a validated audit row', () => {
    const audit = decodeAuditRow({
      event_id: 7,
      actor_user_id: 'u-1',
      workspace_id: 'ws-1',
      action: 'asset.register',
      target_kind: 'asset',
      target_id: 'requirement-1',
      detail: null,
      created_at: 1,
    })
    expect(audit.action).toBe('asset.register')
    expect(audit.actorUserId).toBe(UserId('u-1'))
  })
})

describe('journal mode selection', () => {
  it('retries a busy database until the deadline then surfaces the error', async () => {
    const path = await freshDbPath()
    const owner = await openDatabase(DatabaseSync, path, 'wal', 1000)
    try {
      owner.exec(sql('begin-immediate'))
      // A second connection trying to switch the journal mode competes for the lock.
      const second = new DatabaseSync(path, { timeout: 1000 })
      try {
        await expect(openDatabase(DatabaseSync, path, 'delete', 200)).rejects.toThrow(/journal mode|busy|locked/)
      } finally {
        second.close()
      }
    } finally {
      owner.close()
    }
  })
})
