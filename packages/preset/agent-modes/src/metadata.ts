/**
 * A mode's display metadata: the name and description a picker shows.
 *
 * Lives in `mode.yml` beside the bind file so display text never mixes with
 * the bind contract. Every read failure degrades to empty metadata — a broken
 * name must never become a mode that cannot start.
 * @module @deepseek-ai/dsh-agent-modes/metadata
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'

/** The optional display-metadata file beside a mode's bind. */
export const METADATA_FILE = 'mode.yml'

/** Display text a mode may publish about itself. */
export interface ModeMetadata {
  /** Human-facing name; falls back to the mode id when absent. */
  readonly name?: string
  /** One sentence on what this mode is for. */
  readonly description?: string
  /**
   * Position within its group; lower comes first. A mode that declares none
   * sorts after every mode that does, then by id.
   */
  readonly order?: number
}

/** A non-empty trimmed string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read one mode directory's display metadata.
 * @param directory - the mode directory.
 * @returns the display text the mode published, possibly empty.
 */
export async function readModeMetadata(directory: string): Promise<ModeMetadata> {
  let raw: string
  try {
    raw = await readFile(join(directory, METADATA_FILE), 'utf8')
  } catch {
    // Absent is the common case: metadata is optional.
    return {}
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    // Malformed display text is not worth failing discovery over.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const record = parsed as Record<string, unknown>
  const name = text(record.name)
  const description = text(record.description)
  const order = typeof record.order === 'number' && Number.isFinite(record.order)
    ? record.order
    : undefined
  return {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
  }
}

/**
 * Render display metadata as the file's contents.
 * @param metadata - the display text to store.
 * @returns the YAML document, or undefined when there is nothing to store.
 */
export function renderModeMetadata(metadata: ModeMetadata): string | undefined {
  const name = text(metadata.name)
  const description = text(metadata.description)
  const { order } = metadata
  if (name === undefined && description === undefined && order === undefined) return undefined
  return yaml.dump({
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
  }, { lineWidth: -1 })
}
