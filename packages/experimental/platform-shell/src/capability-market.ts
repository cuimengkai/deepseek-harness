/**
 * Platform capability market and billing ledger: catalog CRUD, scenario-bundle
 * workbench registration, pure capability-set resolution (dependency closure,
 * conflicts, version ranges, execution gating), and the per-workspace billing
 * account with metered usage and open → settled settlements. All writes run
 * inside the service's begin-immediate mutation transaction (capability-market
 * §2–§4, platform-billing-ledger §1–§4).
 * @module @deepseek-ai/dsh-experimental-platform-shell/capability-market
 */

import type { DatabaseSync } from 'node:sqlite'
import {
  CapabilityId,
  ScenarioId,
  SettlementId,
  UsageRecordId,
  type AccountRecord,
  type CapabilityDependency,
  type CapabilityRecord,
  type ExecutionMode,
  type PublishCapabilityRequest,
  type PublishScenarioRequest,
  type ScenarioBundle,
  type SettlementRecord,
  type SettlementStatus,
  type UsageRecord,
  type WorkspaceId,
} from './types.ts'
import { PlatformShellError } from './error.ts'
import {
  decodeAccountRow,
  decodeCapabilityDependencyRow,
  decodeCapabilityRow,
  decodeScenarioRow,
  decodeSettlementRow,
  decodeUsageRecordRow,
} from './schema.ts'
import { sql } from './sql.ts'

/** One immutable catalog view used by the pure resolution function. */
export interface CatalogSnapshot {
  readonly capabilities: ReadonlyMap<CapabilityId, CapabilityRecord>
  readonly dependencies: ReadonlyMap<CapabilityId, readonly CapabilityDependency[]>
  readonly conflicts: ReadonlyMap<CapabilityId, readonly CapabilityId[]>
}

/**
 * Validate a publish-capability request before it reaches the store.
 * @param request - the publish-capability request to validate.
 */
export function validateCapabilityRequest(request: PublishCapabilityRequest): void {
  if (request.id.length === 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'capability id must not be empty')
  }
  if (request.name.length === 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'capability name must not be empty')
  }
  if (request.version.length === 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'capability version must not be empty')
  }
  if (!Number.isSafeInteger(request.rate) || request.rate < 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'capability rate must be a non-negative integer of credits')
  }
  const rollout = request.rollout ?? 1
  if (rollout < 0 || rollout > 1) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'capability rollout must be within 0..1')
  }
  if (request.execution !== 'managed' && request.execution !== 'sandboxed' && request.execution !== 'none') {
    throw new PlatformShellError('INVALID_ARGUMENT', `unknown execution mode ${request.execution}`)
  }
  for (const toolName of request.tools ?? []) {
    if (toolName.length === 0) {
      throw new PlatformShellError('INVALID_ARGUMENT', 'capability tool names must not be empty')
    }
  }
}

/**
 * Validate a publish-scenario request before it reaches the store.
 * @param request - the publish-scenario request to validate.
 */
export function validateScenarioRequest(request: PublishScenarioRequest): void {
  if (request.id.length === 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'scenario id must not be empty')
  }
  if (request.name.length === 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'scenario name must not be empty')
  }
  if (request.workbenchId.length === 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'scenario workbenchId must not be empty')
  }
  if (request.preset.length === 0) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'scenario preset must not be empty')
  }
}

/**
 * Insert one catalog entry with its defaults applied.
 * @param db - the SQLite database handle.
 * @param request - the catalog entry to insert.
 * @param now - the epoch-ms timestamp.
 * @returns the committed catalog entry.
 */
export function insertCapability(db: DatabaseSync, request: PublishCapabilityRequest, now: number): CapabilityRecord {
  const enabled = request.enabled ?? true
  const rollout = request.rollout ?? 1
  const description = request.description ?? ''
  const tools = request.tools ?? []
  db.prepare(sql('insert-capability')).run(
    request.id,
    request.name,
    request.roleId,
    request.execution,
    request.version,
    enabled ? 1 : 0,
    rollout,
    request.rate,
    description,
    now,
  )
  insertCapabilityTools(db, request.id, tools)
  return {
    id: request.id,
    name: request.name,
    roleId: request.roleId,
    execution: request.execution,
    version: request.version,
    enabled,
    rollout,
    rate: request.rate,
    description,
    tools,
    createdAt: now,
  }
}

