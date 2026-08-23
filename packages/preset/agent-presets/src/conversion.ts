/**
 * Preset composition graphs: the chain projection that turns an ordered
 * composition-row list into a `FlowGraph`, and back.
 *
 * A preset composition is an ordered row list that MOUNTS into the agent's
 * standing scope — order is load-bearing. The graph is that list projected as
 * `start → one agent node per row → end` in mount order; each agent node's
 * `composition` field carries exactly the JSON-safe `ComposeRow` subset, so the
 * round trip is lossless and the rows composer's validation accepts the result
 * unchanged. The graph is the AUTHORING source (positions and edges live in the
 * companion `agent.flow.json`), and `graphToRows` is what feeds a save:
 * `composeGraph` derives the rows here and validates them three ways exactly as
 * `compose` does.
 *
 * A preset graph admits only start/end/agent nodes — a condition or loop node
 * is refused, because branching the composition itself is Phase B3 — and must
 * be acyclic. `graphToRows` returns rows in Kahn topological order, stable on
 * node id: exactly mount order for the chain projection, and a deterministic
 * order for any other DAG. A cycle or a disallowed node is an error, not a
 * silent reorder.
 * @module @deepseek-ai/dsh-agent-presets/conversion
 */

import type { FlowAgentNode, FlowGraph } from '@deepseek-ai/dsh-flow/types'
import type { ComposeRow } from './index.ts'

/** One preset graph's on-disk document version; readers refuse any other. */
export const PRESET_GRAPH_FORMAT_VERSION = 1

/** The companion layout file beside a preset's `agent.cordis.yml`. */
export const PRESET_GRAPH_FILE = 'agent.flow.json'

/** Cap on the preset graph document a preset may carry. */
export const PRESET_GRAPH_MAX_BYTES = 256 * 1024

/** The on-disk preset graph document under a preset directory. */
export interface PresetGraphDocument {
  readonly formatVersion: typeof PRESET_GRAPH_FORMAT_VERSION
  readonly graph: FlowGraph
}

/** X-offset between chain nodes in a regenerated cascade layout. */
const CASCADE_X = 220

/** The canvas-internal node id minted for the n-th composition row (1-based). */
function nodeIdFor(index: number): string {
  return `agent-${index + 1}`
}

/**
 * Project an ordered composition row list into a chain `FlowGraph`.
 *
 * Each row becomes one `agent` node carrying the row's JSON-safe subset as
 * `composition`, laid out as a left-to-right cascade with the `start`/`end`
 * sentinels at the ends. This is the open/regeneration path: a preset with no
 * `agent.flow.json`, or whose stored layout no longer matches its composition,
 * renders its rows here. Node ids are canvas-internal (`agent-1`, ...); an
 * id-less row keeps `composition.id` undefined.
 * @param id - the preset id, which becomes the graph id.
 * @param name - the display name the graph should carry.
 * @param rows - the composition rows in mount order.
 * @returns the chain projection graph.
 */
export function rowsToGraph(id: string, name: string, rows: readonly ComposeRow[]): FlowGraph {
  const nodes: FlowGraph['nodes'] = [
    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
    ...rows.map((row, index) => {
      const node: FlowAgentNode = {
        id: nodeIdFor(index),
        type: 'agent',
        position: { x: CASCADE_X * (index + 1), y: 0 },
        prompt: '',
        composition: {
          module: row.name,
          ...row.id === undefined ? {} : { id: row.id },
          ...row.config === undefined ? {} : { config: row.config },
          ...row.group === undefined ? {} : { group: row.group },
          ...row.disabled === undefined ? {} : { disabled: row.disabled },
          ...row.inject === undefined ? {} : { inject: row.inject },
        },
      }
      return node
    }),
    { id: 'end', type: 'end', position: { x: CASCADE_X * (rows.length + 1), y: 0 } },
  ]
  const edges: FlowGraph['edges'] = rows.length === 0
    ? [{ id: 'e-start', from: 'start', to: 'end' }]
    : [
      { id: 'e-start', from: 'start', to: nodeIdFor(0) },
      ...rows.slice(0, -1).map((_, index) => ({
        id: `e-${index}`,
        from: nodeIdFor(index),
        to: nodeIdFor(index + 1),
      })),
      { id: 'e-end', from: nodeIdFor(rows.length - 1), to: 'end' },
    ]
  return { id, name, nodes, edges }
}

