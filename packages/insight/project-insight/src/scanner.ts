/**
 * The deterministic offline analyzer that turns a project tree into the
 * `.dsh/insight/` document. It is a pure function of the tree's bytes:
 * no network, no credentials, no LLM, no clock — scanning the same bounded
 * tree twice yields a byte-identical document, because every emitted
 * collection is sorted by a stable key and all paths are root-relative.
 * `scannedAt` is present on the document but excluded from the content
 * fingerprint, so a re-scan of an unchanged tree also leaves the identity
 * alone; the stat-only `statSignature` records the tree identity at scan time
 * so reads can judge freshness without re-reading content.
 * @module @deepseek-ai/dsh-project-insight/scanner
 */

import { basename, posix } from 'node:path'
import {
  MAX_AGENT_TECH_MARKDOWN_BYTES, MAX_AGENT_TECH_MARKDOWN_ROWS, MAX_AGENT_TECH_MARKDOWN_TOTAL,
  MAX_EDGES, MAX_FINGERPRINT_FILES, MAX_MANIFEST_BYTES, MAX_SOURCE_BYTES, MAX_SOURCE_FILES,
  PROJECT_INSIGHT_FORMAT_VERSION,
  type AgentTechFileRow, type AgentTechKind, type AgentTechMarkdownRow, type AgentTechSection,
  type AgentTechToolRow,
  type ComponentDependenciesSection, type ComponentDependencyRow, type ComponentKind, type ComponentRow,
  type ComponentsSection, type DependencyRow, type ManifestRow, type ModuleFileRow, type ModuleTopologySection,
  type ProjectInsightDoc, type PromptRow, type PromptsSection, type RuntimeRow, type SourceFileRow,
  type TechStackSection,
} from './schema.ts'
import { fingerprintOf } from './fingerprint.ts'
import {
  countLines, extractImportSpecifiers, extractVueScript, isSourceFile, languageOf, readBounded,
} from './parse.ts'
import { readPathAliases, type PathAlias } from './paths.ts'
import { statProject, walkProject, type WalkedFile } from './walk.ts'

/** The compact, model-facing summary of one scan. */
export interface ScanSummary {
  /** Source files scanned (the emitted topology node count before caps). */
  readonly files: number
  /** Module nodes emitted. */
  readonly modules: number
  /** Import edges emitted. */
  readonly edges: number
  /** Components discovered. */
  readonly components: number
  /** Top 10 surfaced dependency names, sorted. */
  readonly techStack: string[]
  /** Prompt files discovered. */
  readonly prompts: number
  /** Agent-related files discovered. */
  readonly agentTechFiles: number
}

/** The result of one deterministic scan. */
export interface ScanProjectResult {
  /** The committed document. */
  readonly doc: ProjectInsightDoc
  /** The compact summary. */
  readonly summary: ScanSummary
}

/** Manifest basename → kind classification. */
const MANIFEST_KINDS: Readonly<Record<string, ManifestRow['kind']>> = {
  'package.json': 'package.json',
  'pnpm-lock.yaml': 'pnpm-lock',
  'pnpm-lock.yml': 'pnpm-lock',
  'package-lock.json': 'package-lock',
  'yarn.lock': 'yarn-lock',
  'bun.lock': 'bun-lock',
  'bun.lockb': 'bun-lock',
  'requirements.txt': 'requirements.txt',
  'pyproject.toml': 'pyproject.toml',
  'go.mod': 'go.mod',
  'Cargo.toml': 'Cargo.toml',
}

/** Manifest kind → inferred runtime name. */
const RUNTIME_FROM_MANIFEST: Readonly<Record<string, string>> = {
  'pnpm-lock': 'node', 'package-lock': 'node', 'yarn-lock': 'node', 'bun-lock': 'node',
  'requirements.txt': 'python', 'pyproject.toml': 'python', 'go.mod': 'go', 'Cargo.toml': 'rust',
}

/** Repository instruction files treated as prompts, by basename. */
const PROMPT_BASENAMES = new Set(['AGENTS.md', 'AGENTS.local.md', 'CLAUDE.md', 'CLAUDE.local.md'])

/** Byte cap for reading a prompt title (first `# Heading` line). */
const PROMPT_TITLE_BYTES = 8 * 1024

/** Extensions tried when resolving an extensionless internal import. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']

/** A skill entry in `.agents/` or `.claude/`. */
const SKILL_ENTRY_RE = /^\.(agents|claude)\/skills\/[^/]+\/SKILL\.md$/

