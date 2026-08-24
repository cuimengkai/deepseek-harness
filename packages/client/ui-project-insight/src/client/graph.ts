/**
 * Pure graph derivation for the two dependency sections. Turning a committed
 * module-topology or component-dependency section into a bounded node/edge
 * set is a deterministic mapping, so it lives apart from the rendering
 * component: the derivation is unit-testable and the rendering wrapper stays
 * thin. Both graphs share the same caps and the same "every edge endpoint is a
 * node" invariant — an import whose target is not among the emitted rows is
 * dropped rather than stubbed, because a graph with dangling edges would not
 * render.
 * @module @deepseek-ai/dsh-client-ui-project-insight/client/graph
 */

import type {
  ComponentDependenciesSection,
  ModuleTopologySection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'

/** A graph node: a stable id plus the short label rendered on it. */
export interface GraphNode {
  /** Node id — the root-relative module or component path. */
  readonly id: string
  /** Label rendered on the node; alias-relative when an alias matches. */
  readonly label: string
}

/** A directed dependency edge between two node ids. */
export interface GraphEdge {
  readonly source: string
  readonly target: string
}

/** The bounded element set plus what the caps dropped. */
export interface SectionGraph {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  /** Node ids participating in a dependency cycle. */
  readonly cycleNodeIds: ReadonlySet<string>
  /** Candidate nodes and edges the caps dropped, for the completeness note. */
  readonly capped: { readonly nodes: number; readonly edges: number }
}

/** Render caps applied before the graph reaches the layout. */
export interface GraphCaps {
  /** Maximum nodes rendered; the highest-degree candidates win. */
  readonly maxNodes: number
  /** Maximum edges rendered; the lexicographically-first wins. */
  readonly maxEdges: number
}

/** Default caps: enough to stay legible on a wide source tree. */
export const DEFAULT_GRAPH_CAPS: GraphCaps = { maxNodes: 120, maxEdges: 500 }

/** An import target that resolves outside the project (`external:<name>`). */
const EXTERNAL_PREFIX = 'external:'

/**
 * Derive the bounded module-topology graph: nodes are the source files with at
 * least one rendered internal edge (importing or imported), edges are the
 * internal imports whose target is among the emitted files, and each label is
 * the alias-relative path when an alias value prefixes the path.
 * @param section - committed module-topology section.
 * @param caps - node/edge render caps.
 * @returns bounded node/edge sets plus cycle highlight (always empty here).
 */
export function deriveModuleGraph(
  section: ModuleTopologySection,
  caps: GraphCaps = DEFAULT_GRAPH_CAPS,
): SectionGraph {
  const known = new Set(section.files.map(file => file.path))
  const importsByPath = new Map(section.files.map(file => [file.path, file.imports]))

  const internalEdges = (path: string): readonly string[] =>
    (importsByPath.get(path) ?? []).filter(target =>
      !target.startsWith(EXTERNAL_PREFIX) && known.has(target) && target !== path)

  // Total incident edges per file; a node with no rendered edge would be an
  // isolated dot, so candidates are filtered by degree before capping.
  const degree = new Map<string, number>()
  const outEdges = new Map<string, readonly string[]>()
  for (const file of section.files) {
    const edges = internalEdges(file.path)
    outEdges.set(file.path, edges)
    degree.set(file.path, (degree.get(file.path) ?? 0) + edges.length)
    for (const target of edges) degree.set(target, (degree.get(target) ?? 0) + 1)
  }

  const candidates = section.files
    .filter(file => (degree.get(file.path) ?? 0) > 0)
    .sort((left, right) =>
      (degree.get(right.path) ?? 0) - (degree.get(left.path) ?? 0)
      || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  const selected = candidates.slice(0, caps.maxNodes)
  const selectedIds = new Set(selected.map(file => file.path))

  const { edges, droppedEdges } = collectEdges(selected, outEdges, selectedIds, caps.maxEdges)

  return {
    nodes: selected.map(file => ({ id: file.path, label: aliasLabel(file.path, section.aliases) })),
    edges,
    cycleNodeIds: new Set<string>(),
    capped: { nodes: Math.max(0, candidates.length - caps.maxNodes), edges: droppedEdges },
  }
}

/**
 * Derive the bounded component-dependency graph: every emitted component is a
 * node (the scanner already caps the set), edges are the component-to-component
 * imports, and the cycle set is the union of the section's mutual-import pairs.
 * @param section - committed component-dependency section.
 * @param caps - edge render caps.
 * @returns bounded node/edge sets plus the cycle-highlight node ids.
 */
export function deriveComponentGraph(
  section: ComponentDependenciesSection,
  caps: GraphCaps = DEFAULT_GRAPH_CAPS,
): SectionGraph {
  const known = new Set(section.components.map(component => component.path))
  const importsByPath = new Map(section.components.map(component => [component.path, component.imports]))

  const { edges, droppedEdges } = collectEdges(
    section.components,
    importsByPath,
    known,
    caps.maxEdges,
  )

  const cycleNodeIds = new Set<string>()
  for (const [left, right] of section.cycles) {
    cycleNodeIds.add(left)
    cycleNodeIds.add(right)
  }

  return {
    nodes: section.components.map(component => ({ id: component.path, label: component.path })),
    edges,
    cycleNodeIds,
    capped: { nodes: 0, edges: droppedEdges },
  }
}

/**
 * Build the edge set among the selected rows: one directed edge per resolved
 * import whose target is in the selection, self-loops and duplicates dropped,
 * then truncate to the edge cap by a deterministic lexicographic sort.
 */
function collectEdges(
  selected: readonly { readonly path: string }[],
  importsByPath: ReadonlyMap<string, readonly string[]>,
  selectedIds: ReadonlySet<string>,
  maxEdges: number,
): { readonly edges: readonly GraphEdge[]; readonly droppedEdges: number } {
  const all: GraphEdge[] = []
  const seen = new Set<string>()
  for (const row of selected) {
    for (const target of importsByPath.get(row.path) ?? []) {
      if (!selectedIds.has(target) || target === row.path) continue
      const key = `${row.path}\u0000${target}`
      if (seen.has(key)) continue
      seen.add(key)
      all.push({ source: row.path, target })
    }
  }
  all.sort((left, right) =>
    left.source === right.source
      ? (left.target < right.target ? -1 : left.target > right.target ? 1 : 0)
      : (left.source < right.source ? -1 : 1))
  return { edges: all.slice(0, maxEdges), droppedEdges: Math.max(0, all.length - maxEdges) }
}

/**
 * Shorten a module path through its resolved path aliases: the longest alias
 * value that prefixes the path becomes its key, so `src/components/Button.tsx`
 * under `@ → src` renders as `@/components/Button.tsx`.
 */
function aliasLabel(
  path: string,
  aliases: readonly { readonly key: string; readonly value: string }[],
): string {
  let best: { readonly key: string; readonly value: string } | undefined
  for (const alias of aliases) {
    if (path !== alias.value && !path.startsWith(`${alias.value}/`)) continue
    if (best === undefined
      || alias.value.length > best.value.length
      || (alias.value.length === best.value.length && alias.key < best.key)) {
      best = alias
    }
  }
  if (best === undefined) return path
  return path === best.value ? best.key : `${best.key}${path.slice(best.value.length)}`
}
