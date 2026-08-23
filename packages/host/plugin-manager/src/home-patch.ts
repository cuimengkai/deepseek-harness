/**
 * Read-modify-write of the home-level user patch layer
 * (`$DSH_HOME/cordis.patch.yml`): the machine-local patch list `dsh` applies
 * over every profile and keeps hot through Cordis HMR (see
 * `packages/boot/app-boot/src/index.ts` and `apps/cli/src/profile-boot.ts`).
 * Live plugin install/uninstall appends or removes a single managed `insert`
 * row here; the existing config watcher recomposes and the root Include mounts
 * or unmounts the fiber without a restart.
 * @module @deepseek-ai/dsh-host-plugin-manager/home-patch
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as yaml from 'js-yaml'
import { PROFILE_PATCH_FILENAME, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Diagnostic prefix on home-patch read/parse failures (this package is not a bin). */
const HOME_PATCH_BIN = 'dsh-host-plugin-manager'

/**
 * Absolute path of the home-level user patch layer. Resolved per call, not at
 * module load: `$DSH_HOME` may be set by the launcher or a test after import.
 * Mirrors `apps/cli/src/profile-boot.ts`.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/**
 * Read the home patch as the running Host parses it. A missing file is "no
 * layer" (`[]`); a present file that does not parse as a top-level patch array
 * throws, matching app boot, so install/uninstall never rewrite a file the
 * app itself would reject.
 * @returns the current patch rows.
 */
export function readHomePatchRows(): PatchOptions[] {
  return loadOptionalPatches(HOME_PATCH_BIN, homePatchPath()) ?? []
}

/**
 * Render patch rows back in the include's own YAML dialect, preserving `!!js`
 * expression nodes read through {@link entryListSchema}. A value that cannot
 * serialize throws here, aborting the write instead of clobbering the file.
 * @param rows - the complete next patch list.
 * @returns the YAML document to persist.
 */
export function renderPatchList(rows: readonly PatchOptions[]): string {
  return yaml.dump([...rows], { schema: entryListSchema, noRefs: true })
}

/** Business codes an {@link updateHomePatch} transform may decide. */
export type HomePatchRejectCode = 'already-installed' | 'not-installed' | 'not-managed'

/** What one locked home-patch mutation decided. */
export type HomePatchTransform<C extends HomePatchRejectCode = HomePatchRejectCode> =
  | { readonly applied: true; readonly rows: readonly PatchOptions[] }
  | { readonly applied: false; readonly code: C }

/**
 * Run one read-modify-write of the home patch atomically and under the
 * cross-process writer lock. The parent directory is created before the lock:
 * the lock sibling (`<file>.lock`) is opened `wx` and cannot be created when
 * the directory is missing. The transform runs inside the lock, so concurrent
 * writers re-read each other's committed rows before deciding.
 * @param transform - decides the next rows from the current ones; a rejected
 * transform writes nothing.
 * @returns what the transform decided.
 */
export async function updateHomePatch<C extends HomePatchRejectCode = HomePatchRejectCode>(
  transform: (rows: readonly PatchOptions[]) => HomePatchTransform<C>,
): Promise<HomePatchTransform<C>> {
  const path = homePatchPath()
  mkdirSync(dirname(path), { recursive: true })
  return withFileLock(path, async () => {
    const rows = readHomePatchRows()
    const result = transform(rows)
    if (result.applied) {
      await writeFileAtomic(path, renderPatchList(result.rows), { mode: 0o600, dirMode: 0o700 })
    }
    return result
  })
}

/**
 * The managed row id for one install: `dsh-managed-<slug>` with the leading
 * `@` stripped and every non-alphanumeric run folded to `-`. The `dsh-managed-`
 * prefix is the ownership marker uninstall matches before it touches a row, so
 * user-authored rows are never removed.
 * @param name - the module specifier.
 * @returns the managed row id.
 */
export function managedEntryId(name: string): string {
  const slug = name.replace(/^@/, '').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  return `dsh-managed-${slug}`
}

/**
 * Whether a home-patch row is the managed insert for `name`: an `insert` row
 * carrying exactly the managed entry id and the given module name. Anything
 * else (a user-authored bare `- name:` row, a different id, a different
 * module) is not managed and uninstall refuses it.
 * @param row - one patch row.
 * @param entryId - the managed id from {@link managedEntryId}.
 * @param name - the module specifier.
 * @returns true when the row is a managed insert for the pair.
 */
export function isManagedInsertFor(row: PatchOptions, entryId: string, name: string): boolean {
  return Array.isArray(row.insert) && row.insert.some(item => item.id === entryId && item.name === name)
}

/**
 * Module names a patch row declares, from its top-level `name` and every
 * `insert` item. Used to compute the catalog `installed` flag and to tell
 * `not-installed` (no row names the module) from `not-managed` (a row does,
 * but not as a managed insert).
 * @param row - one patch row.
 * @returns the declared module names.
 */
export function rowEntryNames(row: PatchOptions): string[] {
  const names: string[] = []
  if (typeof row.name === 'string') names.push(row.name)
  if (Array.isArray(row.insert)) {
    for (const item of row.insert) {
      if (typeof item.name === 'string') names.push(item.name)
    }
  }
  return names
}

/**
 * Set the `disabled` override on the row with the given bare id, replacing it
 * in place when present and appending a new `{ id, disabled }` row otherwise.
 * This is how a bundled spine plugin is "uninstalled" (persisted `disabled:
 * true`, which the top layer wins) and reinstalled (`disabled: false`); patches
 * cannot delete rows, so enablement is the only reversible switch.
 * @param rows - the current home-patch rows.
 * @param id - the bare Loader entry id the patch row targets.
 * @param disabled - the enablement override to persist.
 * @returns the next patch list with the override settled.
 */
export function upsertDisabledOverride(
  rows: readonly PatchOptions[],
  id: string,
  disabled: boolean,
): PatchOptions[] {
  const next = [...rows]
  const index = next.findIndex(row => row.id === id)
  const existing = next[index]
  if (existing === undefined) {
    next.push({ id, disabled })
  } else {
    next[index] = { ...existing, disabled }
  }
  return next
}
