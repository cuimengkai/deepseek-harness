/**
 * Flow document persistence: the id/file-name guard, the listing's skip rules,
 * the read/validate refusals, and delete's missing-document error.
 * @module tests/persistence
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowError } from '../src/error.ts'
import {
  FLOW_DIR_REL,
  deleteFlowFile,
  flowPath,
  listFlowFiles,
  readFlowFile,
  writeFlowFile,
} from '../src/persistence.ts'
import { FLOW_FORMAT_VERSION, type FlowAgentNode, type FlowEdge, type FlowGraph, type FlowNode } from '../src/types.ts'

/** Fields the per-type node helpers add; `Omit<FlowNode>` alone keeps only common keys. */
type NodeExtra = Partial<Omit<FlowAgentNode, 'id' | 'type' | 'position'>>

/** A node factory with a stable id and origin position. */
function node(type: FlowNode['type'], id: string, extra: NodeExtra): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, ...extra } as FlowNode
}

const start = (id = 'start') => node('start', id, {})
const end = (id = 'end') => node('end', id, {})
const agent = (id: string, prompt = 'work on it') => node('agent', id, { prompt })

/** Assemble a graph from nodes and edges, optionally with a description. */
function graph(nodes: readonly FlowNode[], edges: readonly FlowEdge[], extra?: { id?: string; description?: string }): FlowGraph {
  return { id: 'demo-flow', name: 'Demo', nodes, edges, ...extra }
}

/** A linear start → agent → end flow, the shape every round-trip test uses. */
function linearGraph(extra?: { id?: string; description?: string }): FlowGraph {
  return graph([start(), agent('a'), end()], [
    { id: 'e1', from: 'start', to: 'a' },
    { id: 'e2', from: 'a', to: 'end' },
  ], extra)
}

/** A persisted flow document for `graph`, hand-joined around the current format version. */
function flowDoc(graph: FlowGraph, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ formatVersion: FLOW_FORMAT_VERSION, flow: graph, ...extra })
}

describe('flowPath', () => {
  it('joins the flows directory for a kebab-case id', () => {
    expect(flowPath('/root', 'demo-flow')).toBe(join('/root', FLOW_DIR_REL, 'demo-flow.flow.json'))
  })

  it('refuses a non-kebab id that would smuggle a path', () => {
    expect(() => flowPath('/root', '../secret')).toThrow(FlowError)
    expect(() => flowPath('/root', '../secret')).toThrow(/not kebab-case/)
  })
})

describe('listFlowFiles', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-flow-list-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns [] when the flows directory does not exist yet', async () => {
    expect(await listFlowFiles(root)).toEqual([])
  })

  it('rethrows a non-missing readdir failure', async () => {
    // A regular file at the flows-directory path makes readdir fail with
    // ENOTDIR (not ENOENT), so the raw error surfaces rather than an empty list.
    await mkdir(join(root, '.dsh'), { recursive: true })
    await writeFile(join(root, FLOW_DIR_REL), 'a file, not a directory')
    const error = await listFlowFiles(root).then(() => undefined, (e: unknown) => e)
    expect(error).not.toBeInstanceOf(FlowError)
    expect((error as NodeJS.ErrnoException).code).not.toBe('ENOENT')
  })

  it('skips entries that are not .flow.json files', async () => {
    await writeFlowFile(root, linearGraph())
    await mkdir(join(root, FLOW_DIR_REL, 'subdir'), { recursive: true })
    await writeFile(join(root, FLOW_DIR_REL, 'notes.txt'), 'not a flow')
    expect(await listFlowFiles(root)).toEqual([
      { id: 'demo-flow', name: 'Demo', nodeCount: 3, updatedAt: expect.any(Number) as number },
    ])
  })

  it('sorts flows by id and carries the description only when present', async () => {
    await writeFlowFile(root, linearGraph({ id: 'beta' }))
    await writeFlowFile(root, linearGraph({ id: 'alpha', description: 'the first' }))
    expect(await listFlowFiles(root)).toEqual([
      { id: 'alpha', name: 'Demo', description: 'the first', nodeCount: 3, updatedAt: expect.any(Number) as number },
      { id: 'beta', name: 'Demo', nodeCount: 3, updatedAt: expect.any(Number) as number },
    ])
  })

  it('skips a corrupt document while leaving it on disk', async () => {
    await writeFlowFile(root, linearGraph())
    await writeFile(flowPath(root, 'demo-flow'), 'not json')
    expect(await listFlowFiles(root)).toEqual([])
  })
})

