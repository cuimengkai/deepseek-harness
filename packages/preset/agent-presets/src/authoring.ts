/**
 * Copying, reading, and deleting locally authored presets.
 *
 * Authoring is confined to a `user` root: the shipped `.system` set is part of
 * the deployment, and letting a browser rewrite it would turn "reset to a known
 * preset" into something the same caller could have broken first.
 *
 * The only authoring writes are a whole-directory copy of an existing preset
 * and a rows-based write. A copy's inputs are ids the host resolves against its
 * own roots plus an optional display name, so copying grants no capability the
 * copied preset did not already carry. `writeComposition` is the one sanctioned
 * exception to "no caller supplies composition text": the platform preset
 * assembler renders a validated tree and commits it through this primitive,
 * which owns id validation, occupancy refusal, mode tightening, and atomic
 * writes.
 * @module @deepseek-ai/dsh-agent-presets/authoring
 */

import { chmod, cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import * as yaml from 'js-yaml'
import { COMPOSITION_FILE } from './discovery.ts'
import { METADATA_FILE, renderPresetMetadata, type PresetMetadata } from './metadata.ts'
import { PRESET_ID, type AgentPreset, type PresetRoot } from './preset.ts'

/** A preset id that cannot be used as a directory name under a root. */
export class InvalidPresetIdError extends Error {
  constructor(
    /** The rejected id. */
    readonly presetId: string,
  ) {
    super(
      `agent-presets: preset id ${JSON.stringify(presetId)} must match ${String(PRESET_ID)} — `
      + 'the id is a directory name, so anything else could escape the preset root',
    )
  }
}

/** A copy target that is already occupied — a copy never overwrites. */
export class PresetExistsError extends Error {
  constructor(
    /** The id that is already taken. */
    readonly presetId: string,
  ) {
    super(
      `agent-presets: preset "${presetId}" already exists — `
      + 'a copy never overwrites; delete the existing preset first or choose another id',
    )
  }
}

/** Authoring was attempted where the deployment allows none. */
export class PresetNotWritableError extends Error {
  constructor(
    /** What the caller tried to change, for the diagnostic. */
    readonly presetId: string,
    reason: string,
  ) {
    super(`agent-presets: preset "${presetId}" cannot be written: ${reason}`)
  }
}

/**
 * A composition named a module the deployment does not have installed.
 * Raised by `compose` when the caller's resolvability proof fails: the
 * composer may only assemble agents from plugins actually present, so a
 * browser payload can never grant a capability the deployment does not carry.
 */
export class ComposeModuleError extends Error {
  constructor(
    /** The preset being composed. */
    readonly presetId: string,
    /** The module names the composition referenced that are not installed. */
    readonly unresolved: readonly string[],
  ) {
    super(
      `agent-presets: preset "${presetId}" references uninstalled modules: `
      + `${unresolved.map(name => JSON.stringify(name)).join(', ')}`,
    )
  }
}

/**
 * The root locally authored presets are written to.
 * @param roots - the configured roots in precedence order.
 * @returns the absolute path of the first `user` root.
 * @throws when the deployment configured no writable root.
 */
export function writableRoot(roots: readonly PresetRoot[]): string {
  const root = roots.find(candidate => candidate.trust === 'user')
  if (root === undefined) {
    throw new PresetNotWritableError('', 'this deployment configures no user-writable preset root')
  }
  return resolve(expandHomePath(root.path))
}

/**
 * Read one preset's composition text.
 * @param preset - the resolved preset.
 * @returns the file's contents.
 */
export async function readComposition(preset: AgentPreset): Promise<string> {
  return await readFile(preset.path, 'utf8')
}

/** Whether anything occupies the path (cp's own errorOnExist backstops races). */
async function occupied(path: string): Promise<boolean> {
  let present = true
  try {
    await stat(path)
  } catch {
    // Every stat failure means the same thing here: nothing usable occupies
    // the path, so the copy may claim it.
    present = false
  }
  return present
}

/**
 * Re-tighten a copied tree to owner-only. A shipped preset is world-readable
 * in its install and `cp` preserves that; the copy carries the same weight as
 * the settings document beside it, so group/other access is stripped. A
 * file's owner-execute bit survives — a preset may ship runnable helpers.
 */
async function tightenModes(dir: string): Promise<void> {
  await chmod(dir, 0o700)
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) {
      await tightenModes(target)
    } else {
      /* v8 ignore next -- Windows exposes no POSIX owner-execute bit; the POSIX lane covers both file modes. */
      await chmod(target, ((await stat(target)).mode & 0o100) === 0 ? 0o600 : 0o700)
    }
  }
}