/**
 * Link one capability's governed tool surface (the execution-gate read set).
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry's branded id.
 * @param tools - the tool names whose execution the gate governs.
 */
export function insertCapabilityTools(db: DatabaseSync, capabilityId: CapabilityId, tools: readonly string[]): void {
  const statement = db.prepare(sql('insert-capability-tool'))
  for (const toolName of tools) statement.run(capabilityId, toolName)
}

/**
 * One capability's governed tool surface in tool-name order.
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry's branded id.
 * @returns the tool names whose execution the gate governs.
 */
export function capabilityToolsOf(db: DatabaseSync, capabilityId: CapabilityId): string[] {
  const rows = db.prepare(sql('select-capability-tools')).all(capabilityId) as { tool_name: string }[]
  return rows.map(row => row.tool_name)
}

/**
 * The fresh catalog record whose gate governs one tool's execution, or
 * `undefined` when no capability owns the tool. The runtime-enforcement read:
 * it joins the live capabilities row, so a stale gate snapshot can never be
 * served after the operator flips it. The record's `tools` carries only the
 * matched tool — the gate path reads the gate fields, not the full surface.
 * @param db - the SQLite database handle.
 * @param toolName - the tool name to resolve an owner for.
 * @returns the owning capability's fresh record, or undefined when unowned.
 */
export function capabilityOwningTool(db: DatabaseSync, toolName: string): CapabilityRecord | undefined {
  const row = db.prepare(sql('select-capability-owner')).get(toolName)
  return row === undefined ? undefined : decodeCapabilityRow(row, [toolName])
}

/**
 * Insert one dependency edge of a catalog entry.
 * @param db - the SQLite database handle.
 * @param capabilityId - the depending catalog entry.
 * @param dependsOn - the capability it depends on.
 * @param range - the version range the dependency requires, or null.
 * @param now - the epoch-ms timestamp.
 */
export function insertCapabilityDependency(
  db: DatabaseSync,
  capabilityId: CapabilityId,
  dependsOn: CapabilityId,
  range: string | null,
  now: number,
): void {
  db.prepare(sql('insert-capability-dependency')).run(capabilityId, dependsOn, range, now)
}

/**
 * Insert one conflict edge of a catalog entry.
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry.
 * @param conflictsWith - the capability it conflicts with.
 * @param now - the epoch-ms timestamp.
 */
export function insertCapabilityConflict(
  db: DatabaseSync,
  capabilityId: CapabilityId,
  conflictsWith: CapabilityId,
  now: number,
): void {
  db.prepare(sql('insert-capability-conflict')).run(capabilityId, conflictsWith, now)
}

/**
 * Read one catalog entry.
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry's branded id.
 * @returns the entry, or undefined when absent.
 */
export function getCapability(db: DatabaseSync, capabilityId: CapabilityId): CapabilityRecord | undefined {
  const row = db.prepare(sql('select-capability')).get(capabilityId)
  return row === undefined ? undefined : decodeCapabilityRow(row, capabilityToolsOf(db, capabilityId))
}

/**
 * List every catalog entry in identity order.
 * @param db - the SQLite database handle.
 * @returns the catalog entries.
 */
export function listCapabilities(db: DatabaseSync): CapabilityRecord[] {
  return db.prepare(sql('select-capabilities')).all()
    .map((row) => {
      const capability = decodeCapabilityRow(row)
      return { ...capability, tools: capabilityToolsOf(db, capability.id) }
    })
}

/**
 * Remove one catalog entry (cascades its own dependency and conflict edges).
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry's branded id.
 */
