/**
 * Root discovery, root-relative path projection, and path-alias resolution.
 * The scanner reads a project tree through these helpers so the committed
 * document never leaks an absolute path and import edges resolve against the
 * project's own aliases (the `@ → src` mapping a Vite/Vue or webpack project
 * declares in `tsconfig.json`).
 * @module @deepseek-ai/dsh-project-insight/paths
 */

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Directory entries that identify a project root while walking upward. */
const DEFAULT_ROOT_MARKERS = ['.git', 'package.json', 'pnpm-workspace.yaml', '.project-root'] as const

/** One resolved path alias: specifier prefix and its root-relative base dir. */
export interface PathAlias {
  /** Specifier prefix, e.g. `@` (from a `@/*` tsconfig path). */
  readonly key: string
  /** Root-relative base directory, e.g. `src`. */
  readonly value: string
}

/**
 * Walk upward to the first directory containing a configured root marker.
 * @param cwd - absolute session working directory where the walk begins.
 * @param markers - child names that identify a project root.
 * @returns the discovered project root, or `cwd` when no marker exists.
 */
export async function findProjectRoot(
  cwd: string,
  markers: readonly string[] = DEFAULT_ROOT_MARKERS,
): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    for (const marker of markers) {
      if (await exists(join(current, marker))) return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

/**
 * Convert an absolute path to its project-root-relative display form with `/`
 * separators, so the document is portable across hosts.
 * @param root - project root used as the display base.
 * @param path - absolute path to display.
 * @returns the root-relative path.
 */
export function relativeDisplay(root: string, path: string): string {
  const rel = relative(root, path)
  return sep === '\\' ? rel.split('\\').join('/') : rel
}

/**
 * Read the project's declared path aliases from `tsconfig.json`
 * `compilerOptions.paths`, keeping only entries that map into the project
 * itself. Best-effort: an unparsable or absent config yields no aliases, and
 * non-JSON variants (JSX configs) are deferred.
 * @param root - project root whose `tsconfig.json` to read.
 * @param maxBytes - UTF-8 byte cap for the config file.
 * @returns resolved aliases sorted by key.
 */
export async function readPathAliases(root: string, maxBytes: number): Promise<PathAlias[]> {
  const aliases: PathAlias[] = []
  let text: string
  try {
    const content = await readFile(join(root, 'tsconfig.json'), 'utf8')
    text = content
  } catch {
    return aliases
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return aliases
  let parsed: { compilerOptions?: { paths?: Record<string, string[]> } }
  try {
    parsed = JSON.parse(text) as { compilerOptions?: { paths?: Record<string, string[]> } }
  } catch {
    return aliases
  }
  const paths = parsed.compilerOptions?.paths
  if (paths === undefined) return aliases
  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets?.[0]
    if (target === undefined || !target.startsWith('.')) continue
    const key = stripWildcard(pattern)
    const value = stripWildcard(target).replace(/^\.\//, '')
    if (key !== '' && value !== '' && !isAbsolute(value)) aliases.push({ key, value })
  }
  aliases.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  return aliases
}

function stripWildcard(pattern: string): string {
  return pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern
}
