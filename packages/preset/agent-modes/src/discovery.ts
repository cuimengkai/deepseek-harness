/**
 * Filesystem discovery of agent modes. A mode is a directory holding
 * {@link BIND_FILE}, optionally beside {@link METADATA_FILE} and a `flows/`
 * tree. Discovery re-reads the roots on every call so a mode authored while
 * the process is running is visible without a restart.
 * @module @deepseek-ai/dsh-agent-modes/discovery
 */

import { readdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { BIND_FILE, readModeBind } from './bind.ts'
import { readModeMetadata } from './metadata.ts'
import { MODE_ID, type AgentMode, type ModeRoot } from './mode.ts'

/** Relative directory holding a mode's flow documents. */
export const FLOWS_DIR = 'flows'

/**
 * Harness-home directory holding locally authored modes.
 */
export const USER_MODE_DIR = '.agent-modes'

/**
 * The shipped modes, bundled inside this package.
 */
export const SHIPPED_MODE_ROOT = fileURLToPath(new URL('../modes/', import.meta.url))

/**
 * Scan one root for mode subdirectories.
 * @param root - the root to scan.
 * @returns every subdirectory that looks like a mode (healthy or broken).
 */
export async function scanRoot(root: ModeRoot): Promise<AgentMode[]> {
  const directory = expandHomePath(root.path)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }
  const modes: AgentMode[] = []
  for (const name of entries) {
    if (!MODE_ID.test(name)) continue
    const modeDir = join(directory, name)
    try {
      await access(join(modeDir, BIND_FILE))
    } catch {
      continue
    }
    const [metadata, bind] = await Promise.all([
      readModeMetadata(modeDir),
      readModeBind(modeDir),
    ])
    modes.push({
      id: name,
      trust: root.trust,
      directory: modeDir,
      ...metadata.name === undefined ? {} : { name: metadata.name },
      ...metadata.description === undefined ? {} : { description: metadata.description },
      ...metadata.order === undefined ? {} : { order: metadata.order },
      ...bind.ok ? {} : { broken: bind.reason },
    })
  }
  return modes
}

/**
 * Discover every mode across the configured roots. Earlier roots win a
 * duplicate id. Results sort by declared `order` ascending, then by id.
 * @param roots - roots in precedence order.
 * @returns the roster, first-root-wins per id.
 */
export async function discoverModes(roots: readonly ModeRoot[]): Promise<AgentMode[]> {
  const byId = new Map<string, AgentMode>()
  for (const root of roots) {
    for (const mode of await scanRoot(root)) {
      if (byId.has(mode.id)) continue
      byId.set(mode.id, mode)
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ao = a.order
    const bo = b.order
    if (ao !== undefined && bo !== undefined && ao !== bo) return ao - bo
    if (ao !== undefined && bo === undefined) return -1
    if (ao === undefined && bo !== undefined) return 1
    return a.id.localeCompare(b.id)
  })
}