export function deleteCapability(db: DatabaseSync, capabilityId: CapabilityId): void {
  db.prepare(sql('delete-capability')).run(capabilityId)
}

/**
 * Remove one scenario bundle (cascades its workbench capability memberships).
 * @param db - the SQLite database handle.
 * @param scenarioId - the scenario bundle's branded id.
 */
export function deleteScenario(db: DatabaseSync, scenarioId: ScenarioId): void {
  db.prepare(sql('delete-scenario')).run(scenarioId)
}

/**
 * Set one catalog entry's execution gate.
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry's branded id.
 * @param enabled - whether the entry is enabled.
 * @param rollout - the 0..1 rollout fraction.
 * @returns the committed entry.
 */
export function setCapabilityGate(
  db: DatabaseSync,
  capabilityId: CapabilityId,
  enabled: boolean,
  rollout: number,
): CapabilityRecord {
  const capability = requireCapability(db, capabilityId)
  db.prepare(sql('update-capability-gate')).run(enabled ? 1 : 0, rollout, capabilityId)
  return { ...capability, enabled, rollout }
}

/**
 * Assert that one catalog entry exists.
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry's branded id.
 * @returns the catalog entry.
 * @throws CAPABILITY_NOT_FOUND when the capability is absent.
 */
export function requireCapability(db: DatabaseSync, capabilityId: CapabilityId): CapabilityRecord {
  const capability = getCapability(db, capabilityId)
  if (capability === undefined) {
    throw new PlatformShellError('CAPABILITY_NOT_FOUND', `unknown capability ${capabilityId}`)
  }
  return capability
}

/**
 * One entry's dependency edges in identity order.
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry's branded id.
 * @returns the entry's dependency edges.
 */
export function dependenciesOf(db: DatabaseSync, capabilityId: CapabilityId): CapabilityDependency[] {
  const rows = db.prepare(sql('select-capability-dependencies')).all(capabilityId)
  return rows.map(row => decodeCapabilityDependencyRow(row))
}

/**
 * One entry's conflict targets in identity order.
 * @param db - the SQLite database handle.
 * @param capabilityId - the catalog entry's branded id.
 * @returns the entry's conflicting capability ids.
 */
export function conflictsOf(db: DatabaseSync, capabilityId: CapabilityId): CapabilityId[] {
  const rows = db.prepare(sql('select-capability-conflicts')).all(capabilityId) as { conflicts_with: string }[]
  return rows.map(row => CapabilityId(row.conflicts_with))
}

/**
 * Insert one scenario bundle (its capability set is linked separately).
 * @param db - the SQLite database handle.
 * @param request - the scenario bundle to insert.
 * @param now - the epoch-ms timestamp.
 * @returns the committed scenario bundle.
 */
export function insertScenario(db: DatabaseSync, request: PublishScenarioRequest, now: number): ScenarioBundle {
  db.prepare(sql('insert-scenario')).run(request.id, request.name, request.workbenchId, request.roleId, request.preset, now)
  return {
    id: request.id,
    name: request.name,
    workbenchId: request.workbenchId,
    roleId: request.roleId,
    preset: request.preset,
    capabilityIds: [],
    createdAt: now,
  }
}

/**
 * Link one capability into a scenario bundle's workbench surface.
 * @param db - the SQLite database handle.
 * @param scenarioId - the scenario bundle's branded id.
 * @param capabilityId - the catalog entry's branded id.
 */
export function insertScenarioCapability(db: DatabaseSync, scenarioId: ScenarioId, capabilityId: CapabilityId): void {
  db.prepare(sql('insert-scenario-capability')).run(scenarioId, capabilityId)
}

/**
 * Read one scenario bundle with its capability set.
 * @param db - the SQLite database handle.
 * @param scenarioId - the scenario bundle's branded id.
 * @returns the bundle, or undefined when absent.
 */
export function getScenario(db: DatabaseSync, scenarioId: ScenarioId): ScenarioBundle | undefined {
  const row = db.prepare(sql('select-scenario')).get(scenarioId)
  return row === undefined ? undefined : withCapabilities(db, decodeScenarioRow(row))
}