/**
 * Scan a project tree into the versioned document. `root` is the discovered
 * project root; the caller owns root discovery and persistence.
 * @param root - absolute project root to scan.
 * @param signal - aborts the walk and reads.
 * @returns the document and its compact summary.
 */
export async function scanProject(root: string, signal?: AbortSignal): Promise<ScanProjectResult> {
  const walked = await walkProject(root, MAX_FINGERPRINT_FILES, signal)
  const contentFingerprint = await fingerprintOf(walked, signal)
  const stat = await statProject(root, MAX_FINGERPRINT_FILES, signal)
  const byRel = new Map(walked.map(file => [file.rel, file]))
  const relSet = new Set(walked.map(file => file.rel))

  const aliases = await readPathAliases(root, MAX_MANIFEST_BYTES)
  const resolve = makeResolver(relSet, aliases)

  const sourceRels = walked
    .map(file => file.rel)
    .filter(isSourceFile)
    .slice(0, MAX_SOURCE_FILES)
  const contents = new Map<string, string>()
  for (const rel of sourceRels) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- sourceRels is walked rels, each a byRel key
    const content = await readBounded(byRel.get(rel)!.abs, MAX_SOURCE_BYTES, signal)
    if (content !== undefined) contents.set(rel, content)
  }

  // Manifest contents feed the dependency and runtime analysis; read bounded so
  // the tech-stack section cannot grow with a huge manifest file.
  const manifestContents = new Map<string, string>()
  for (const file of walked) {
    if (basename(file.rel) !== 'package.json') continue
    const content = await readBounded(file.abs, MAX_MANIFEST_BYTES, signal)
    if (content !== undefined) manifestContents.set(file.rel, content)
  }

  const topology = buildTopology(sourceRels, contents, resolve, aliases)
  const components = buildComponents(sourceRels, contents)
  const componentDependencies = buildComponentDependencies(sourceRels, contents, resolve, components)
  const techStack = buildTechStack(walked, sourceRels, contents, manifestContents)
  const prompts = await buildPrompts(walked, signal)
  const agentTech = await buildAgentTech(walked, signal)

  const doc: ProjectInsightDoc = {
    formatVersion: PROJECT_INSIGHT_FORMAT_VERSION,
    rootName: basename(root),
    contentFingerprint,
    statSignature: stat.signature,
    scannedAt: Date.now(),
    sections: {
      techStack: techStack.section,
      moduleTopology: topology.section,
      componentDependencies,
      components: components.section,
      prompts: prompts.section,
      agentTech,
    },
  }

  const summary: ScanSummary = {
    files: contents.size,
    modules: topology.section.files.length,
    edges: topology.edges,
    components: components.section.count,
    techStack: techStack.section.dependencies.slice(0, 10).map(dependency => dependency.name),
    prompts: prompts.section.count,
    agentTechFiles: agentTech.count,
  }
  return { doc, summary }
}

/** The module-topology build result, carrying the edge count for the summary. */
interface TopologyResult {
  readonly section: ModuleTopologySection
  readonly edges: number
}

function buildTopology(
  sourceRels: readonly string[],
  contents: ReadonlyMap<string, string>,
  resolve: Resolve,
  aliases: readonly PathAlias[],
): TopologyResult {
  const files: ModuleFileRow[] = []
  const externals = new Set<string>()
  let edges = 0
  for (const rel of sourceRels) {
    const content = contents.get(rel)
    if (content === undefined) continue
    let imports = extractImportsFor(rel, content, resolve)
    imports = imports.slice(0, Math.max(0, MAX_EDGES - edges))
    edges += imports.length
    for (const target of imports) {
      if (target.startsWith('external:')) externals.add(target.slice('external:'.length))
    }
    files.push({ path: rel, imports })
  }
  return {
    section: {
      files,
      internalRoots: internalRoots(sourceRels),
      aliases: [...aliases],
      externalCount: externals.size,
    },
    edges,
  }
}

function internalRoots(sourceRels: readonly string[]): string[] {
  const roots = new Set<string>()
  for (const rel of sourceRels) {
    const slash = rel.indexOf('/')
    if (slash > 0) roots.add(rel.slice(0, slash))
  }
  return [...roots].sort()
}

