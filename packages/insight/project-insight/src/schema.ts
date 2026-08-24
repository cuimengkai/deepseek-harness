/**
 * The versioned `.dsh/insight/` document vocabulary and its scan-time bounds.
 * The document is the single data contract between the deterministic scanner,
 * the model-facing `scan_project` tool, and the browser's six insight tabs:
 * everything the workbench renders derives from one committed document, stored
 * under `<projectRoot>/.dsh/insight/` as a meta file plus six typed section
 * files.
 * @module @deepseek-ai/dsh-project-insight/schema
 */

/**
 * On-disk document format version, monotonic like `SESSION_FORMAT_VERSION`.
 * The reader refuses any other version; while the harness is unreleased no
 * compatibility is implied and no migration is provided. A stored document
 * under an older version is read as `stale` by the service and rebuilt in the
 * background, so a format bump self-heals an existing project's committed doc
 * instead of stranding it in an error state.
 */
export const PROJECT_INSIGHT_FORMAT_VERSION = 3

/** Source files the module topology emits; the walk itself is bounded by {@link MAX_FINGERPRINT_FILES}. */
export const MAX_SOURCE_FILES = 300
/** Total import edges the module topology emits before truncation. */
export const MAX_EDGES = 2000
/** UTF-8 byte cap for one source file read; larger files are skipped. */
export const MAX_SOURCE_BYTES = 256 * 1024
/** UTF-8 byte cap for one manifest (package.json, lockfile, …) read. */
export const MAX_MANIFEST_BYTES = 1 * 1024 * 1024
/** Files the content-fingerprint projection walks before truncation. */
export const MAX_FINGERPRINT_FILES = 5000
/** Per-file byte guard applied when a stored document file is read. */
export const MAX_DOC_BYTES = 1 * 1024 * 1024
/** Markdown content rows the agent-tech section embeds per collection (skills, mcp, prompts). */
export const MAX_AGENT_TECH_MARKDOWN_ROWS = 16
/** UTF-8 byte cap for one embedded content row; larger files are skipped. */
export const MAX_AGENT_TECH_MARKDOWN_BYTES = 64 * 1024
/** Total UTF-8 byte budget across all agent-tech markdown content, applied in sorted order. */
export const MAX_AGENT_TECH_MARKDOWN_TOTAL = 512 * 1024

/** One detected dependency manifest (package.json, lockfile, …). */
export interface ManifestRow {
  /** Manifest kind, derived from the basename. */
  readonly kind: 'package.json' | 'pnpm-lock' | 'package-lock' | 'yarn-lock' | 'bun-lock'
    | 'requirements.txt' | 'pyproject.toml' | 'go.mod' | 'Cargo.toml'
  /** Root-relative manifest path. */
  readonly path: string
}

/** One dependency entry surfaced from a parsed manifest. */
export interface DependencyRow {
  /** Package or requirement name. */
  readonly name: string
  /** Declared version range, when the manifest records one. */
  readonly version?: string
  /** Manifest section the entry was read from. */
  readonly category: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies' | 'requirements'
}

/** One derived runtime the project runs on. */
export interface RuntimeRow {
  /** Runtime name (`node`, `python`, `go`, `rust`). */
  readonly name: string
  /** Declared version, when a manifest pins one. */
  readonly version?: string
}

/** One source file projected for the tech-stack section. */
export interface SourceFileRow {
  /** Root-relative source path. */
  readonly path: string
  /** Language derived from the extension. */
  readonly language: string
  /** Line count of the read content. */
  readonly lines: number
}

/** The tech-stack section. */
export interface TechStackSection {
  /** Detected manifests, top 20 sorted by path. */
  readonly manifests: ManifestRow[]
  /** Surface dependency names, top 50 sorted by name. */
  readonly dependencies: DependencyRow[]
  /** Derived runtimes, sorted by name. */
  readonly runtimes: RuntimeRow[]
  /** Source files by language, top 20 sorted by path. */
  readonly files: SourceFileRow[]
}

/** One module node with its import edges. */
export interface ModuleFileRow {
  /** Root-relative module path. */
  readonly path: string
  /** Resolved imports: root-relative internal edges, `external:<name>` leaves. */
  readonly imports: string[]
}

/** The module-dependency topology section. */
export interface ModuleTopologySection {
  /** Source modules with resolved import edges, top {@link MAX_SOURCE_FILES} sorted by path. */
  readonly files: ModuleFileRow[]
  /** Directories treated as root-relative import bases. */
  readonly internalRoots: string[]
  /** Resolved path aliases (e.g. `@` → `src`), sorted by key. */
  readonly aliases: { readonly key: string; readonly value: string }[]
  /** Distinct external package leaves referenced across all modules. */
  readonly externalCount: number
}