/**
 * List every scenario bundle with its capability set.
 * @param db - the SQLite database handle.
 * @returns the scenario bundles.
 */
export function listScenarios(db: DatabaseSync): ScenarioBundle[] {
  return db.prepare(sql('select-scenarios')).all()
    .map(row => withCapabilities(db, decodeScenarioRow(row)))
}

/**
 * One bundle's capability set in identity order.
 * @param db - the SQLite database handle.
 * @param scenarioId - the scenario bundle's branded id.
 * @returns the bundle's capability ids.
 */
export function scenarioCapabilityIds(db: DatabaseSync, scenarioId: ScenarioId): CapabilityId[] {
  const rows = db.prepare(sql('select-scenario-capabilities')).all(scenarioId) as { capability_id: string }[]
  return rows.map(row => CapabilityId(row.capability_id))
}

/**
 * Assert that one scenario bundle exists.
 * @param db - the SQLite database handle.
 * @param scenarioId - the scenario bundle's branded id.
 * @returns the scenario bundle.
 * @throws SCENARIO_NOT_FOUND when the scenario is absent.
 */
export function requireScenario(db: DatabaseSync, scenarioId: ScenarioId): ScenarioBundle {
  const scenario = getScenario(db, scenarioId)
  if (scenario === undefined) {
    throw new PlatformShellError('SCENARIO_NOT_FOUND', `unknown scenario ${scenarioId}`)
  }
  return scenario
}

/**
 * Load an immutable catalog snapshot for resolution.
 * @param db - the SQLite database handle.
 * @returns the loaded catalog snapshot.
 */
export function loadCatalog(db: DatabaseSync): CatalogSnapshot {
  const capabilities = new Map<CapabilityId, CapabilityRecord>()
  for (const capability of listCapabilities(db)) capabilities.set(capability.id, capability)
  const dependencies = new Map<CapabilityId, readonly CapabilityDependency[]>()
  const conflicts = new Map<CapabilityId, readonly CapabilityId[]>()
  for (const capability of capabilities.values()) {
    dependencies.set(capability.id, dependenciesOf(db, capability.id))
    conflicts.set(capability.id, conflictsOf(db, capability.id))
  }
  return { capabilities, dependencies, conflicts }
}

/**
 * Resolve one capability selection into the ordered, dependency-complete set.
 * Pure over the snapshot: rejects duplicate ids, transitive closure over
 * dependency edges (which must exist and satisfy their version ranges), refuses
 * disabled or rollout-excluded entries loudly, and rejects conflicting pairs.
 * @param catalog - the immutable catalog snapshot to resolve over.
 * @param workspaceId - the workspace the selection is resolved for.
 * @param selected - the selected capability ids.
 * @returns the ordered, dependency-complete resolved set.
 * @throws CAPABILITY_NOT_FOUND / CAPABILITY_DEPENDENCY_MISSING / VERSION_MISMATCH /
 * CAPABILITY_CONFLICT / CAPABILITY_DISABLED / INVALID_ARGUMENT.
 */
