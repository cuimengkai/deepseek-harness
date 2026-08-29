/**
 * A mode's bind contract: which agent preset and entry flow it runs.
 *
 * Lives in `bind.yml` so the display metadata file stays presentation-only.
 * A missing or malformed bind marks the mode broken at discovery time.
 * @module @deepseek-ai/dsh-agent-modes/bind
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** The bind file that makes a directory a mode. */
export const BIND_FILE = 'bind.yml'

/** The resolved bind a healthy mode carries. */
export interface ModeBind {
  /** Agent preset id the session mounts. */
  readonly preset: string
  /** Entry flow id under this mode's `flows/` directory. */
  readonly entryFlow: string
  /** Optional default args passed to `flowEngine.run` when the entry flow starts. */
  readonly defaultArgs?: JsonValue
}

/**
 * Why a bind document cannot be used, or undefined when it can.
 * @param parsed - the parsed YAML document.
 * @returns one human-readable reason, or undefined when the bind holds.
 */
export function bindProblem(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'bind.yml must be a YAML map'
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.preset !== 'string' || record.preset.trim() === '') {
    return 'bind.yml requires a non-empty string "preset"'
  }
  if (typeof record.entryFlow !== 'string' || record.entryFlow.trim() === '') {
    return 'bind.yml requires a non-empty string "entryFlow"'
  }
  if (record.defaultArgs !== undefined
    && (typeof record.defaultArgs !== 'object' || record.defaultArgs === null)) {
    return 'bind.yml "defaultArgs" must be a JSON object when present'
  }
  return undefined
}

/**
 * Read and validate one mode directory's bind.
 * @param directory - the mode directory.
 * @returns the bind, or a reason string when the bind cannot be used.
 */
export async function readModeBind(
  directory: string,
): Promise<{ ok: true; bind: ModeBind } | { ok: false; reason: string }> {
  let raw: string
  try {
    raw = await readFile(join(directory, BIND_FILE), 'utf8')
  } catch {
    return { ok: false, reason: `missing ${BIND_FILE}` }
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (error) {
    return {
      ok: false,
      reason: `unparseable ${BIND_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const problem = bindProblem(parsed)
  if (problem !== undefined) return { ok: false, reason: problem }
  const record = parsed as Record<string, unknown>
  return {
    ok: true,
    bind: {
      preset: (record.preset as string).trim(),
      entryFlow: (record.entryFlow as string).trim(),
      ...record.defaultArgs === undefined
        ? {}
        : { defaultArgs: record.defaultArgs as JsonValue },
    },
  }
}

/**
 * Render a bind as the file's contents.
 * @param bind - the bind to store.
 * @returns the YAML document.
 */
export function renderModeBind(bind: ModeBind): string {
  return yaml.dump({
    preset: bind.preset,
    entryFlow: bind.entryFlow,
    ...bind.defaultArgs === undefined ? {} : { defaultArgs: bind.defaultArgs },
  }, { lineWidth: -1 })
}
