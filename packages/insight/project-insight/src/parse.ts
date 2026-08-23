/**
 * Bounded text reads and deterministic lexical extraction over source files:
 * import specifiers, Vue script/template blocks, line counts, and the source
 * extension classification. Everything here is a pure function of file bytes,
 * so the scanner's output never depends on traversal order or runtime state.
 * @module @deepseek-ai/dsh-project-insight/parse
 */

import { createReadStream } from 'node:fs'

/** Source extensions the module topology scans. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'])

/**
 * Map a source extension to its display language.
 * @param rel - root-relative source path.
 * @returns the display language for the path's extension.
 */
export function languageOf(rel: string): string {
  const dot = rel.lastIndexOf('.')
  const ext = dot < 0 ? '' : rel.slice(dot)
  switch (ext) {
    case '.vue': return 'vue'
    case '.svelte': return 'svelte'
    case '.ts': return 'typescript'
    case '.tsx': return 'tsx'
    case '.js': return 'javascript'
    case '.jsx': return 'jsx'
    case '.mjs': return 'javascript'
    case '.cjs': return 'javascript'
    case '.json': return 'json'
    case '.md': return 'markdown'
    case '.css': return 'css'
    case '.scss': return 'scss'
    case '.less': return 'less'
    case '.html': return 'html'
    default: return ext === '' ? 'text' : ext.slice(1)
  }
}

/**
 * Whether a root-relative path is a scanned source file.
 * @param rel - the root-relative path to classify.
 * @returns true when the path's extension is a scanned source extension.
 */
export function isSourceFile(rel: string): boolean {
  const dot = rel.lastIndexOf('.')
  return dot >= 0 && SOURCE_EXTENSIONS.has(rel.slice(dot))
}

/**
 * Read a file's UTF-8 content up to a byte cap. A file larger than the cap, or
 * one that disappears or becomes unreadable mid-read, returns `undefined` so
 * the scanner treats it as skipped rather than failing the whole scan.
 * @param path - absolute path to read.
 * @param maxBytes - inclusive UTF-8 byte cap.
 * @param signal - aborts the read.
 * @returns the content, or `undefined` when over cap or unreadable.
 */
export async function readBounded(path: string, maxBytes: number, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted()
  const stream = createReadStream(path, { encoding: 'utf8', signal })
  const parts: string[] = []
  let bytes = 0
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      bytes += Buffer.byteLength(String(chunk), 'utf8')
      if (bytes > maxBytes) return undefined
      parts.push(String(chunk))
    }
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
  return parts.join('')
}

/**
 * Extract import specifiers in source order using the ESM and CJS forms a
 * static analyzer can see: static and bare `import`, dynamic `import()`, and
 * `require()`.
 * @param content - the source text.
 * @returns the found specifiers in appearance order.
 */
export function extractImportSpecifiers(content: string): string[] {
  const found: string[] = []
  const patterns: Array<[RegExp, (m: RegExpExecArray) => string]> = [
    // Each pattern's capturing group `[^'"]+` guarantees a non-empty match, so
    // `m[1]` is always present.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    [/^\s*import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm, m => m[1]!],
    // oxlint-disable-next-line typescript/no-non-null-assertion
    [/^\s*import\s+['"]([^'"]+)['"]/gm, m => m[1]!],
    // oxlint-disable-next-line typescript/no-non-null-assertion
    [/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, m => m[1]!],
    // oxlint-disable-next-line typescript/no-non-null-assertion
    [/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, m => m[1]!],
  ]
  for (const [pattern, read] of patterns) {
    for (const match of content.matchAll(pattern)) {
      found.push(read(match))
    }
  }
  return found
}

/**
 * Extract the `<script>`/`<script setup>` block of a Vue SFC, or `undefined`.
 * @param content - the SFC source.
 * @returns the script block text without its tags.
 */
export function extractVueScript(content: string): string | undefined {
  return extractBlock(content, 'script')
}

/**
 * Extract the `<template>` block of a Vue SFC, or `undefined`.
 * @param content - the SFC source.
 * @returns the template block text without its tags.
 */
export function extractVueTemplate(content: string): string | undefined {
  return extractBlock(content, 'template')
}

function extractBlock(content: string, name: string): string | undefined {
  const open = new RegExp(`<${name}[^>]*>`, 'g')
  const close = `</${name}>`
  const match = open.exec(content)
  if (match === null) return undefined
  const end = content.indexOf(close, match.index + match[0].length)
  if (end < 0) return undefined
  return content.slice(match.index + match[0].length, end)
}

/**
 * Count newlines in a string (a trailing partial line still counts as a line).
 * @param content - the source text.
 * @returns the number of lines.
 */
export function countLines(content: string): number {
  let lines = 1
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) lines += 1
  }
  return lines
}