/**
 * Create a preset by copying an existing one's whole directory.
 *
 * The copy carries everything the source directory holds — composition,
 * metadata, skill directories, assets — because a preset is its directory,
 * not one file. Symlinks are dereferenced so the copy is self-contained
 * rather than a set of links back into the install it was copied from.
 *
 * The copied metadata is then rewritten: the source's description is kept
 * (the file is the author's to edit afterwards), but its name and roster
 * `order` are not — a copy presenting itself identically to its source, or
 * sorted into the shipped set's declared order, would make the roster stop
 * distinguishing them. With no name given and no description to keep, the
 * file is removed so the copy publishes nothing rather than a blank.
 * @param roots - the configured roots; the first `user` one receives the copy.
 * @param source - the resolved preset the copy starts from.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; omitted falls back to the id.
 * @returns the absolute path of the new preset directory.
 * @throws when the id is unusable or already occupied on disk, or the
 * deployment configures no writable root.
 */
export async function copyComposition(
  roots: readonly PresetRoot[],
  source: AgentPreset,
  id: string,
  name?: string,
): Promise<string> {
  if (!PRESET_ID.test(id)) throw new InvalidPresetIdError(id)
  const dir = join(writableRoot(roots), id)
  // The roster check upstream only sees discovered presets; a directory with
  // no composition file still occupies the name and deserves a readable
  // refusal rather than a filesystem error code.
  if (await occupied(dir)) throw new PresetExistsError(id)
  try {
    await cp(dirname(source.path), dir, {
      recursive: true, dereference: true, force: false, errorOnExist: true,
    })
    await tightenModes(dir)
    const rendered = renderPresetMetadata({
      ...name === undefined ? {} : { name },
      ...source.description === undefined ? {} : { description: source.description },
    })
    const metadataPath = join(dir, METADATA_FILE)
    if (rendered === undefined) {
      await rm(metadataPath, { force: true })
    } else {
      await writeFileAtomic(metadataPath, rendered, { mode: 0o600, dirMode: 0o700 })
    }
  } catch (error) {
    // A half-copied directory would be invisible to discovery at best and a
    // mountable-but-incomplete preset at worst; a failed copy leaves nothing.
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return dir
}

/**
 * Write one preset's composition and display metadata from rows.
 *
 * This is the sanctioned relaxation of the "no caller supplies composition
 * text" boundary: the platform preset assembler renders a validated tree and
 * commits it through this primitive, which owns id validation, occupancy
 * refusal, mode tightening, and atomic writes exactly as a copy does. The
 * composition is dumped with the entry-list YAML dialect, so a `!!js` row
 * (e.g. a platform-conditional `disabled`) round-trips as the expression the
 * Loader evaluates. Absent metadata publishes no file, mirroring a copy that
 * has nothing to say.
 * @param root - the writable root's resolved path.
 * @param id - the new preset's id, which becomes its directory name.
 * @param rows - the composition rows to persist.
 * @param meta - display metadata to publish beside the composition.
 * @returns the absolute path of the new preset directory.
 * @throws when the id is unusable or already occupied on disk.
 */
export async function writeComposition(
  root: string,
  id: string,
  rows: readonly EntryOptions[],
  meta?: PresetMetadata,
): Promise<string> {
  if (!PRESET_ID.test(id)) throw new InvalidPresetIdError(id)
  const dir = join(root, id)
  if (await occupied(dir)) throw new PresetExistsError(id)
  try {
    await mkdir(dir, { mode: 0o700 })
    await writeFileAtomic(
      join(dir, COMPOSITION_FILE),
      yaml.dump([...rows], { schema: entryListSchema, lineWidth: -1 }),
      { mode: 0o600, dirMode: 0o700 },
    )
    const rendered = renderPresetMetadata(meta ?? {})
    if (rendered !== undefined) {
      await writeFileAtomic(join(dir, METADATA_FILE), rendered, { mode: 0o600, dirMode: 0o700 })
    }
    await tightenModes(dir)
  } catch (error) {
    // A half-written directory would be invisible to discovery at best and a
    // mountable-but-incomplete preset at worst; a failed write leaves nothing.
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return dir
}

/**
 * Replace one locally authored preset's composition and metadata in place.
 *
 * The overwrite half of the rows authoring boundary. `writeComposition`
 * creates a preset and refuses an occupied id; this primitive re-renders an
 * existing preset's files atomically, skipping the `occupied` refusal so an
 * existing directory is updated rather than refused. Only the composition and
 * display metadata are rewritten — the directory's other contents (skills,
 * assets) are left alone, and a failed atomic write leaves the prior file
 * intact rather than a half-preset. The caller (the service's `compose`) owns
 * the trust and existence checks that decide overwrite vs create.
 * @param root - the writable root's resolved path.
 * @param id - the preset id, whose directory already exists.
 * @param rows - the composition rows to persist.
 * @param meta - display metadata to publish beside the composition.
 * @returns the absolute path of the preset directory.
 * @throws when the id is unusable.
 */
export async function replaceComposition(
  root: string,
  id: string,
  rows: readonly EntryOptions[],
  meta?: PresetMetadata,
): Promise<string> {
  if (!PRESET_ID.test(id)) throw new InvalidPresetIdError(id)
  const dir = join(root, id)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFileAtomic(
    join(dir, COMPOSITION_FILE),
    yaml.dump([...rows], { schema: entryListSchema, lineWidth: -1 }),
    { mode: 0o600, dirMode: 0o700 },
  )
  const rendered = renderPresetMetadata(meta ?? {})
  const metadataPath = join(dir, METADATA_FILE)
  if (rendered === undefined) {
    await rm(metadataPath, { force: true })
  } else {
    await writeFileAtomic(metadataPath, rendered, { mode: 0o600, dirMode: 0o700 })
  }
  await tightenModes(dir)
  return dir
}

/**
 * Parse a preset's composition text into its entry list.
 *
 * Read with the loader's own YAML dialect ({@link entryListSchema}, the one
 * carrying `!!js`), so a composition that mounts parses here exactly as the
 * Loader reads it — a `!!js` `disabled` row round-trips as the evaluable
 * expression. The composer reads rows this way so the browser never parses
 * YAML: the wire carries structured rows instead of text.
 * @param content - the composition file's contents.
 * @returns the parsed entry list.
 * @throws when the composition is not a top-level list of plugin rows.
 */
export function parseComposition(content: string): EntryOptions[] {
  const rows = yaml.load(content, { schema: entryListSchema })
  if (!Array.isArray(rows)) {
    throw new Error('agent-presets: the composition is not a top-level list of plugin rows')
  }
  return rows as EntryOptions[]
}

/**
 * Delete a locally authored preset.
 *
 * A shipped preset is refused: it belongs to the deployment. A preset a live
 * session mounted is NOT refused — the composition was read at creation and is
 * never re-read, so that session keeps running exactly as it was.
 * @param roots - the configured roots.
 * @param preset - the resolved preset to remove.
 * @throws when the preset ships with the deployment or lies outside the writable root.
 */
export async function deleteComposition(
  roots: readonly PresetRoot[],
  preset: AgentPreset,
): Promise<void> {
  if (preset.trust !== 'user') {
    throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
  }
  const dir = join(writableRoot(roots), preset.id)
  // Belt and braces over the id pattern: the resolved directory must still be
  // the one the writable root owns, whatever discovery reported.
  if (!isAbsolute(preset.path) || !preset.path.startsWith(dir)) {
    throw new PresetNotWritableError(preset.id, 'it does not live under the writable preset root')
  }
  await rm(dir, { recursive: true, force: true })
}
