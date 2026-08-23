/**
 * Bounded, deterministic traversal of a project tree. The walk is the shared
 * file projection both the content fingerprint and the scanner use, so they
 * see the same bounded file set: ignored directories are never descended,
 * entries are visited in sorted name order, and the walk stops at a hard file
 * cap so a pathological tree cannot run away. Only regular files (never
 * symlinks, which could cycle) are collected.
 * @module @deepseek-ai/dsh-project-insight/walk
 */

import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/**
 * Directories never entered: dependency and build outputs, VCS metadata, the
 * harness's own cache, and virtual-environment roots. `.dsh` is the committed
 * document's own directory — including it would make the fingerprint depend on
 * the very file it fingerprints.
 */
const IGNORED_DIRS = new Set([
  '.git', '.dsh', 'node_modules', 'dist', 'build', 'out', 'target', 'coverage',
  '.next', '.nuxt', '.cache', '.idea', '.turbo', '.venv', 'venv', '__pycache__',
])

/** One collected regular file. */
export interface WalkedFile {
  /** Absolute file path. */
  readonly abs: string
  /** Root-relative path with `/` separators. */
  readonly rel: string
  /** Byte size of the file. */
  readonly size: number
}

/**
 * Recursively collect the project's regular files in deterministic sorted
 * order, skipping ignored directories and stopping after `maxFiles` entries.
 * @param root - absolute project root the walk starts in.
 * @param maxFiles - hard cap on collected files; the first `maxFiles` in
 * sorted order are returned, so the projection is deterministic.
 * @param signal - aborts the walk between directory listings.
 * @returns the collected files in sorted relative-path order.
 */
export async function walkProject(root: string, maxFiles: number, signal?: AbortSignal): Promise<WalkedFile[]> {
  const found: WalkedFile[] = []
  await walkDir(root, root, maxFiles, found, signal)
  return found
}

async function walkDir(
  absDir: string,
  root: string,
  maxFiles: number,
  found: WalkedFile[],
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  if (found.length >= maxFiles) return
  const entries = await readdir(absDir, { withFileTypes: true })
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  for (const entry of entries) {
    signal?.throwIfAborted()
    if (found.length >= maxFiles) return
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      await walkDir(join(absDir, entry.name), root, maxFiles, found, signal)
    } else if (entry.isFile()) {
      const abs = join(absDir, entry.name)
      // A file may vanish between listing and stat; that race drops it from the
      // projection exactly like an absent file, which stays deterministic.
      try {
        const info = await stat(abs)
        signal?.throwIfAborted()
        found.push({ abs, rel: toRel(root, abs), size: info.size })
      } catch {
        signal?.throwIfAborted()
      }
    }
  }
}

function toRel(root: string, abs: string): string {
  const rel = relative(root, abs)
  return sep === '\\' ? rel.split('\\').join('/') : rel
}
