/**
 * Platform control-plane schema ownership and durable-row validation.
 * @module @deepseek-ai/dsh-experimental-platform-shell/schema
 */

import { performance } from 'node:perf_hooks'
import type { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import {
  AuditEventId,
  AssetId,
  CapabilityId,
  RoleId,
  ScenarioId,
  SettlementId,
  TicketId,
  UsageRecordId,
  UserId,
  WorkspaceId,
  type AccountRecord,
  type ApprovalTicket,
  type ApprovalTransition,
  type AssetRecord,
  type AuditEvent,
  type BusinessApprovalStatus,
  type CapabilityDependency,
  type CapabilityRecord,
  type ExecutionMode,
  type LineageEdge,
  type ReviewScope,
  type ScenarioBundle,
  type SettlementRecord,
  type SettlementStatus,
  type UsageRecord,
} from './types.ts'
import { sql } from './sql.ts'
import { PlatformShellError } from './error.ts'

/** Current physical schema version of the platform control-plane database. */
export const SCHEMA_VERSION = 4
/** Application id reserved for DeepSeek Harness platform control-plane databases. */
export const PLATFORM_SHELL_SQLITE_APPLICATION_ID = 0x504c5348

/** A materialized durable-row view over the platform store. */
export interface UserRow {
  readonly user_id: string
  readonly display_name: string
  readonly created_at: number
}

/** A raw row from the workspaces table. */
export interface WorkspaceRow {
  readonly workspace_id: string
  readonly name: string
  readonly created_at: number
}

/** A raw row from the membership join. */
export interface MembershipRow {
  readonly role_id: string
  readonly role_name: string
}

/** A raw row from the role_permissions table. */
export interface PermissionRow {
  readonly permission: string
}

/** A raw row from the assets table. */
export interface AssetRow {
  readonly asset_id: string
  readonly kind: string
  readonly content: string
  readonly role_id: string
  readonly workspace_id: string
  readonly created_at: number
}

/** A raw row from the lineage table. */
export interface LineageRow {
  readonly asset_id: string
  readonly parent_id: string
  readonly role_id: string
  readonly created_at: number
}

/** A raw row from the approval_tickets table. */
export interface TicketRow {
  readonly ticket_id: string
  readonly workspace_id: string
  readonly subject_kind: string
  readonly subject_id: string
  readonly status: string
  readonly actor_user_id: string
  readonly review_scope: string | null
  readonly created_at: number
  readonly updated_at: number
}

/** A raw row from the approval_transitions table. */
export interface TransitionRow {
  readonly ticket_id: string
  readonly seq: number
  readonly from_status: string | null
  readonly to_status: string
  readonly actor_user_id: string
  readonly created_at: number
}

/** A raw row from the audit_events table. */
export interface AuditRow {
  readonly event_id: number
  readonly actor_user_id: string
  readonly workspace_id: string | null
  readonly action: string
  readonly target_kind: string | null
  readonly target_id: string | null
  readonly detail: string | null
  readonly created_at: number
}

/** A raw row from the capabilities table. */
export interface CapabilityRow {
  readonly capability_id: string
  readonly name: string
  readonly role_id: string
  readonly execution: string
  readonly version: string
  readonly enabled: number
  readonly rollout: number
  readonly rate: number
  readonly description: string
  readonly created_at: number
}

/** A raw row from the capability_dependencies table. */
export interface CapabilityDependencyRow {
  readonly depends_on: string
  readonly range: string | null
}

/** A raw row from the scenario_bundles table. */
export interface ScenarioRow {
  readonly scenario_id: string
  readonly name: string
  readonly workbench_id: string
  readonly role_id: string
  readonly preset: string
  readonly created_at: number
}

/** A raw row from the accounts table. */
export interface AccountRow {
  readonly workspace_id: string
  readonly balance: number
  readonly created_at: number
}

/** A raw row from the usage_records table. */
export interface UsageRow {
  readonly usage_id: string
  readonly workspace_id: string
  readonly capability_id: string
  readonly qty: number
  readonly cost: number
  readonly billed_at: number
  readonly created_at: number
}

/** A raw row from the settlements table. */
export interface SettlementRow {
  readonly settlement_id: string
  readonly workspace_id: string
  readonly period: string
  readonly amount: number
  readonly status: string
  readonly created_at: number
  readonly settled_at: number | null
}

interface SchemaObjectRow {
  readonly type: string
  readonly name: string
  readonly tbl_name: string
  readonly sql: string
}

const JOURNAL_BUSY_RETRY_INTERVAL_MS = 10
type DatabaseSyncConstructor = typeof import('node:sqlite')['DatabaseSync']

/** Durable journal modes accepted by the platform store. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/**
 * Open and validate a platform control-plane database.
 * @param Database - lazily imported Node SQLite constructor.
 * @param path - SQLite path, including `:memory:`.
 * @param journalMode - validated journal pragma.
 * @param busyTimeoutMs - validated maximum wait for a competing SQLite lock.
 * @returns the configured database handle.
 * @throws when connection settings, schema ownership, or SQLite setup cannot be validated.
 */
export async function openDatabase(
  Database: DatabaseSyncConstructor,
  path: string,
  journalMode: JournalMode,
  busyTimeoutMs: number,
): Promise<DatabaseSync> {
  const deadline = performance.now() + busyTimeoutMs
  const db = new Database(path, { timeout: busyTimeoutMs })
  try {
    configureConnectionSecurity(db, path)
    configureDatabase(Database, db, path)
    await selectJournalMode(db, path, journalMode, deadline)
    configureDurability(db, path)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureConnectionSecurity(db: DatabaseSync, path: string): void {
  db.exec(sql('trusted-schema-off'))
  const trustedSchema = integerField(db.prepare(sql('select-trusted-schema')).get(), 'trusted_schema')
  /* v8 ignore next 3 -- supported SQLite versions return the fixed setting. */
  if (trustedSchema !== 0) {
    throw new Error(`platform database at "${path}" retained trusted_schema=${trustedSchema}, expected 0`)
  }
  db.exec(sql('mmap-off'))
  if (path === ':memory:') return
  const mmapSize = integerField(db.prepare(sql('select-mmap-size')).get(), 'mmap_size')
  /* v8 ignore next 3 -- supported file-backed SQLite connections return the fixed setting. */
  if (mmapSize !== 0) {
    throw new Error(`platform database at "${path}" retained mmap_size=${mmapSize}, expected 0`)
  }
}

function configureDatabase(
  Database: DatabaseSyncConstructor,
  db: DatabaseSync,
  path: string,
): void {
  db.exec(sql('foreign-keys-on'))
  let began = false
  try {
    db.exec(sql('begin-immediate'))
    began = true
    const onDisk = integerField(db.prepare(sql('select-user-version')).get(), 'user_version')
    const applicationId = integerField(db.prepare(sql('select-application-id')).get(), 'application_id')
    const userObjectCount = integerField(db.prepare(sql('select-user-object-count')).get(), 'count')
    if (onDisk === 0 && (applicationId !== 0 || userObjectCount > 0)) {
      throw new Error(`platform database at "${path}" has an unversioned schema or application identity`)
    }
    if (onDisk !== 0 && onDisk !== SCHEMA_VERSION) {
      throw new Error(
        `platform database at "${path}" has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`,
      )
    }
    if (onDisk !== 0 && applicationId !== PLATFORM_SHELL_SQLITE_APPLICATION_ID) {
      throw new Error(
        `platform database at "${path}" has application id ${applicationId}, expected ${PLATFORM_SHELL_SQLITE_APPLICATION_ID}`,
      )
    }
    if (onDisk === 0) initializeDatabase(db)
    validateRequiredSchema(Database, db, path)
    db.exec(sql('commit'))
    began = false
  } catch (error: unknown) {
    /* v8 ignore else -- a failed begin leaves no transaction to roll back. */
    if (began) {
      /* v8 ignore next 5 -- retain the original ownership failure if rollback fails too. */
      try {
        db.exec(sql('rollback'))
      } catch {
        // The original database-ownership failure remains actionable.
      }
    }
    throw error
  }
}

async function selectJournalMode(
  db: DatabaseSync,
  path: string,
  journalMode: JournalMode,
  deadline: number,
): Promise<void> {
  let result: unknown
  while (true) {
    try {
      result = db.prepare(sql(journalResource(journalMode))).get()
      break
    } catch (error: unknown) {
      const remainingMs = Math.max(0, Math.ceil(deadline - performance.now()))
      if (!isSqliteBusy(error) || remainingMs === 0) throw error
      await delay(Math.min(JOURNAL_BUSY_RETRY_INTERVAL_MS, remainingMs))
      if (performance.now() >= deadline) throw error
    }
  }
  const selected = stringField(result, 'journal_mode').toLowerCase()
  const expected = path === ':memory:' ? 'memory' : journalMode
  /* v8 ignore next 3 -- SQLite returns the selected mode from these fixed, valid pragmas. */
  if (selected !== expected) {
    throw new Error(`platform database at "${path}" selected journal mode ${selected}, expected ${expected}`)
  }
}

function configureDurability(db: DatabaseSync, path: string): void {
  db.exec(sql('synchronous-full'))
  const synchronous = integerField(db.prepare(sql('select-synchronous')).get(), 'synchronous')
  /* v8 ignore next 3 -- supported SQLite versions return the fixed setting. */
  if (synchronous !== 2) {
    throw new Error(`platform database at "${path}" retained synchronous=${synchronous}, expected FULL (2)`)
  }
}

function isSqliteBusy(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && Reflect.get(error, 'errcode') === 5
}

function journalResource(mode: JournalMode):
  | 'journal-mode-wal'
  | 'journal-mode-delete'
  | 'journal-mode-truncate'
  | 'journal-mode-persist' {
  switch (mode) {
    case 'wal': return 'journal-mode-wal'
    case 'delete': return 'journal-mode-delete'
    case 'truncate': return 'journal-mode-truncate'
    case 'persist': return 'journal-mode-persist'
  }
}

function initializeDatabase(db: DatabaseSync): void {
  db.exec(sql('schema'))
  db.exec(sql('set-application-id'))
  db.exec(sql('set-user-version-4'))
}

let canonicalSchema: readonly SchemaObjectRow[] | undefined

function expectedSchema(Database: DatabaseSyncConstructor): readonly SchemaObjectRow[] {
  if (canonicalSchema !== undefined) return canonicalSchema
  const reference = new Database(':memory:')
  try {
    reference.exec(sql('foreign-keys-on'))
    reference.exec(sql('schema'))
    canonicalSchema = schemaObjects(reference)
    return canonicalSchema
  } finally {
    reference.close()
  }
}

function schemaObjects(db: DatabaseSync): SchemaObjectRow[] {
  return db.prepare(sql('select-schema-objects')).all().map((value) => {
    const row = record(value, 'schema object')
    return {
      type: stringField(row, 'type'),
      name: stringField(row, 'name'),
      tbl_name: stringField(row, 'tbl_name'),
      sql: normalizeSql(stringField(row, 'sql')),
    }
  })
}

function normalizeSql(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim()
}

function validateRequiredSchema(
  Database: DatabaseSyncConstructor,
  db: DatabaseSync,
  path: string,
): void {
  if (JSON.stringify(schemaObjects(db)) !== JSON.stringify(expectedSchema(Database))) {
    throw new Error(`platform database at "${path}" does not contain the required schema objects`)
  }
}

/**
 * Recheck schema ownership inside the caller's mutation transaction.
 * @param Database - constructor used to validate the canonical schema.
 * @param db - open owned database with an active immediate transaction.
 * @param path - database location used in ownership diagnostics.
 * @throws when another writer changed the application identity, schema, or version.
 */
export function validateSchemaForMutation(
  Database: DatabaseSyncConstructor,
  db: DatabaseSync,
  path: string,
): void {
  const version = integerField(db.prepare(sql('select-user-version')).get(), 'user_version')
  const applicationId = integerField(db.prepare(sql('select-application-id')).get(), 'application_id')
  if (applicationId !== PLATFORM_SHELL_SQLITE_APPLICATION_ID) {
    throw new Error(
      `platform database application id changed before mutation (expected ${PLATFORM_SHELL_SQLITE_APPLICATION_ID}, got ${applicationId})`,
    )
  }
  validateRequiredSchema(Database, db, path)
  if (version !== SCHEMA_VERSION) {
    throw new Error(`platform database schema changed before mutation (expected ${SCHEMA_VERSION}, got ${version})`)
  }
}

/**
 * Decode one validated asset row into an AssetRecord.
 * @param value - the raw row to decode.
 * @returns the decoded asset record.
 */
export function decodeAssetRow(value: unknown): AssetRecord {
  const row = record(value, 'stored asset')
  return {
    id: AssetId(nonemptyStringField(row, 'asset_id')),
    kind: assetKindField(nonemptyStringField(row, 'kind')),
    content: nonemptyStringField(row, 'content'),
    roleId: RoleId(nonemptyStringField(row, 'role_id')),
    workspaceId: WorkspaceId(nonemptyStringField(row, 'workspace_id')),
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
  }
}

/**
 * Decode one validated lineage row into a LineageEdge.
 * @param value - the raw row to decode.
 * @returns the decoded lineage edge.
 */
export function decodeLineageRow(value: unknown): LineageEdge {
  const row = record(value, 'stored lineage edge')
  return {
    assetId: AssetId(nonemptyStringField(row, 'asset_id')),
    parentId: AssetId(nonemptyStringField(row, 'parent_id')),
    roleId: RoleId(nonemptyStringField(row, 'role_id')),
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
  }
}

/**
 * Decode one validated ticket row into an ApprovalTicket.
 * @param value - the raw row to decode.
 * @returns the decoded approval ticket.
 */
export function decodeTicketRow(value: unknown): ApprovalTicket {
  const row = record(value, 'stored approval ticket')
  const scope = nullableStringField(row, 'review_scope')
  return {
    id: TicketId(nonemptyStringField(row, 'ticket_id')),
    workspaceId: WorkspaceId(nonemptyStringField(row, 'workspace_id')),
    subjectKind: assetKindField(nonemptyStringField(row, 'subject_kind')),
    subjectId: AssetId(nonemptyStringField(row, 'subject_id')),
    status: businessStatusField(nonemptyStringField(row, 'status')),
    actorUserId: UserId(nonemptyStringField(row, 'actor_user_id')),
    reviewScope: scope === null ? null : decodeReviewScope(scope),
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
    updatedAt: nonnegativeSafeIntegerField(row, 'updated_at'),
  }
}

/**
 * Decode one validated transition row into an ApprovalTransition.
 * @param value - the raw row to decode.
 * @returns the decoded approval transition.
 */
export function decodeTransitionRow(value: unknown): ApprovalTransition {
  const row = record(value, 'stored approval transition')
  return {
    ticketId: TicketId(nonemptyStringField(row, 'ticket_id')),
    from: nullableBusinessStatusField(nullableStringField(row, 'from_status')),
    to: businessStatusField(nonemptyStringField(row, 'to_status')),
    actorUserId: UserId(nonemptyStringField(row, 'actor_user_id')),
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
  }
}

/**
 * Decode one validated audit row into an AuditEvent.
 * @param value - the raw row to decode.
 * @returns the decoded audit event.
 */
export function decodeAuditRow(value: unknown): AuditEvent {
  const row = record(value, 'stored audit event')
  return {
    id: AuditEventId(String(nonnegativeSafeIntegerField(row, 'event_id'))),
    actorUserId: UserId(nonemptyStringField(row, 'actor_user_id')),
    workspaceId: nullableWorkspaceField(nullableStringField(row, 'workspace_id')),
    action: nonemptyStringField(row, 'action'),
    targetKind: nullableStringField(row, 'target_kind'),
    targetId: nullableStringField(row, 'target_id'),
    detail: nullableStringField(row, 'detail'),
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
  }
}

/**
 * Decode one validated capability row into a CapabilityRecord.
 * @param value - the raw row to decode.
 * @param tools - the tool surface the capability's gate governs (the owning
 * query supplies it from the capability_tools table; a lone row decodes empty).
 * @returns the decoded capability record.
 */
export function decodeCapabilityRow(value: unknown, tools: readonly string[] = []): CapabilityRecord {
  const row = record(value, 'stored capability')
  return {
    id: CapabilityId(nonemptyStringField(row, 'capability_id')),
    name: nonemptyStringField(row, 'name'),
    roleId: RoleId(nonemptyStringField(row, 'role_id')),
    execution: executionModeField(nonemptyStringField(row, 'execution')),
    version: nonemptyStringField(row, 'version'),
    enabled: booleanField(integerField(row, 'enabled')),
    rollout: rolloutField(numberField(row, 'rollout')),
    rate: nonnegativeIntegerField(row, 'rate'),
    description: stringField(row, 'description'),
    tools,
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
  }
}

/**
 * Decode one validated capability dependency row into a CapabilityDependency.
 * @param value - the raw row to decode.
 * @returns the decoded capability dependency.
 */
export function decodeCapabilityDependencyRow(value: unknown): CapabilityDependency {
  const row = record(value, 'stored capability dependency')
  return {
    id: CapabilityId(nonemptyStringField(row, 'depends_on')),
    range: nullableStringField(row, 'range'),
  }
}

/**
 * Decode one validated scenario row into a ScenarioBundle (without capability ids).
 * @param value - the raw row to decode.
 * @returns the decoded scenario bundle.
 */
export function decodeScenarioRow(value: unknown): ScenarioBundle {
  const row = record(value, 'stored scenario bundle')
  return {
    id: ScenarioId(nonemptyStringField(row, 'scenario_id')),
    name: nonemptyStringField(row, 'name'),
    workbenchId: nonemptyStringField(row, 'workbench_id'),
    roleId: RoleId(nonemptyStringField(row, 'role_id')),
    preset: nonemptyStringField(row, 'preset'),
    capabilityIds: [],
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
  }
}

/**
 * Decode one validated account row into an AccountRecord.
 * @param value - the raw row to decode.
 * @returns the decoded account record.
 */
export function decodeAccountRow(value: unknown): AccountRecord {
  const row = record(value, 'stored account')
  return {
    workspaceId: WorkspaceId(nonemptyStringField(row, 'workspace_id')),
    balance: nonnegativeIntegerField(row, 'balance'),
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
  }
}

/**
 * Decode one validated usage row into a UsageRecord.
 * @param value - the raw row to decode.
 * @returns the decoded usage record.
 */
export function decodeUsageRecordRow(value: unknown): UsageRecord {
  const row = record(value, 'stored usage record')
  return {
    id: UsageRecordId(nonemptyStringField(row, 'usage_id')),
    workspaceId: WorkspaceId(nonemptyStringField(row, 'workspace_id')),
    capabilityId: CapabilityId(nonemptyStringField(row, 'capability_id')),
    qty: positiveIntegerField(row, 'qty'),
    cost: nonnegativeIntegerField(row, 'cost'),
    billedAt: nonnegativeSafeIntegerField(row, 'billed_at'),
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
  }
}

/**
 * Decode one validated settlement row into a SettlementRecord.
 * @param value - the raw row to decode.
 * @returns the decoded settlement record.
 */
export function decodeSettlementRow(value: unknown): SettlementRecord {
  const row = record(value, 'stored settlement')
  return {
    id: SettlementId(nonemptyStringField(row, 'settlement_id')),
    workspaceId: WorkspaceId(nonemptyStringField(row, 'workspace_id')),
    period: nonemptyStringField(row, 'period'),
    amount: nonnegativeIntegerField(row, 'amount'),
    status: settlementStatusField(nonemptyStringField(row, 'status')),
    createdAt: nonnegativeSafeIntegerField(row, 'created_at'),
    settledAt: nullableNonnegativeSafeIntegerField(row, 'settled_at'),
  }
}

/** Decode the JSON review scope column into a ReviewScope. */
function decodeReviewScope(value: string): ReviewScope {
  try {
    const parsed = JSON.parse(value) as {
      roles?: unknown
      workspace?: unknown
      expiresAt?: unknown
    }
    if (!Array.isArray(parsed.roles) || typeof parsed.workspace !== 'string' || !Number.isSafeInteger(parsed.expiresAt)) {
      throw new PlatformShellError('INVALID_ARGUMENT', 'stored review_scope must be { roles: string[], workspace: string, expiresAt: integer }')
    }
    return {
      roles: parsed.roles.map(role => RoleId(role as string)),
      workspace: WorkspaceId(parsed.workspace),
      expiresAt: parsed.expiresAt as number,
    }
  } catch (error: unknown) {
    if (error instanceof PlatformShellError) throw error
    throw new PlatformShellError('INVALID_ARGUMENT', 'stored review_scope must be valid JSON')
  }
}

function assetKindField(value: string): AssetRecord['kind'] {
  if (value !== 'requirement' && value !== 'design' && value !== 'code' && value !== 'test-case' && value !== 'handoff') {
    throw new PlatformShellError('INVALID_ARGUMENT', `stored asset kind "${value}" is not a known kind`)
  }
  return value
}

function businessStatusField(value: string): BusinessApprovalStatus {
  if (value !== 'draft' && value !== 'review' && value !== 'approved' && value !== 'rejected' && value !== 'released') {
    throw new PlatformShellError('INVALID_ARGUMENT', `stored status "${value}" is not a business approval status`)
  }
  return value
}

function nullableBusinessStatusField(value: string | null): BusinessApprovalStatus | null {
  return value === null ? null : businessStatusField(value)
}

function nullableWorkspaceField(value: string | null): WorkspaceId | null {
  return value === null ? null : WorkspaceId(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function stringField(value: unknown, key: string): string {
  const field = record(value, 'SQLite row')[key]
  if (typeof field !== 'string') throw new Error(`stored ${key} must be a string`)
  return field
}

function nonemptyStringField(value: unknown, key: string): string {
  const field = stringField(value, key)
  if (field.length === 0) throw new Error(`stored ${key} must not be empty`)
  return field
}

function nullableStringField(value: unknown, key: string): string | null {
  const field = record(value, 'SQLite row')[key]
  if (field === null) return null
  if (typeof field !== 'string') throw new Error(`stored ${key} must be a string or null`)
  return field
}

function integerField(value: unknown, key: string): number {
  const field = record(value, 'SQLite row')[key]
  if (!Number.isSafeInteger(field)) throw new Error(`stored ${key} must be a safe integer`)
  return field as number
}

function nonnegativeSafeIntegerField(value: unknown, key: string): number {
  const field = integerField(value, key)
  if (field < 0) throw new Error(`stored ${key} must be non-negative`)
  return field
}

function nullableNonnegativeSafeIntegerField(value: unknown, key: string): number | null {
  const field = record(value, 'SQLite row')[key]
  if (field === null) return null
  const parsed = integerField(value, key)
  if (parsed < 0) throw new Error(`stored ${key} must be non-negative`)
  return parsed
}

function numberField(value: unknown, key: string): number {
  const field = record(value, 'SQLite row')[key]
  if (typeof field !== 'number') throw new Error(`stored ${key} must be a number`)
  return field
}

function nonnegativeIntegerField(value: unknown, key: string): number {
  const field = integerField(value, key)
  if (field < 0) throw new Error(`stored ${key} must be a non-negative integer`)
  return field
}

function positiveIntegerField(value: unknown, key: string): number {
  const field = integerField(value, key)
  if (field < 1) throw new Error(`stored ${key} must be a positive integer`)
  return field
}

function booleanField(value: number): boolean {
  if (value !== 0 && value !== 1) throw new Error(`stored boolean must be 0 or 1, got ${value}`)
  return value === 1
}

function rolloutField(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`stored rollout must be within 0..1, got ${value}`)
  }
  return value
}

function executionModeField(value: string): ExecutionMode {
  if (value !== 'managed' && value !== 'sandboxed' && value !== 'none') {
    throw new PlatformShellError('INVALID_ARGUMENT', `stored execution mode "${value}" is not a known mode`)
  }
  return value
}

function settlementStatusField(value: string): SettlementStatus {
  if (value !== 'open' && value !== 'settled') {
    throw new PlatformShellError('INVALID_ARGUMENT', `stored settlement status "${value}" is not a settlement status`)
  }
  return value
}