/** One component node with its internal component-dependency edges. */
export interface ComponentDependencyRow {
  /** Root-relative component path. */
  readonly path: string
  /** Root-relative component dependencies. */
  readonly imports: string[]
}

/** The component-dependency section. */
export interface ComponentDependenciesSection {
  /** Component dependency edges, top 100 sorted by path. */
  readonly components: ComponentDependencyRow[]
  /** Detected mutual-import pairs, top 20 sorted. */
  readonly cycles: [string, string][]
}

/** Framework family of one discovered component. */
export type ComponentKind = 'react' | 'vue' | 'svelte' | 'jsx' | 'other'

/** One discovered component. */
export interface ComponentRow {
  /** Root-relative component path. */
  readonly path: string
  /** Component name (default export name or basename). */
  readonly name: string
  /** Framework family. */
  readonly kind: ComponentKind
  /** Whether the file carries a default export. */
  readonly defaultExport: boolean
  /** Whether props are declared (`defineProps`, `props`, or a props parameter). */
  readonly hasProps: boolean
}

/** The component-inventory section. */
export interface ComponentsSection {
  /** Discovered components, top 100 sorted by path. */
  readonly components: ComponentRow[]
  /** Total components counted before the emitted set was capped. */
  readonly count: number
}

/** One discovered prompt file. */
export interface PromptRow {
  /** Root-relative prompt path. */
  readonly path: string
  /** First markdown heading, when the file has one. */
  readonly title?: string
  /** File size in bytes. */
  readonly bytes: number
}

/** The prompt section. */
export interface PromptsSection {
  /** Discovered prompt files, top 100 sorted by path. */
  readonly files: PromptRow[]
  /** Total prompt files counted before the emitted set was capped. */
  readonly count: number
}

/** Role of one agent-related configuration file. */
export type AgentTechKind = 'agent-config' | 'tool-config' | 'instructions' | 'notes' | 'other'

/** One discovered agent-related file. */
export interface AgentTechFileRow {
  /** Root-relative file path. */
  readonly path: string
  /** Role classification. */
  readonly kind: AgentTechKind
}

/** One tool or plugin name referenced by the project's agent configuration. */
export interface AgentTechToolRow {
  /** Tool or plugin name. */
  readonly name: string
  /** Root-relative file that referenced it. */
  readonly path: string
}

/** One embedded agent-related document the workbench renders as markdown. */
export interface AgentTechMarkdownRow {
  /** Display name: skill directory name, mcp config basename, or prompt basename. */
  readonly name: string
  /** Root-relative file path. */
  readonly path: string
  /** The file's markdown source (mcp configs render as a fenced JSON block). */
  readonly markdown: string
}

/** The agent-related-technology section. */
export interface AgentTechSection {
  /** Agent-related files, top 100 sorted by path. */
  readonly files: AgentTechFileRow[]
  /** Referenced tool/plugin names, top 50 sorted by name. */
  readonly tools: AgentTechToolRow[]
  /** Total agent-related files counted before the emitted set was capped. */
  readonly count: number
  /** Skill `SKILL.md` content, sorted by path and bounded by the markdown caps. */
  readonly skills: AgentTechMarkdownRow[]
  /** MCP config content, sorted by path and bounded by the markdown caps. */
  readonly mcp: AgentTechMarkdownRow[]
  /** Prompt-file content, sorted by path and bounded by the markdown caps. */
  readonly prompts: AgentTechMarkdownRow[]
}

/**
 * The committed `.dsh/insight/` document. Deterministic: scanning the same
 * bounded file tree yields a byte-identical document, because every emitted
 * collection is sorted by a stable key and no absolute path, randomness, or
 * clock value participates in any comparison.
 */
export interface ProjectInsightDoc {
  /** Monotonic format version; readers refuse any other value. */
  readonly formatVersion: 3
  /** Basename of the project root — identity only, never a host path. */
  readonly rootName: string
  /** sha256 hex over the sorted `(relativePath, size, content)` projection of the bounded file set. */
  readonly contentFingerprint: string
  /**
   * sha256 hex over the sorted `(relativePath, size, mtimeMs)` stat projection
   * of the bounded file set — the cheap read-path fresh/stale key, recorded at
   * scan time.
   */
  readonly statSignature: string
  /** Epoch milliseconds of the scan; runtime metadata, excluded from the fingerprint. */
  readonly scannedAt: number
  /** The six scanned sections. */
  readonly sections: {
    readonly techStack: TechStackSection
    readonly moduleTopology: ModuleTopologySection
    readonly componentDependencies: ComponentDependenciesSection
    readonly components: ComponentsSection
    readonly prompts: PromptsSection
    readonly agentTech: AgentTechSection
  }
}