describe('readFlowFile', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-flow-read-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('round-trips a document written by writeFlowFile', async () => {
    const g = linearGraph({ description: 'with a description' })
    await writeFlowFile(root, g)
    expect(await readFlowFile(root, 'demo-flow')).toEqual(g)
  })

  it('fails FLOW_NOT_FOUND for a missing document', async () => {
    await expect(readFlowFile(root, 'demo-flow')).rejects.toThrow(/does not exist/)
  })

  it('rethrows a non-ENOENT read failure', async () => {
    // A directory at the document path makes readFile fail with EISDIR, which
    // is not a missing path, so the raw error surfaces rather than FLOW_NOT_FOUND.
    await mkdir(flowPath(root, 'demo-flow'), { recursive: true })
    await expect(readFlowFile(root, 'demo-flow')).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('refuses an oversized document', async () => {
    await mkdir(join(root, FLOW_DIR_REL), { recursive: true })
    await writeFile(flowPath(root, 'demo-flow'), ' '.repeat(1024 * 1024 + 16))
    await expect(readFlowFile(root, 'demo-flow')).rejects.toThrow(/size cap/)
  })

  it('refuses a document that is not JSON', async () => {
    await mkdir(join(root, FLOW_DIR_REL), { recursive: true })
    await writeFile(flowPath(root, 'demo-flow'), 'not json')
    await expect(readFlowFile(root, 'demo-flow')).rejects.toThrow(/not valid JSON/)
  })

  it('refuses an unsupported format version and a non-document payload', async () => {
    await mkdir(join(root, FLOW_DIR_REL), { recursive: true })
    await writeFile(flowPath(root, 'demo-flow'), flowDoc(linearGraph(), { formatVersion: 999 }))
    await expect(readFlowFile(root, 'demo-flow')).rejects.toThrow(/unsupported format version/)
    // A bare scalar is not a document object at all; it hits the same refusal.
    await writeFile(flowPath(root, 'demo-flow'), '42')
    await expect(readFlowFile(root, 'demo-flow')).rejects.toThrow(/unsupported format version/)
  })

  it('refuses a stored graph that fails validation', async () => {
    await mkdir(join(root, FLOW_DIR_REL), { recursive: true })
    // A second start node makes the graph invalid; the node list is readonly,
    // so the bad graph is assembled rather than mutated.
    const base = linearGraph()
    const bad = { ...base, nodes: [...base.nodes, node('start', 'start2', {})] }
    await writeFile(flowPath(root, 'demo-flow'), flowDoc(bad))
    await expect(readFlowFile(root, 'demo-flow')).rejects.toThrow(/is invalid/)
  })

  it('refuses a document whose id contradicts the file name', async () => {
    await mkdir(join(root, FLOW_DIR_REL), { recursive: true })
    await writeFile(flowPath(root, 'demo-flow'), flowDoc(linearGraph({ id: 'other-flow' })))
    await expect(readFlowFile(root, 'demo-flow')).rejects.toThrow(/stored under a different id/)
  })
})

describe('deleteFlowFile', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-flow-del-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('deletes a saved document', async () => {
    await writeFlowFile(root, linearGraph())
    await deleteFlowFile(root, 'demo-flow')
    await expect(readFlowFile(root, 'demo-flow')).rejects.toThrow(/does not exist/)
  })

  it('fails FLOW_NOT_FOUND for a missing document', async () => {
    await expect(deleteFlowFile(root, 'demo-flow')).rejects.toThrow(/does not exist/)
  })

  it('rethrows a non-ENOENT unlink failure', async () => {
    // unlink on a directory fails with an errno that is not ENOENT (EISDIR on
    // Linux, EPERM on macOS), so the raw error surfaces rather than FLOW_NOT_FOUND.
    await mkdir(flowPath(root, 'demo-flow'), { recursive: true })
    const error = await deleteFlowFile(root, 'demo-flow').then(() => undefined, (e: unknown) => e)
    expect(error).not.toBeInstanceOf(FlowError)
    expect((error as NodeJS.ErrnoException).code).not.toBe('ENOENT')
  })
})