function buildComponentDependencies(
  sourceRels: readonly string[],
  contents: ReadonlyMap<string, string>,
  resolve: Resolve,
  components: ComponentsBuild,
): ComponentDependenciesSection {
  const componentRels = new Set(components.section.components.map(component => component.path))
  const nameToRel = new Map(components.section.components.map(component => [component.name, component.path]))
  const rows: ComponentDependencyRow[] = []
  for (const rel of sourceRels) {
    if (!componentRels.has(rel)) continue
    const content = contents.get(rel)
    if (content === undefined) continue
    const imports = extractImportsFor(rel, content, resolve).filter(target => !target.startsWith('external:'))
    const templateEdges = rel.endsWith('.vue')
      ? templateComponentEdges(content, nameToRel)
      : []
    rows.push({ path: rel, imports: dedupe([...imports, ...templateEdges]) })
  }
  rows.sort(compareByPath)
  return { components: rows.slice(0, 100), cycles: detectCycles(rows) }
}

/** Detect mutual imports between component modules, each 2-cycle reported once. */
function detectCycles(rows: readonly ComponentDependencyRow[]): [string, string][] {
  const outgoing = new Map(rows.map(row => [row.path, new Set(row.imports)]))
  const cycles: [string, string][] = []
  for (const row of rows) {
    for (const target of row.imports) {
      if (target <= row.path) continue
      if (outgoing.get(target)?.has(row.path)) cycles.push([row.path, target])
    }
  }
  cycles.sort(comparePair)
  return cycles.slice(0, 20)
}

function comparePair(a: readonly [string, string], b: readonly [string, string]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
  return a[1] !== b[1] ? (a[1] < b[1] ? -1 : 1) : 0
}

/** PascalCase `<Tag>` occurrences in a Vue template that name a known component. */
function templateComponentEdges(content: string, nameToRel: ReadonlyMap<string, string>): string[] {
  const edges: string[] = []
  for (const match of content.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the capture group always matches a tag name
    const target = nameToRel.get(match[1]!)
    if (target !== undefined) edges.push(target)
  }
  return edges
}

interface ComponentsBuild {
  readonly section: ComponentsSection
}

function buildComponents(
  sourceRels: readonly string[],
  contents: ReadonlyMap<string, string>,
): ComponentsBuild {
  const components: ComponentRow[] = []
  for (const rel of sourceRels) {
    const content = contents.get(rel)
    const kind = kindOf(rel)
    if (kind === 'other' || content === undefined) continue
    components.push(classifyComponent(rel, content, kind))
  }
  components.sort(compareByPath)
  const count = components.length
  return { section: { components: components.slice(0, 100), count } }
}

function kindOf(rel: string): ComponentKind {
  if (rel.endsWith('.vue')) return 'vue'
  if (rel.endsWith('.svelte')) return 'svelte'
  if (rel.endsWith('.tsx')) return 'react'
  if (rel.endsWith('.jsx')) return 'jsx'
  return 'other'
}

