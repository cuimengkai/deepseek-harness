/**
 * Preset assembler: render + validate-before-commit for workbench preset trees.
 * A role's base rows are appended with the selected capabilities' D5 preset
 * fragments in dependency-first catalog order, then overlaid with optional
 * per-capability patches. The rendered tree is statically validated before it
 * reaches the roster: duplicate row ids and shadowed tool names are rejected by
 * the caller; rows disabled for the current platform are reported, not rejected.
 * Loader-level checks (`inactiveRows` / `leakedServices`) stay at roster mount
 * (platform-preset-assembler §3, platform-capability-market §5).
 * @module @deepseek-ai/dsh-experimental-platform-shell/preset-assembler
 */

import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { CapabilityRecord } from './types.ts'
import type { PresetValidationReport } from './types.ts'

/**
 * Render one workbench preset tree from a role's base rows and a resolved
 * capability set. Deterministic: the base order is preserved, capability rows
 * append in `resolveSelection`'s dependency-first order, and the optional
 * overlay patches apply through `applyEntryPatches` (detached result, id-targeted
 * overrides, skipped-patch warnings). Rows carrying `!!js` expression nodes
 * survive the structured-clone + JSON round-trip, so a row's `disabled`/`config`
 * stays evaluable after the store round-trip.
 * @param base - the role's base preset rows (host-supplied, never read here).
 * @param resolved - the resolved capability records in dependency-first order.
 * @param patches - optional overlay patches for per-capability options/context.
 * @param warn - sink for skipped-patch diagnostics (printf-style, `%C` = code).
 * @returns the rendered preset tree.
 */
export function renderPresetTree(
  base: readonly EntryOptions[],
  resolved: readonly CapabilityRecord[],
  patches: readonly PatchOptions[] | undefined,
  warn: (message: string, ...args: unknown[]) => void,
): EntryOptions[] {
  const capabilityRows = resolved.flatMap(capability => capability.rows)
  const combined = [...structuredClone(base), ...capabilityRows]
  // The include API takes a mutable patch list; a spread copies the readonly
  // input so a caller-owned array is never re-typed, and applyEntryPatches
  // detaches the result from both inputs regardless.
  return applyEntryPatches(combined, patches ? [...patches] : undefined, warn)
}

/**
 * The tool names owned by more than one resolved capability (empty when none).
 * The catalog's `capability_tools` primary key is `(capability_id, tool_name)`
 * with no global uniqueness, and the gate's owner read is `LIMIT 1` without
 * `ORDER BY`, so a shadowed tool name has a non-deterministic owner — the caller
 * rejects on a non-empty result with `TOOL_NAME_CONFLICT`.
 * @param resolved - the resolved capability records in dependency-first order.
 * @returns the shadowed tool names in first-seen order.
 */
export function assertNoToolShadowing(resolved: readonly CapabilityRecord[]): readonly string[] {
  const owners = new Map<string, string[]>()
  for (const capability of resolved) {
    for (const toolName of capability.tools) {
      const list = owners.get(toolName) ?? []
      list.push(capability.id)
      owners.set(toolName, list)
    }
  }
  return [...owners.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([toolName]) => toolName)
}

/**
 * Validate the row level of one rendered preset tree: duplicate top-level row
 * ids (rejected by the caller with `ROW_ID_CONFLICT`) and rows disabled for the
 * current platform via a `!!js process.platform === '<platform>'` expression
 * (reported, not rejected). Tool-name shadowing is checked separately over the
 * resolved capability records, so this report omits that field.
 * @param rows - the rendered preset tree to validate.
 * @param platform - the platform (`process.platform`) the tree runs on.
 * @returns the row-level validation report.
 */
export function validatePresetTree(
  rows: readonly EntryOptions[],
  platform: string,
): Pick<PresetValidationReport, 'rowIdConflicts' | 'disabledOnPlatform'> {
  const seen = new Set<string>()
  const conflicts = new Set<string>()
  const disabledOnPlatform: string[] = []
  for (const row of rows) {
    if (row.id) {
      if (seen.has(row.id)) conflicts.add(row.id)
      seen.add(row.id)
    }
    if (isPlatformDisabled(row, platform)) disabledOnPlatform.push(row.id)
  }
  return { rowIdConflicts: [...conflicts], disabledOnPlatform }
}

/**
 * Whether one row is disabled for a platform by the literal
 * `!!js process.platform === '<platform>'` expression. The store round-trip
 * keeps the node as a plain `{ __jsExpr }` object, matching the loader's
 * `isJsExpr` check.
 * @param row - the preset row to test.
 * @param platform - the platform (`process.platform`) to test against.
 * @returns whether the row is disabled for the platform.
 */
function isPlatformDisabled(row: EntryOptions, platform: string): boolean {
  const disabled: unknown = row.disabled
  if (typeof disabled !== 'object' || disabled === null || !('__jsExpr' in disabled)) return false
  const expression = (disabled as { __jsExpr: string }).__jsExpr
  return expression === `process.platform === '${platform}'`
}