/**
 * Extract one preset graph's composition rows, in mount order.
 *
 * The inverse of {@link rowsToGraph}: each `agent` node's `composition` field
 * becomes a row, in Kahn topological order (stable on node id — exactly the
 * chain order for the projection, a deterministic order for any other DAG).
 * Only start/end/agent nodes are admitted — a condition or loop node is
 * refused, because branching the composition itself is Phase B3 — and a cycle
 * is an error rather than a silently arbitrary order.
 * @param graph - a preset composition graph.
 * @returns the composition rows in mount order.
 * @throws when the graph holds a condition/loop node, an agent node without a
 * `composition.module`, or a cycle.
 */
export function graphToRows(graph: FlowGraph): ComposeRow[] {
  const agents = new Map<string, FlowAgentNode>()
  for (const node of graph.nodes) {
    switch (node.type) {
      case 'start':
      case 'end':
        break
      case 'agent':
        if (node.composition === undefined || node.composition.module === '') {
          throw new Error(
            `agent-presets: preset graph node "${node.id}" is an agent without a composition module; `
            + 'every preset agent node must project the plugin module it composes',
          )
        }
        agents.set(node.id, node)
        break
      case 'condition':
      case 'loop':
        throw new Error(
          `agent-presets: preset graph node "${node.id}" is a ${node.type} node; `
          + 'a preset composition admits only start, end, and agent nodes (branching is a later phase)',
        )
    }
  }
  // Kahn's algorithm with a stable (node-id) tie-break: the chain projection
  // yields exactly mount order, and any other DAG yields a deterministic order.
  const incoming = new Map<string, string[]>(graph.nodes.map(node => [node.id, []]))
  const outgoing = new Map<string, string[]>(graph.nodes.map(node => [node.id, []]))
  for (const edge of graph.edges) {
    incoming.get(edge.to)?.push(edge.from)
    outgoing.get(edge.from)?.push(edge.to)
  }
  const ready = graph.nodes.map(node => node.id).filter(id => (incoming.get(id) ?? []).length === 0)
  const ordered: string[] = []
  while (ready.length > 0) {
    ready.sort()
    const current = ready.shift()
    if (current === undefined) break
    ordered.push(current)
    for (const next of outgoing.get(current) ?? []) {
      const predecessors = incoming.get(next)
      if (predecessors === undefined) continue
      const index = predecessors.indexOf(current)
      if (index >= 0) predecessors.splice(index, 1)
      if (predecessors.length === 0) ready.push(next)
    }
  }
  if (ordered.length !== graph.nodes.length) {
    throw new Error('agent-presets: preset graph has a cycle; a composition must be a directed acyclic graph')
  }
  return ordered.flatMap((id) => {
    const node = agents.get(id)
    if (node === undefined) return []
    const composition = node.composition
    if (composition === undefined) return []
    return [{
      name: composition.module,
      ...composition.id === undefined ? {} : { id: composition.id },
      ...composition.config === undefined ? {} : { config: composition.config },
      ...composition.group === undefined ? {} : { group: composition.group },
      ...composition.disabled === undefined ? {} : { disabled: composition.disabled },
      ...composition.inject === undefined ? {} : { inject: composition.inject },
    }]
  })
}

/**
 * Whether a stored graph still projects the composition it was saved with.
 *
 * The staleness rule behind the graph read: rows are the composition truth (a
 * hand edit or a legacy rows-composer write wins), so a stored layout serves
 * only while its own rows still equal the composition parsed from disk. The
 * check also covers a partial dual-file write and an unreadable graph — both
 * answer false and force a regeneration.
 * @param graph - the stored graph.
 * @param rows - the composition rows parsed from `agent.cordis.yml`.
 * @returns true when the graph projects exactly `rows`.
 */
export function graphRowsMatch(graph: FlowGraph, rows: readonly ComposeRow[]): boolean {
  let projected: ComposeRow[]
  try {
    projected = graphToRows(graph)
  } catch {
    return false
  }
  if (projected.length !== rows.length) return false
  // The length guard makes every `projected` index in-bounds in `rows`; the
  // undefined guard is the noUncheckedIndexedAccess narrowing, not a fallback.
  return projected.every((row, index) => {
    const other = rows[index]
    return other !== undefined && sameRow(row, other)
  })
}

/** Whether two composition rows carry the same JSON-safe fields. */
function sameRow(a: ComposeRow, b: ComposeRow): boolean {
  return a.name === b.name
    && a.id === b.id
    && a.group === b.group
    && jsonEqual(a.config, b.config)
    && jsonEqual(a.disabled, b.disabled)
    && jsonEqual(a.inject, b.inject)
}

/** Structural equality over JSON values (config, disabled, inject round-trip through the wire). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]))
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const aKeys = Object.keys(a).sort()
    const bKeys = Object.keys(b).sort()
    return aKeys.length === bKeys.length
      && aKeys.every((key, index) => key === bKeys[index]
        && jsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  }
  return false
}
