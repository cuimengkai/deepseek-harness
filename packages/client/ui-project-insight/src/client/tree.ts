/**
 * Pure tree derivation for the inventory surfaces (tech stack, components,
 * and the agent-tech subtabs): each committed section folds into the
 * group/leaf tree the left pane of the tree explorer renders, and every node
 * carries the JSON payload the right pane renders through the shiki-highlighted
 * code block. Derivation is a deterministic mapping over the section's
 * already-sorted collections, so it lives apart from the rendering component
 * and stays unit-testable.
 * @module @deepseek-ai/dsh-client-ui-project-insight/client/tree
 */

import type {
  AgentTechKind, AgentTechSection, ComponentsSection, FileContentRow, TechStackSection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'

/** One node of the left-pane inventory tree. */
export interface InventoryTreeNode {
  /** Stable tree key — unique within one derived forest. */
  readonly key: string
  /** Row label rendered in the left pane. */
  readonly label: string
  /** JSON payload the right pane renders through the highlighted code block. */
  readonly detail: unknown
  /** Child nodes; absent marks a leaf. */
  readonly children?: readonly InventoryTreeNode[]
}

/** Localized group labels the tech-stack tree's fixed level-1 groups carry. */
export interface TechStackTreeLabels {
  readonly runtimes: string
  readonly manifests: string
  readonly dependencies: string
  readonly sourceFiles: string
}

/** The flattened forest: every node by key plus each node's parent key. */
export interface FlatInventoryTree {
  /** Every node in the forest, keyed by {@link InventoryTreeNode.key}. */
  readonly nodes: ReadonlyMap<string, InventoryTreeNode>
  /** Each node's parent key; roots have no entry. */
  readonly parents: ReadonlyMap<string, string>
}

/**
 * Derive the tech-stack tree: four fixed level-1 groups (runtimes, manifests,
 * dependencies, source files), dependencies grouped by manifest category and
 * source files by language, every group carrying its rows as the JSON payload
 * and every leaf its row. Empty groups are omitted, and group order within a
 * level is the order the section's sorted rows first mention it, so the tree is
 * a pure function of the committed section.
 * @param section - committed tech-stack section.
 * @param labels - localized level-1 group labels.
 * @returns the group/leaf forest, empty for an empty section.
 */
export function deriveTechStackTree(
  section: TechStackSection,
  labels: TechStackTreeLabels,
): InventoryTreeNode[] {
  const roots: InventoryTreeNode[] = []
  if (section.runtimes.length > 0) {
    roots.push({
      key: 'runtimes',
      label: labels.runtimes,
      detail: section.runtimes,
      children: section.runtimes.map(runtime => ({
        key: `runtimes:${runtime.name}`,
        label: runtime.version === undefined ? runtime.name : `${runtime.name}@${runtime.version}`,
        detail: runtime,
      })),
    })
  }
  if (section.manifests.length > 0) {
    roots.push({
      key: 'manifests',
      label: labels.manifests,
      detail: section.manifests,
      children: section.manifests.map(manifest => ({
        key: `manifests:${manifest.path}`,
        label: manifest.path,
        detail: manifest,
      })),
    })
  }
  if (section.dependencies.length > 0) {
    roots.push({
      key: 'dependencies',
      label: labels.dependencies,
      detail: section.dependencies,
      children: groupBy(
        section.dependencies,
        dependency => dependency.category,
        dependency => `dependencies:${dependency.category}:${dependency.name}`,
        dependency => dependency.name,
      ),
    })
  }
  if (section.files.length > 0) {
    roots.push({
      key: 'files',
      label: labels.sourceFiles,
      detail: section.files,
      children: groupBy(
        section.files,
        file => file.language,
        file => `files:${file.language}:${file.path}`,
        file => file.path,
      ),
    })
  }
  return roots
}

/**
 * Derive the components tree: one directory group per parent directory of the
 * emitted components (root-relative, `.` for the project root), each carrying
 * its components as the JSON payload and one leaf per component. Directory
 * order follows the section's path-sorted rows, so the tree is a pure function
 * of the committed section.
 * @param section - committed components section.
 * @returns the directory/leaf forest, empty for an empty section.
 */
export function deriveComponentsTree(section: ComponentsSection): InventoryTreeNode[] {
  return groupBy(
    section.components,
    component => directoryOf(component.path),
    component => `component:${component.path}`,
    component => component.name,
  )
}

/** Localized root labels the agent-tech inventory tree carries. */
export interface AgentTechInventoryLabels {
  /** One label per file role, keyed by the schema's kind union. */
  readonly kinds: Readonly<Record<AgentTechKind, string>>
  /** The referenced-tools root label. */
  readonly tools: string
}

/** The schema's file roles in the fixed root order of the inventory tree. */
const AGENT_TECH_KIND_ORDER: readonly AgentTechKind[] = [
  'agent-config', 'tool-config', 'instructions', 'notes', 'other',
]

/**
 * Derive the agent-tech inventory tree: one root per file role in the fixed
 * kind order (empty roles omitted), each carrying its files as the JSON
 * payload and one leaf per file, plus one tools root with a leaf per
 * referenced tool/plugin name. The fixed order is a pure function of the kind
 * union, so the tree does not reorder when a re-scan shuffles row paths.
 * @param section - committed agent-tech section.
 * @param labels - localized root labels.
 * @returns the role/tools forest, empty when no files and no tools exist.
 */
export function deriveAgentTechInventoryTree(
  section: AgentTechSection,
  labels: AgentTechInventoryLabels,
): InventoryTreeNode[] {
  const roots: InventoryTreeNode[] = []
  for (const kind of AGENT_TECH_KIND_ORDER) {
    const bucket = section.files.filter(file => file.kind === kind)
    if (bucket.length === 0) continue
    roots.push({
      key: `files:${kind}`,
      label: labels.kinds[kind],
      detail: bucket,
      children: bucket.map(file => ({
        key: `file:${file.path}`,
        label: file.path,
        detail: file,
      })),
    })
  }
  if (section.tools.length > 0) {
    roots.push({
      key: 'tools',
      label: labels.tools,
      detail: section.tools,
      children: section.tools.map(tool => ({
        key: `tool:${tool.name}:${tool.path}`,
        label: tool.name,
        detail: tool,
      })),
    })
  }
  return roots
}

/**
 * Derive one embedded content collection's tree (skills, mcp configs, or
 * prompts): one directory group per parent directory of the collection's
 * documents, each carrying its rows as the JSON payload and one leaf per
 * document. Directory order follows the collection's path-sorted rows.
 * @param rows - the collection's content rows.
 * @param scope - key prefix keeping this forest's leaf keys distinct.
 * @returns the directory/leaf forest, empty for an empty collection.
 */
export function deriveMarkdownRowsTree(
  rows: readonly FileContentRow[],
  scope: string,
): InventoryTreeNode[] {
  return groupBy(
    rows,
    row => directoryOf(row.path),
    row => `${scope}:${row.path}`,
    row => row.name,
  )
}

/**
 * Derive one path-keyed row list's tree (module-topology or component rows):
 * one directory group per parent directory, each carrying its rows as the
 * JSON payload and one leaf per row labeled by basename. Directory order
 * follows the rows' path-sorted order.
 * @param rows - the path-carrying rows.
 * @param scope - key prefix keeping this forest's leaf keys distinct.
 * @returns the directory/leaf forest, empty for an empty row list.
 */
export function derivePathRowsTree(
  rows: readonly { readonly path: string }[],
  scope: string,
): InventoryTreeNode[] {
  return groupBy(
    rows,
    row => directoryOf(row.path),
    row => `${scope}:${row.path}`,
    row => basenameOf(row.path),
  )
}

/** A path's basename (the full path when it carries no separator). */
function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? path : path.slice(slash + 1)
}

