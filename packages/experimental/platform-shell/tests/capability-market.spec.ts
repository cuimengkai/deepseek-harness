import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/schema.ts'
import { sql } from '../src/sql.ts'
import { insertWorkspace } from '../src/identity.ts'
import {
  accrueSettlement,
  assertGateOpen,
  capabilityOwningTool,
  creditAccount,
  debitAccount,
  deleteCapability,
  dependenciesOf,
  ensureOpenSettlement,
  getAccount,
  getCapability,
  getScenario,
  getSettlement,
  insertCapability,
  insertCapabilityConflict,
  insertCapabilityDependency,
  insertScenario,
  insertScenarioCapability,
  insertUsage,
  listCapabilities,
  listScenarios,
  listSettlements,
  listUsage,
  loadCatalog,
  requireAccount,
  resolveSelection,
  scenarioCapabilityIds,
  settleSettlement,
  setCapabilityGate,
  versionSatisfies,
} from '../src/capability-market.ts'
import type { CatalogSnapshot } from '../src/capability-market.ts'
import type { CapabilityRecord, PublishCapabilityRequest } from '../src/types.ts'
import { CapabilityId, RoleId, ScenarioId, WorkspaceId } from '../src/types.ts'
import { expectPlatformError } from './expect-platform-error.ts'

async function freshDb(): Promise<DatabaseSync> {
  return openDatabase(DatabaseSync, ':memory:', 'wal', 1000)
}

const ws = WorkspaceId('ws-1')
const now = 1_700_000_000_000

/** Seed the workspace the billing ledger references. */
function seedWorkspace(db: DatabaseSync): void {
  db.exec(sql('begin-immediate'))
  insertWorkspace(db, ws, 'Platform', false, now)
  db.exec(sql('commit'))
}

/** Insert one catalog entry plus its edges, returning the committed entry. */
function publish(
  db: DatabaseSync,
  id: string,
  request: Partial<PublishCapabilityRequest> = {},
): ReturnType<typeof insertCapability> {
  const capability = insertCapability(db, {
    id: CapabilityId(id),
    name: id,
    roleId: RoleId('product'),
    execution: 'managed',
    version: '1.0.0',
    rate: 1,
    ...request,
  }, now)
  for (const dependency of request.dependencies ?? []) {
    insertCapabilityDependency(db, capability.id, dependency.id, dependency.range ?? null, now)
  }
  for (const conflict of request.conflictsWith ?? []) {
    insertCapabilityConflict(db, capability.id, conflict, now)
  }
  return capability
}

