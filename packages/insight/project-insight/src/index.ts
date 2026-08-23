/**
 * Deterministic project insight: a host-plane service that scans a develop-mode
 * session's workspace into a versioned `.dsh/project-insight.json` document —
 * module topology, component dependencies, components, tech stack, prompts, and
 * agent-related files — and exposes the document through read/scan surfaces and
 * the model-facing `scan_project` tool (see `./tool`).
 *
 * The scanner is keyless and deterministic: same bounded tree → byte-identical
 * document. The service auto-scans when a session's resolved agent preset is a
 * member of `config.autoScanPresets` (default `['develop']`), and persists into
 * the scanned project's own `.dsh/` so a second open loads without re-scanning.
 * @module @deepseek-ai/dsh-project-insight
 */

export {
  PROJECT_INSIGHT_FORMAT_VERSION, PROJECT_INSIGHT_FILE, MAX_DOC_BYTES, MAX_EDGES,
  MAX_FINGERPRINT_FILES, MAX_MANIFEST_BYTES, MAX_SOURCE_BYTES, MAX_SOURCE_FILES,
} from './schema.ts'
export type {
  AgentTechFileRow, AgentTechKind, AgentTechSection, AgentTechToolRow,
  ComponentDependenciesSection, ComponentDependencyRow, ComponentKind, ComponentRow,
  ComponentsSection, DependencyRow, ManifestRow, ModuleFileRow, ModuleTopologySection,
  ProjectInsightDoc, PromptRow, PromptsSection, RuntimeRow, SourceFileRow, TechStackSection,
} from './schema.ts'
export { ProjectInsightError, errorMessage, type ProjectInsightErrorCode } from './error.ts'
export {
  PROJECT_INSIGHT_DOC_REL, projectContentFingerprint, readDocument, writeDocument,
} from './fingerprint.ts'
export { findProjectRoot, readPathAliases, relativeDisplay, type PathAlias } from './paths.ts'
export { scanProject, type ScanProjectResult, type ScanSummary } from './scanner.ts'
export { ProjectInsight } from './service.ts'
export type {
  ProjectInsightConfig, ProjectInsightReadResult, ProjectInsightReadStatus,
  ProjectInsightScanResult, ProjectInsightScanStatus,
} from './service.ts'
export { default } from './service.ts'
