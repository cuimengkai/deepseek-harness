/**
 * Closed, package-owned SQL resource loading for the platform control-plane store.
 * @module @deepseek-ai/dsh-experimental-platform-shell/sql
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SQL_RESOURCES = [
  'begin',
  'begin-immediate',
  'commit',
  'delete-user',
  'foreign-keys-on',
  'insert-asset',
  'insert-audit',
  'insert-lineage',
  'insert-member',
  'insert-role',
  'insert-role-permission',
  'insert-ticket',
  'insert-transition',
  'insert-user',
  'insert-workspace',
  'journal-mode-delete',
  'journal-mode-persist',
  'journal-mode-truncate',
  'journal-mode-wal',
  'mmap-off',
  'rollback',
  'schema',
  'select-application-id',
  'select-asset',
  'select-asset-ids',
  'select-assets-by-workspace',
  'select-audit',
  'select-audit-by-action',
  'select-audit-by-workspace',
  'select-audit-by-workspace-action',
  'select-journal-mode',
  'select-lineage-children',
  'select-lineage-parents',
  'select-member-workspaces',
  'select-membership',
  'select-mmap-size',
  'select-role-permissions',
  'select-schema-objects',
  'select-synchronous',
  'select-ticket',
  'select-ticket-ids',
  'select-tickets-by-workspace',
  'select-transitions',
  'select-trusted-schema',
  'select-user',
  'select-user-object-count',
  'select-user-version',
  'select-users',
  'select-workspace',
  'set-application-id',
  'set-user-version-1',
  'synchronous-full',
  'trusted-schema-off',
  'update-ticket',
] as const

/** A resource basename selected exclusively by package code. */
export type SqlResourceName = typeof SQL_RESOURCES[number]

const cache = new Map<SqlResourceName, string>()

/**
 * Load an immutable SQL statement by closed resource name.
 * @param name - package-owned resource basename.
 * @returns the resource text.
 */
export function sql(name: SqlResourceName): string {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const statement = readFileSync(
    fileURLToPath(new URL(`../resources/sql/${name}.sql`, import.meta.url)),
    'utf8',
  )
  cache.set(name, statement)
  return statement
}
