/**
 * File-type helpers shared by the insight tabs: the extension-derived grammar
 * hint a content view hands the highlighter, and the color category a graph
 * node's card derives from its path. Pure functions of the path; an unknown
 * extension degrades to a plain render and the neutral category.
 * @module @deepseek-ai/dsh-client-ui-project-insight/client/fileType
 */

/** File extensions whose embedded content renders as markdown rather than source. */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

/** Grammar hints for the extensions the client highlighter carries; other extensions render plain. */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  yml: 'yaml', yaml: 'yaml', json: 'json', jsonc: 'json', toml: 'toml', ini: 'ini',
  ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx',
  vue: 'vue', svelte: 'svelte',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  php: 'php', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  html: 'html', htm: 'html', xml: 'xml', css: 'css', scss: 'scss', less: 'less',
  sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', lua: 'lua',
}

/** The card-color categories a graph node's extension maps to (color groups, not languages). */
export type FileTypeCategory = 'ts' | 'js' | 'component' | 'style' | 'other'

/** Extension → card-color category; every other extension is the neutral category. */
const CATEGORY_BY_EXTENSION: Readonly<Record<string, FileTypeCategory>> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  vue: 'component', svelte: 'component',
  css: 'style', scss: 'style', less: 'style', html: 'style', htm: 'style',
}

/**
 * Whether a path's extension marks a markdown document.
 * @param path - the file path to inspect.
 * @returns whether the extension is a markdown extension.
 */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path))
}

/**
 * The grammar hint for a non-markdown path, or `undefined` for a plain render.
 * @param path - the file path to inspect.
 * @returns the language tag, or `undefined` when none maps.
 */
export function langOfPath(path: string): string | undefined {
  return LANG_BY_EXTENSION[extensionOf(path)]
}

/**
 * The card-color category a path's extension maps to (`other` for unknown extensions).
 * @param path - the file path to inspect.
 * @returns the category for the extension.
 */
export function fileTypeCategoryOf(path: string): FileTypeCategory {
  return CATEGORY_BY_EXTENSION[extensionOf(path)] ?? 'other'
}

/**
 * A path's lowercase extension ('' for a bare or extensionless name).
 * @param path - the file path to inspect.
 * @returns the lowercase extension.
 */
export function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return dot > slash ? path.slice(dot + 1).toLowerCase() : ''
}