/**
 * Flatten a derived forest: every node keyed by its tree key plus each node's
 * parent key, so the explorer resolves a selection, clamps a vanished key, and
 * expands a selection's ancestors without walking the forest again.
 * @param roots - the derived forest.
 * @returns the flattened forest, empty maps for an empty forest.
 */
export function flattenInventoryTree(roots: readonly InventoryTreeNode[]): FlatInventoryTree {
  const nodes = new Map<string, InventoryTreeNode>()
  const parents = new Map<string, string>()
  const walk = (list: readonly InventoryTreeNode[], parent: string | undefined): void => {
    for (const node of list) {
      nodes.set(node.key, node)
      if (parent !== undefined) parents.set(node.key, parent)
      if (node.children !== undefined) walk(node.children, node.key)
    }
  }
  walk(roots, undefined)
  return { nodes, parents }
}

/**
 * The first leaf in document order, or the first node when no leaf exists.
 * @param roots - the root nodes in document order.
 * @returns the first leaf, or `undefined` when `roots` is empty.
 */
export function firstInventoryLeaf(roots: readonly InventoryTreeNode[]): InventoryTreeNode | undefined {
  for (const node of roots) {
    if (node.children === undefined) return node
    const leaf = firstInventoryLeaf(node.children)
    if (leaf !== undefined) return leaf
  }
  return undefined
}

/** The root-relative parent directory of a path (`.` for a bare name). */
function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '.' : path.slice(0, slash)
}

/**
 * Fold rows into labeled groups: one group per distinct key of `groupOf`, in
 * first-appearance order, each carrying its rows as the JSON payload and one
 * leaf per row keyed and labeled by the row mappers.
 */
function groupBy<Row>(
  rows: readonly Row[],
  groupOf: (row: Row) => string,
  leafKey: (row: Row) => string,
  leafLabel: (row: Row) => string,
): InventoryTreeNode[] {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const group = groupOf(row)
    const bucket = groups.get(group)
    if (bucket === undefined) groups.set(group, [row])
    else bucket.push(row)
  }
  return [...groups].map(([group, bucket]) => ({
    key: `group:${group}`,
    label: group,
    detail: bucket,
    children: bucket.map(row => ({ key: leafKey(row), label: leafLabel(row), detail: row })),
  }))
}
