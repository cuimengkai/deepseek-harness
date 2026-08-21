/** Test-only loader for fixed platform control-plane fixtures. */

import { readFileSync } from 'node:fs'

export type TestSqlName =
  | 'add-unexpected-column'
  | 'add-unrelated-table'
  | 'corrupt-row-with-wrong-app-id'
  | 'create-unrelated-table'
  | 'set-user-version-99'
  | 'truncate-roles'

/** Load one fixed test SQL resource. */
export function testSql(name: TestSqlName): string {
  return readFileSync(new URL(`./resources/sql/${name}.sql`, import.meta.url), 'utf8')
}