export function resolveSelection(
  catalog: CatalogSnapshot,
  workspaceId: WorkspaceId,
  selected: readonly CapabilityId[],
): CapabilityRecord[] {
  if (new Set(selected).size !== selected.length) {
    throw new PlatformShellError('INVALID_ARGUMENT', 'capability selection must not repeat an id')
  }
  const resolved = new Map<CapabilityId, CapabilityRecord>()
  const visiting = new Set<CapabilityId>()
  const visit = (id: CapabilityId): void => {
    if (resolved.has(id)) return
    if (visiting.has(id)) {
      throw new PlatformShellError('INVALID_ARGUMENT', `capability dependency cycle involves ${id}`)
    }
    visiting.add(id)
    const capability = catalog.capabilities.get(id)
    if (capability === undefined) {
      throw new PlatformShellError('CAPABILITY_NOT_FOUND', `unknown capability ${id}`)
    }
    assertGateOpen(capability, workspaceId)
    for (const dependency of catalog.dependencies.get(id) ?? []) {
      const dep = catalog.capabilities.get(dependency.id)
      if (dep === undefined) {
        throw new PlatformShellError('CAPABILITY_DEPENDENCY_MISSING', `capability ${id} depends on unknown capability ${dependency.id}`)
      }
      if (dependency.range !== null && !versionSatisfies(dep.version, dependency.range)) {
        throw new PlatformShellError('VERSION_MISMATCH', `capability ${dependency.id} version ${dep.version} does not satisfy ${dependency.range}`)
      }
      assertGateOpen(dep, workspaceId)
      visit(dependency.id)
    }
    visiting.delete(id)
    resolved.set(id, capability)
  }
  for (const id of selected) visit(id)

  const ordered = [...resolved.values()]
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const a = ordered[i] as CapabilityRecord
      const b = ordered[j] as CapabilityRecord
      if ((catalog.conflicts.get(a.id) ?? []).includes(b.id) || (catalog.conflicts.get(b.id) ?? []).includes(a.id)) {
        throw new PlatformShellError('CAPABILITY_CONFLICT', `capabilities ${a.id} and ${b.id} conflict`)
      }
    }
  }
  return ordered
}

/**
 * Whether one capability's execution gate is open for one workspace.
 * @param capability - the catalog entry to test.
 * @param workspaceId - the workspace the entry runs for.
 * @returns whether the gate is open for the workspace.
 */
export function gateOpen(capability: CapabilityRecord, workspaceId: WorkspaceId): boolean {
  return capability.enabled && stableFraction(workspaceId, capability.id) < capability.rollout
}

/**
 * Assert that one capability's execution gate is open for one workspace.
 * @param capability - the catalog entry to test.
 * @param workspaceId - the workspace the entry runs for.
 * @throws CAPABILITY_DISABLED when the entry is disabled or outside its rollout.
 */
export function assertGateOpen(capability: CapabilityRecord, workspaceId: WorkspaceId): void {
  if (!gateOpen(capability, workspaceId)) {
    throw new PlatformShellError('CAPABILITY_DISABLED', `capability ${capability.id} is not open for workspace ${workspaceId}`)
  }
}

/**
 * Whether one semver-style version satisfies a version range.
 * @param version - the version to test.
 * @param range - the version range to satisfy.
 * @returns whether the version satisfies the range.
 */
export function versionSatisfies(version: string, range: string): boolean {
  const operator = range.startsWith('>=') ? '>='
    : range.startsWith('<=') ? '<='
      : range.startsWith('>') ? '>'
        : range.startsWith('<') ? '<'
          : '='
  const target = range.replace(/^(>=|<=|>|<|=)/, '')
  const comparison = compareVersions(version, target)
  switch (operator) {
    case '>=': return comparison >= 0
    case '<=': return comparison <= 0
    case '>': return comparison > 0
    case '<': return comparison < 0
    default: return comparison === 0
  }
}

/**
 * The `YYYY-MM` billing period containing one timestamp.
 * @param now - the epoch-ms timestamp.
 * @returns the billing period string.
 */