describe('capability catalog', () => {
  it('publishes an entry with defaults and reads it back', async () => {
    const db = await freshDb()
    try {
      const published = publish(db, 'requirement-management')
      expect(published.enabled).toBe(true)
      expect(published.rollout).toBe(1)
      expect(published.description).toBe('')
      expect(getCapability(db, CapabilityId('requirement-management'))).toEqual(published)
      expect(listCapabilities(db).map(c => c.id)).toEqual([CapabilityId('requirement-management')])
      expect(getCapability(db, CapabilityId('code-gen'))).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('persists the execution gate', async () => {
    const db = await freshDb()
    try {
      publish(db, 'requirement-management')
      const gated = setCapabilityGate(db, CapabilityId('requirement-management'), false, 0.5)
      expect(gated.enabled).toBe(false)
      expect(gated.rollout).toBe(0.5)
      expect(getCapability(db, CapabilityId('requirement-management'))).toMatchObject({ enabled: false, rollout: 0.5 })
    } finally {
      db.close()
    }
  })

  it('persists the governed tool surface and resolves an owning capability freshly', async () => {
    const db = await freshDb()
    try {
      const published = publish(db, 'code-analysis', { tools: ['analyze_code', 'scan_metrics'] })
      expect(published.tools).toEqual(['analyze_code', 'scan_metrics'])
      expect(getCapability(db, CapabilityId('code-analysis'))).toEqual(published)
      expect(listCapabilities(db)[0]?.tools).toEqual(['analyze_code', 'scan_metrics'])
      // The enforcement-path read joins the live gate row, so a gate flip is
      // observed on the next call — never a stale snapshot. The record's tools
      // carries the matched tool (the gate path reads only the gate fields).
      const owner = capabilityOwningTool(db, 'analyze_code') as CapabilityRecord
      expect(owner.id).toEqual(CapabilityId('code-analysis'))
      expect(owner.tools).toEqual(['analyze_code'])
      setCapabilityGate(db, CapabilityId('code-analysis'), false, 1)
      expect(capabilityOwningTool(db, 'analyze_code')?.enabled).toBe(false)
      expect(capabilityOwningTool(db, 'unowned_tool')).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('deletes an entry and cascades its own edges', async () => {
    const db = await freshDb()
    try {
      publish(db, 'base', { version: '1.0.0' })
      publish(db, 'derived', { dependencies: [{ id: CapabilityId('base'), range: '>=1.0.0' }] })
      expect(dependenciesOf(db, CapabilityId('derived'))).toHaveLength(1)
      deleteCapability(db, CapabilityId('derived'))
      expect(getCapability(db, CapabilityId('derived'))).toBeUndefined()
      expect(dependenciesOf(db, CapabilityId('derived'))).toEqual([])
    } finally {
      db.close()
    }
  })
})

describe('version ranges', () => {
  it('satisfies =, >, >=, <, <= against dotted versions', () => {
    expect(versionSatisfies('1.2.3', '1.2.3')).toBe(true)
    expect(versionSatisfies('1.2.3', '1.2.4')).toBe(false)
    expect(versionSatisfies('1.3.0', '>1.2.3')).toBe(true)
    expect(versionSatisfies('1.2.3', '>=1.2.3')).toBe(true)
    expect(versionSatisfies('1.2.2', '>=1.2.3')).toBe(false)
    expect(versionSatisfies('1.2.0', '<1.2.3')).toBe(true)
    expect(versionSatisfies('1.2.3', '<=1.2.3')).toBe(true)
  })
})

describe('capability resolution', () => {
  it('resolves transitive dependencies in a deterministic order', async () => {
    const db = await freshDb()
    try {
      publish(db, 'base-llm', { version: '2.0.0' })
      publish(db, 'rag', { dependencies: [{ id: CapabilityId('base-llm'), range: '>=2.0.0' }] })
      publish(db, 'product-answer', { dependencies: [{ id: CapabilityId('rag') }] })
      const resolved = resolveSelection(loadCatalog(db), ws, [CapabilityId('product-answer')])
      expect(resolved.map(c => c.id)).toEqual([CapabilityId('base-llm'), CapabilityId('rag'), CapabilityId('product-answer')])
    } finally {
      db.close()
    }
  })

  it('rejects a repeated id', async () => {
    const db = await freshDb()
    try {
      publish(db, 'base-llm')
      expectPlatformError(
        () => resolveSelection(loadCatalog(db), ws, [CapabilityId('base-llm'), CapabilityId('base-llm')]),
        'INVALID_ARGUMENT',
      )
    } finally {
      db.close()
    }
  })

  it('rejects an unknown selected capability', async () => {
    const db = await freshDb()
    try {
      expectPlatformError(
        () => resolveSelection(loadCatalog(db), ws, [CapabilityId('ghost')]),
        'CAPABILITY_NOT_FOUND',
      )
    } finally {
      db.close()
    }
  })

  it('rejects a dependency on an unpublished capability', async () => {
    const db = await freshDb()
    try {
      // The store's FK rejects a broken edge at insert, so exercise the pure
      // resolution with a hand-built snapshot whose dependency target is absent.
      publish(db, 'broken')
      const catalog: CatalogSnapshot = {
        capabilities: new Map([[CapabilityId('broken'), getCapability(db, CapabilityId('broken'))!]]),
        dependencies: new Map([[CapabilityId('broken'), [{ id: CapabilityId('ghost-dep'), range: null }]]]),
        conflicts: new Map(),
      }
      expectPlatformError(
        () => resolveSelection(catalog, ws, [CapabilityId('broken')]),
        'CAPABILITY_DEPENDENCY_MISSING',
      )
    } finally {
      db.close()
    }
  })

  it('rejects a version-range mismatch on a dependency', async () => {
    const db = await freshDb()
    try {
      publish(db, 'base-llm', { version: '1.0.0' })
      publish(db, 'rag', { dependencies: [{ id: CapabilityId('base-llm'), range: '>=2.0.0' }] })
      expectPlatformError(
        () => resolveSelection(loadCatalog(db), ws, [CapabilityId('rag')]),
        'VERSION_MISMATCH',
      )
    } finally {
      db.close()
    }
  })

  it('rejects a conflicting pair', async () => {
    const db = await freshDb()
    try {
      publish(db, 'sql-db')
      publish(db, 'vector-db', { conflictsWith: [CapabilityId('sql-db')] })
      expectPlatformError(
        () => resolveSelection(loadCatalog(db), ws, [CapabilityId('sql-db'), CapabilityId('vector-db')]),
        'CAPABILITY_CONFLICT',
      )
      // A single side of the pair resolves fine.
      const resolved = resolveSelection(loadCatalog(db), ws, [CapabilityId('vector-db')])
      expect(resolved.map(c => c.id)).toEqual([CapabilityId('vector-db')])
    } finally {
      db.close()
    }
  })

  it('refuses a disabled capability loudly', async () => {
    const db = await freshDb()
    try {
      const published = publish(db, 'legacy')
      setCapabilityGate(db, published.id, false, 1)
      expectPlatformError(
        () => resolveSelection(loadCatalog(db), ws, [published.id]),
        'CAPABILITY_DISABLED',
      )
      expect(() => assertGateOpen(getCapability(db, published.id)!, ws)).toThrow()
    } finally {
      db.close()
    }
  })

  it('refuses a rollout-excluded workspace while a full rollout admits it', async () => {
    const db = await freshDb()
    try {
      const published = publish(db, 'canary')
      // rollout 0 excludes every workspace deterministically.
      setCapabilityGate(db, published.id, true, 0)
      expectPlatformError(
        () => resolveSelection(loadCatalog(db), ws, [published.id]),
        'CAPABILITY_DISABLED',
      )
      // rollout 1 admits every workspace deterministically (fraction < 1).
      setCapabilityGate(db, published.id, true, 1)
      expect(resolveSelection(loadCatalog(db), ws, [published.id])).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('rejects a dependency cycle', async () => {
    const db = await freshDb()
    try {
      // Publish both sides first (the FK rejects a forward edge), then close the cycle.
      publish(db, 'a')
      publish(db, 'b')
      insertCapabilityDependency(db, CapabilityId('a'), CapabilityId('b'), null, now)
      insertCapabilityDependency(db, CapabilityId('b'), CapabilityId('a'), null, now)
      expectPlatformError(
        () => resolveSelection(loadCatalog(db), ws, [CapabilityId('a')]),
        'INVALID_ARGUMENT',
      )
    } finally {
      db.close()
    }
  })
})

describe('scenario workbench bundles', () => {
  it('registers a bundle and composes its capability set', async () => {
    const db = await freshDb()
    try {
      publish(db, 'requirement-management')
      publish(db, 'code-gen')
      insertScenario(db, {
        id: ScenarioId('product-engineering'),
        name: 'Product Engineering',
        workbenchId: 'product-engineering',
        roleId: RoleId('product'),
        preset: 'product-engineering',
        capabilityIds: [CapabilityId('requirement-management'), CapabilityId('code-gen')],
      }, now)
      insertScenarioCapability(db, ScenarioId('product-engineering'), CapabilityId('requirement-management'))
      insertScenarioCapability(db, ScenarioId('product-engineering'), CapabilityId('code-gen'))
      const scenario = getScenario(db, ScenarioId('product-engineering'))
      // The set is served in capability-id order (the owning query sorts by id).
      expect(scenario?.capabilityIds).toEqual([CapabilityId('code-gen'), CapabilityId('requirement-management')])
      expect(scenarioCapabilityIds(db, ScenarioId('product-engineering'))).toEqual([CapabilityId('code-gen'), CapabilityId('requirement-management')])
      expect(listScenarios(db).map(s => s.id)).toEqual([ScenarioId('product-engineering')])
      expect(getScenario(db, ScenarioId('ghost'))).toBeUndefined()
    } finally {
      db.close()
    }
  })
})

describe('billing ledger', () => {
  it('credits, debits, and meters usage against one account', async () => {
    const db = await freshDb()
    try {
      seedWorkspace(db)
      publish(db, 'requirement-management')
      expect(getAccount(db, ws)).toBeUndefined()
      expect(() => requireAccount(db, ws)).toThrow()
      creditAccount(db, ws, 10, now)
      expect(getAccount(db, ws)?.balance).toBe(10)
      debitAccount(db, ws, 4)
      expect(getAccount(db, ws)?.balance).toBe(6)
      const usage = insertUsage(db, ws, CapabilityId('requirement-management'), 2, 8, now)
      expect(usage.id.startsWith('usage-')).toBe(true)
      const listed = listUsage(db, ws)
      expect(listed.map(u => u.cost)).toEqual([8])
      expect(listUsage(db, WorkspaceId('ws-other'))).toEqual([])
    } finally {
      db.close()
    }
  })

  it('opens a zero settlement and accrues until it settles', async () => {
    const db = await freshDb()
    try {
      seedWorkspace(db)
      const open = ensureOpenSettlement(db, ws, '2026-08', now)
      expect(open.amount).toBe(0)
      expect(open.status).toBe('open')
      // Reopening the same period returns the existing open settlement.
      expect(ensureOpenSettlement(db, ws, '2026-08', now).id).toBe(open.id)
      const accrued = accrueSettlement(db, open.id, 25)
      expect(accrued.amount).toBe(25)
      const settled = settleSettlement(db, ws, '2026-08', now)
      expect(settled.status).toBe('settled')
      expect(settled.settledAt).toBe(now)
      expect(getSettlement(db, settled.id)).toMatchObject({ status: 'settled', amount: 25 })
      expect(listSettlements(db, ws).map(s => s.status)).toEqual(['settled'])
    } finally {
      db.close()
    }
  })

  it('creates a zero settlement at settle time when none exists', async () => {
    const db = await freshDb()
    try {
      seedWorkspace(db)
      const settled = settleSettlement(db, ws, '2026-07', now)
      expect(settled.amount).toBe(0)
      expect(settled.status).toBe('settled')
      expect(settled.settledAt).toBe(now)
    } finally {
      db.close()
    }
  })
})