function classifyComponent(rel: string, content: string, kind: ComponentKind): ComponentRow {
  const stem = basename(rel).replace(/\.(vue|svelte|tsx|jsx)$/, '')
  switch (kind) {
    case 'vue':
      return {
        path: rel, name: stem, kind: 'vue', defaultExport: true,
        hasProps: /defineProps\s*\(|props\s*[:=]/.test(content),
      }
    case 'svelte':
      return {
        path: rel, name: stem, kind: 'svelte', defaultExport: true,
        hasProps: /export\s+let\b/.test(content),
      }
    case 'react':
    case 'jsx': {
      const name = defaultComponentName(content) ?? stem
      return {
        path: rel, name, kind: kind === 'react' ? 'react' : 'jsx',
        defaultExport: /export\s+default\b/.test(content),
        hasProps: /(?:interface|type)\s+\w*Props\b|\bprops\b/.test(content),
      }
    }
    /* v8 ignore next -- ComponentKind is closed; this arm only makes adding a kind a compile error. */
    default:
      return { path: rel, name: stem, kind: 'other', defaultExport: false, hasProps: false }
  }
}

function defaultComponentName(content: string): string | undefined {
  const match = /export\s+default\s+(?:function|class)\s+([A-Z]\w*)/.exec(content)
  if (match !== null) return match[1]
  const named = /export\s+default\s+([A-Z]\w*)/.exec(content)
  return named?.[1]
}

interface TechStackBuild {
  readonly section: TechStackSection
}

function buildTechStack(
  walked: readonly WalkedFile[],
  sourceRels: readonly string[],
  contents: ReadonlyMap<string, string>,
  manifestContents: ReadonlyMap<string, string>,
): TechStackBuild {
  const manifests: ManifestRow[] = []
  const manifestByPath = new Map<string, ManifestRow['kind']>()
  for (const file of walked) {
    const kind = MANIFEST_KINDS[basename(file.rel)]
    if (kind === undefined) continue
    manifests.push({ kind, path: file.rel })
    manifestByPath.set(file.rel, kind)
  }
  manifests.sort(compareByPath)

  const dependencies = collectDependencies(manifestContents)
  const runtimes = buildRuntimes(walked, manifestByPath, manifestContents)

  const files: SourceFileRow[] = []
  for (const rel of sourceRels) {
    const content = contents.get(rel)
    if (content === undefined) continue
    files.push({ path: rel, language: languageOf(rel), lines: countLines(content) })
  }
  files.sort(compareByPath)

  return {
    section: {
      manifests: manifests.slice(0, 20),
      dependencies: dependencies.slice(0, 50),
      runtimes,
      files: files.slice(0, 20),
    },
  }
}

interface PackageJsonManifest {
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
  optionalDependencies?: Record<string, unknown>
  engines?: { node?: unknown }
}

/** Parse a package.json text into the fields the analysis reads, or undefined. */
function parsePackageJson(content: string): PackageJsonManifest | undefined {
  try {
    return JSON.parse(content) as PackageJsonManifest
  } catch {
    return undefined
  }
}

function collectDependencies(
  manifestContents: ReadonlyMap<string, string>,
): DependencyRow[] {
  const rows: DependencyRow[] = []
  for (const content of manifestContents.values()) {
    const parsed = parsePackageJson(content)
    if (parsed === undefined) continue
    for (const category of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      const section = parsed[category]
      if (section === undefined) continue
      for (const [name, version] of Object.entries(section)) {
        rows.push({ name, ...typeof version === 'string' ? { version } : {}, category })
      }
    }
  }
  rows.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  // Collapse duplicate (name, category) pairs across manifests, keeping the
  // first in sorted order.
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.name}\0${row.category}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildRuntimes(
  walked: readonly WalkedFile[],
  manifestByPath: ReadonlyMap<string, ManifestRow['kind']>,
  manifestContents: ReadonlyMap<string, string>,
): RuntimeRow[] {
  const runtimes = new Map<string, string>()
  for (const file of walked) {
    const kind = manifestByPath.get(file.rel)
    const runtime = kind === undefined ? undefined : RUNTIME_FROM_MANIFEST[kind]
    if (runtime === undefined) continue
    runtimes.set(runtime, '')
  }
  // A lockfile pinpoints node; a bare package.json already implies it, so any
  // manifest presence surfaces the node runtime with its engines version when
  // declared.
  if (manifestContents.size > 0) runtimes.set('node', '')
  if (runtimes.has('node')) {
    const engines = packageEnginesNode(manifestContents)
    if (engines !== undefined) runtimes.set('node', engines)
  }
  const rows: RuntimeRow[] = []
  for (const [name, version] of runtimes) {
    rows.push(version === '' ? { name } : { name, version })
  }
  rows.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return rows
}

function packageEnginesNode(manifestContents: ReadonlyMap<string, string>): string | undefined {
  for (const content of manifestContents.values()) {
    const engines = parsePackageJson(content)?.engines
    if (typeof engines?.node === 'string') return engines.node
  }
  return undefined
}

interface PromptsBuild {
  readonly section: PromptsSection
}

async function buildPrompts(walked: readonly WalkedFile[], signal?: AbortSignal): Promise<PromptsBuild> {
  const files: PromptRow[] = []
  for (const file of walked) {
    if (!isPromptFile(file.rel)) continue
    const title = await readPromptTitle(file.abs, signal)
    files.push({ path: file.rel, ...title === undefined ? {} : { title }, bytes: file.size })
  }
  files.sort(compareByPath)
  const count = files.length
  return { section: { files: files.slice(0, 100), count } }
}

function isPromptFile(rel: string): boolean {
  if (PROMPT_BASENAMES.has(basename(rel))) return true
  if (rel.endsWith('.prompt.md')) return true
  if (rel.startsWith('.agents/prompts/') || rel.startsWith('.claude/prompts/')) return true
  const slash = rel.indexOf('/')
  const head = slash < 0 ? rel : rel.slice(0, slash)
  return head === 'prompts'
}

async function readPromptTitle(abs: string, signal?: AbortSignal): Promise<string | undefined> {
  const content = await readBounded(abs, PROMPT_TITLE_BYTES, signal)
  if (content === undefined) return undefined
  const match = /^\s*#\s+(.+)$/m.exec(content)
  return match?.[1]?.trim()
}

async function buildAgentTech(walked: readonly WalkedFile[], signal?: AbortSignal): Promise<AgentTechSection> {
  const files: AgentTechFileRow[] = []
  for (const file of walked) {
    const kind = agentTechKindOf(file.rel)
    if (kind === 'other') continue
    files.push({ path: file.rel, kind })
  }
  files.sort(compareByPath)
  const count = files.length

  const tools: AgentTechToolRow[] = []
  for (const file of walked) {
    if (basename(file.rel).endsWith('.cordis.yml')) {
      const content = await readBounded(file.abs, MAX_MANIFEST_BYTES, signal)
      if (content === undefined) continue
      for (const name of extractCordisModuleNames(content)) tools.push({ name, path: file.rel })
    }
    if (SKILL_ENTRY_RE.test(file.rel)) {
      const segments = file.rel.split('/')
      const skill = segments[segments.length - 2]
      if (skill !== undefined) tools.push({ name: skill, path: file.rel })
    }
  }
  tools.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const seen = new Set<string>()
  const unique = tools.filter((tool) => {
    const key = `${tool.name}\0${tool.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const content = await buildAgentTechMarkdown(walked, signal)
  return {
    files: files.slice(0, 100), tools: unique.slice(0, 50), count,
    skills: content.skills, mcp: content.mcp, prompts: content.prompts,
  }
}

/** MCP config files whose JSON the agent-tech section embeds, env values redacted. */
function isMcpConfig(rel: string): boolean {
  return rel === '.mcp.json' || rel === 'mcp.json' || rel === '.claude/mcp.json' || rel === '.mcp/mcp.json'
}

/** A parsed `.mcp.json`-style config: only the `env` blocks are redacted. */
interface McpConfigJson {
  readonly mcpServers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

/**
 * Redact every `mcpServers.*.env` value so an embedded config never commits
 * secrets to the insight document; server names, command, and args survive.
 * An unparsable config embeds verbatim (its own syntax is already the problem).
 * @param content - the raw config text.
 * @returns the config re-serialized with env values replaced, or the raw text.
 */
function redactMcpEnv(content: string): string {
  let parsed: McpConfigJson
  try {
    parsed = JSON.parse(content) as McpConfigJson
  } catch {
    return content
  }
  if (parsed.mcpServers === undefined) return content
  const redacted: Record<string, Record<string, unknown>> = {}
  for (const [name, server] of Object.entries(parsed.mcpServers)) {
    redacted[name] = typeof server.env === 'object' && server.env !== null
      ? { ...server, env: redactedEnv(server.env) }
      : { ...server }
  }
  return JSON.stringify({ ...parsed, mcpServers: redacted }, null, 2)
}

function redactedEnv(env: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(env)) out[key] = '<redacted>'
  return out
}

/** One collection's embedded markdown rows. */
interface AgentTechMarkdown {
  readonly skills: AgentTechMarkdownRow[]
  readonly mcp: AgentTechMarkdownRow[]
  readonly prompts: AgentTechMarkdownRow[]
}

/**
 * Embed the agent-related markdown content the workbench sub-tabs render:
 * skill `SKILL.md` files, mcp config files, and prompt files. Each collection
 * is sorted by path and bounded by the per-collection row cap and a shared
 * total byte budget applied in sorted order; a row over the per-row cap is
 * skipped. MCP configs have their `env` values redacted before embedding.
 * @param walked - the bounded file set.
 * @param signal - aborts the bounded reads.
 * @returns the three sorted, capped collections.
 */
async function buildAgentTechMarkdown(
  walked: readonly WalkedFile[],
  signal?: AbortSignal,
): Promise<AgentTechMarkdown> {
  const skills: AgentTechMarkdownRow[] = []
  const mcp: AgentTechMarkdownRow[] = []
  const prompts: AgentTechMarkdownRow[] = []
  let budget = MAX_AGENT_TECH_MARKDOWN_TOTAL
  const push = (row: AgentTechMarkdownRow, rows: AgentTechMarkdownRow[]): void => {
    if (rows.length >= MAX_AGENT_TECH_MARKDOWN_ROWS) return
    const bytes = Buffer.byteLength(row.markdown, 'utf8')
    if (bytes > budget) return
    budget -= bytes
    rows.push(row)
  }
  for (const file of walked) {
    if (SKILL_ENTRY_RE.test(file.rel)) {
      const markdown = await readBounded(file.abs, MAX_AGENT_TECH_MARKDOWN_BYTES, signal)
      if (markdown === undefined) continue
      const segments = file.rel.split('/')
      const name = segments[segments.length - 2]
      if (name !== undefined) push({ name, path: file.rel, markdown }, skills)
    } else if (isMcpConfig(file.rel)) {
      const content = await readBounded(file.abs, MAX_AGENT_TECH_MARKDOWN_BYTES, signal)
      if (content === undefined) continue
      push({
        name: basename(file.rel), path: file.rel,
        markdown: '```json\n' + redactMcpEnv(content) + '\n```',
      }, mcp)
    } else if (isPromptFile(file.rel)) {
      const markdown = await readBounded(file.abs, MAX_AGENT_TECH_MARKDOWN_BYTES, signal)
      if (markdown === undefined) continue
      push({ name: basename(file.rel), path: file.rel, markdown }, prompts)
    }
  }
  skills.sort(compareByPath)
  mcp.sort(compareByPath)
  prompts.sort(compareByPath)
  return { skills, mcp, prompts }
}

function agentTechKindOf(rel: string): AgentTechKind {
  if (rel === 'AGENTS.md' || rel === 'AGENTS.local.md' || rel === 'CLAUDE.md' || rel === 'CLAUDE.local.md') {
    return 'instructions'
  }
  if (rel.startsWith('.agents/')) return rel.startsWith('.agents/notes/') ? 'notes' : 'agent-config'
  if (rel.startsWith('.claude/')) return 'tool-config'
  if (rel.startsWith('.github/workflows/')) return 'tool-config'
  if (rel.startsWith('.vscode/')) return 'tool-config'
  if (isMcpConfig(rel)) return 'tool-config'
  if (isToolConfigBasename(basename(rel))) return 'tool-config'
  return 'other'
}

function isToolConfigBasename(name: string): boolean {
  return /^(\.eslintrc|\.prettierrc|vitest\.config|jest\.config|\.editorconfig)(\.|$)/.test(name)
}

function extractCordisModuleNames(content: string): string[] {
  const names = new Set<string>()
  for (const match of content.matchAll(/^\s*-?\s*name:\s*['"]?(@deepseek-ai\/dsh-[a-z0-9-]+)/gm)) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the capture group always matches a module name
    names.add(match[1]!)
  }
  return [...names]
}

/** Resolve one import specifier against the walked tree and declared aliases. */
type Resolve = (specifier: string, fromRel: string) => string

function makeResolver(relSet: ReadonlySet<string>, aliases: readonly PathAlias[]): Resolve {
  return (specifier, fromRel) => {
    if (specifier.startsWith('.')) {
      const base = posix.join(posix.dirname(fromRel), specifier)
      return findInSet(base, relSet) ?? normalize(base)
    }
    for (const alias of aliases) {
      if (specifier === alias.key || specifier.startsWith(`${alias.key}/`)) {
        const rest = specifier === alias.key ? '' : specifier.slice(alias.key.length + 1)
        const base = alias.value === '' ? rest : `${alias.value}/${rest}`
        return findInSet(base, relSet) ?? normalize(base)
      }
    }
    return `external:${externalName(specifier)}`
  }
}

/** The importable package name for a bare specifier (`@scope/pkg` stays whole). */
function externalName(specifier: string): string {
  const parts = specifier.split('/')
  // `parts.length > 1` guarantees both reads below exist; TS cannot narrow index reads.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  return specifier.startsWith('@') && parts.length > 1 ? `${parts[0]!}/${parts[1]!}` : parts[0]!
}

function findInSet(base: string, relSet: ReadonlySet<string>): string | undefined {
  if (relSet.has(base)) return base
  for (const extension of RESOLVE_EXTENSIONS) {
    if (relSet.has(`${base}${extension}`)) return `${base}${extension}`
  }
  for (const extension of RESOLVE_EXTENSIONS) {
    if (relSet.has(`${base}/index${extension}`)) return `${base}/index${extension}`
  }
  return undefined
}

/** Normalize a root-relative candidate without leaking a leading `./`. */
function normalize(base: string): string {
  return base.startsWith('./') ? base.slice(2) : base
}

/** Extract imports for one module, using the Vue script block for SFCs. */
function extractImportsFor(rel: string, content: string, resolve: Resolve): string[] {
  const source = rel.endsWith('.vue')
    ? extractVueScript(content) ?? ''
    : content
  return dedupe(extractImportSpecifiers(source).map(specifier => resolve(specifier, rel)))
}

function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)]
}

function compareByPath(a: { readonly path: string }, b: { readonly path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}