export function periodOf(now: number): string {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}`
}

// --- billing ledger ---

/**
 * Read one workspace's billing account, creating it at zero balance when absent.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @param now - the epoch-ms timestamp.
 * @returns the workspace's account.
 */
export function ensureAccount(db: DatabaseSync, workspaceId: WorkspaceId, now: number): AccountRecord {
  const existing = getAccount(db, workspaceId)
  if (existing !== undefined) return existing
  db.prepare(sql('insert-account')).run(workspaceId, 0, now)
  return { workspaceId, balance: 0, createdAt: now }
}

/**
 * Read one workspace's billing account.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @returns the account, or undefined when none has been opened.
 */
export function getAccount(db: DatabaseSync, workspaceId: WorkspaceId): AccountRecord | undefined {
  const row = db.prepare(sql('select-account')).get(workspaceId)
  return row === undefined ? undefined : decodeAccountRow(row)
}

/**
 * Assert that one billing account exists.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @returns the workspace's account.
 * @throws ACCOUNT_NOT_FOUND when no account has been opened.
 */
export function requireAccount(db: DatabaseSync, workspaceId: WorkspaceId): AccountRecord {
  const account = getAccount(db, workspaceId)
  if (account === undefined) {
    throw new PlatformShellError('ACCOUNT_NOT_FOUND', `no billing account for workspace ${workspaceId}`)
  }
  return account
}

/**
 * Credit one workspace's account and return the new balance.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @param amount - the credits to add.
 * @param now - the epoch-ms timestamp.
 * @returns the updated account.
 */
export function creditAccount(db: DatabaseSync, workspaceId: WorkspaceId, amount: number, now: number): AccountRecord {
  const account = ensureAccount(db, workspaceId, now)
  const balance = account.balance + amount
  db.prepare(sql('update-account-balance')).run(balance, workspaceId)
  return { ...account, balance }
}

/**
 * Debit one workspace's account and return the new balance.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @param amount - the credits to deduct.
 * @returns the updated account.
 */
export function debitAccount(db: DatabaseSync, workspaceId: WorkspaceId, amount: number): AccountRecord {
  const account = requireAccount(db, workspaceId)
  const balance = account.balance - amount
  db.prepare(sql('update-account-balance')).run(balance, workspaceId)
  return { ...account, balance }
}

/**
 * Append one usage record and return it.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @param capabilityId - the consumed capability's branded id.
 * @param qty - the quantity consumed.
 * @param cost - the metered cost in credits.
 * @param now - the epoch-ms timestamp.
 * @returns the committed usage record.
 */
export function insertUsage(
  db: DatabaseSync,
  workspaceId: WorkspaceId,
  capabilityId: CapabilityId,
  qty: number,
  cost: number,
  now: number,
): UsageRecord {
  const id = UsageRecordId(`usage-${nextSequence(db, 'select-usage-ids', 'usage_id')}`)
  db.prepare(sql('insert-usage')).run(id, workspaceId, capabilityId, qty, cost, now, now)
  return { id, workspaceId, capabilityId, qty, cost, billedAt: now, createdAt: now }
}

/**
 * List one workspace's usage records in billing order.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @returns the workspace's usage records.
 */
export function listUsage(db: DatabaseSync, workspaceId: WorkspaceId): UsageRecord[] {
  return db.prepare(sql('select-usage-by-workspace')).all(workspaceId).map(row => decodeUsageRecordRow(row))
}

/**
 * One workspace's open settlement for a period, or `undefined` when none.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @param period - the `YYYY-MM` billing period.
 * @returns the open settlement, or undefined when none.
 */
export function openSettlementOf(db: DatabaseSync, workspaceId: WorkspaceId, period: string): SettlementRecord | undefined {
  const row = db.prepare(sql('select-open-settlement')).get(workspaceId, period)
  return row === undefined ? undefined : decodeSettlementRow(row)
}

/**
 * The open settlement for a workspace and period, creating it at zero when absent.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @param period - the `YYYY-MM` billing period.
 * @param now - the epoch-ms timestamp.
 * @returns the open settlement.
 */
export function ensureOpenSettlement(db: DatabaseSync, workspaceId: WorkspaceId, period: string, now: number): SettlementRecord {
  const existing = openSettlementOf(db, workspaceId, period)
  if (existing !== undefined) return existing
  const id = SettlementId(`settlement-${nextSequence(db, 'select-settlement-ids', 'settlement_id')}`)
  db.prepare(sql('insert-settlement')).run(id, workspaceId, period, 0, now)
  return { id, workspaceId, period, amount: 0, status: 'open', createdAt: now, settledAt: null }
}

/**
 * Set one settlement's accrued amount and return the updated record.
 * @param db - the SQLite database handle.
 * @param settlementId - the settlement's branded id.
 * @param amount - the new accrued amount.
 * @returns the updated settlement.
 */
export function accrueSettlement(db: DatabaseSync, settlementId: SettlementId, amount: number): SettlementRecord {
  const settlement = requireSettlement(db, settlementId)
  db.prepare(sql('accrue-settlement')).run(amount, settlementId)
  return { ...settlement, amount }
}

/**
 * Close one workspace's open settlement for a period as `settled`.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @param period - the `YYYY-MM` billing period to close.
 * @param now - the epoch-ms timestamp.
 * @returns the committed settlement.
 */
export function settleSettlement(db: DatabaseSync, workspaceId: WorkspaceId, period: string, now: number): SettlementRecord {
  const open = openSettlementOf(db, workspaceId, period) ?? ensureOpenSettlement(db, workspaceId, period, now)
  db.prepare(sql('update-settlement-settle')).run(now, open.id)
  return { ...open, status: 'settled', settledAt: now }
}

/**
 * Read one settlement.
 * @param db - the SQLite database handle.
 * @param settlementId - the settlement's branded id.
 * @returns the settlement, or undefined when absent.
 */
export function getSettlement(db: DatabaseSync, settlementId: SettlementId): SettlementRecord | undefined {
  const row = db.prepare(sql('select-settlement')).get(settlementId)
  return row === undefined ? undefined : decodeSettlementRow(row)
}

/**
 * List one workspace's settlements in creation order.
 * @param db - the SQLite database handle.
 * @param workspaceId - the workspace's branded id.
 * @returns the workspace's settlements.
 */
export function listSettlements(db: DatabaseSync, workspaceId: WorkspaceId): SettlementRecord[] {
  return db.prepare(sql('select-settlements-by-workspace')).all(workspaceId).map(row => decodeSettlementRow(row))
}

/**
 * Assert that one settlement exists.
 * @param db - the SQLite database handle.
 * @param settlementId - the settlement's branded id.
 * @returns the settlement.
 * @throws INVALID_ARGUMENT when the settlement is absent.
 */
export function requireSettlement(db: DatabaseSync, settlementId: SettlementId): SettlementRecord {
  const settlement = getSettlement(db, settlementId)
  if (settlement === undefined) {
    throw new PlatformShellError('INVALID_ARGUMENT', `unknown settlement ${settlementId}`)
  }
  return settlement
}

/** Compose a scenario row with its capability set. */
function withCapabilities(db: DatabaseSync, scenario: ScenarioBundle): ScenarioBundle {
  return { ...scenario, capabilityIds: scenarioCapabilityIds(db, scenario.id) }
}

/** A deterministic [0,1) fraction from a workspace and capability pair (FNV-1a). */
function stableFraction(workspaceId: WorkspaceId, capabilityId: CapabilityId): number {
  let hash = 0x811c9dc5
  const input = `${workspaceId}:${capabilityId}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) / 0xffffffff
}

/** Compare two dotted version strings numerically. */
function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a)
  const partsB = parseVersion(b)
  const length = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < length; i += 1) {
    const left = partsA[i] ?? 0
    const right = partsB[i] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

function parseVersion(value: string): number[] {
  return value.split('.').map(part => Number.parseInt(part, 10) || 0)
}

/** The next `prefix-<seq>` sequence derived from stored ids. */
function nextSequence(
  db: DatabaseSync,
  resource: 'select-usage-ids' | 'select-settlement-ids',
  column: 'usage_id' | 'settlement_id',
): number {
  const rows = db.prepare(sql(resource)).all() as Record<string, string>[]
  let max = 0
  for (const entry of rows) {
    const value = entry[column] ?? ''
    const suffix = value.slice(value.lastIndexOf('-') + 1)
    const parsed = Number.parseInt(suffix, 10)
    if (!Number.isNaN(parsed) && parsed > max) max = parsed
  }
  return max + 1
}

export type { ExecutionMode, SettlementStatus }
