/**
 * Flow document persistence under `<cwd>/.dsh/flows/<id>.flow.json`. One
 * versioned document per flow, written atomically with user-private modes.
 *
 * A flow id is also a file name, so the kebab-case id pattern is enforced here
 * (not only at validation) as the path-traversal guard; an id that never passed
 * `validateFlow` cannot be smuggled through `flowPath`.
 * @module @deepseek-ai/dsh-flow/persistence
 */

import { readFile, readdir, stat, unlink } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { FlowError } from './error.ts'
import { FLOW_FORMAT_VERSION, type FlowFile, type FlowGraph, type FlowSummary } from './types.ts'
import { validateFlow } from './validate.ts'

/** The flows directory, relative to the owning project root. */
export const FLOW_DIR_REL = '.dsh/flows'
/** On-disk suffix of a flow document. */
const FLOW_FILE_EXT = '.flow.json'
/** Per-document size cap; a flow graph is small and a larger doc is malformed. */
const MAX_FLOW_BYTES = 1024 * 1024
/** A valid kebab-case flow id (also the persisted file name). */
const FLOW_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * The absolute path of a flow document, or throws for a non-kebab id.
 * @param root - the workspace root directory.
 * @param flowId - the flow id (kebab-case).
 * @returns the flow document's absolute path.
 */
export function flowPath(root: string, flowId: string): string {
  if (!FLOW_ID_PATTERN.test(flowId)) {
    throw new FlowError(`flow id "${flowId}" is not kebab-case (lowercase letters, digits, hyphens)`, 'FLOW_INVALID')
  }
  return join(root, FLOW_DIR_REL, `${flowId}${FLOW_FILE_EXT}`)
}

/**
 * List the saved flows under `root`, sorted by id, reading each document for
 * its current name/node count. An unparseable or race-deleted document is
 * skipped rather than failing the whole listing; reading it directly fails
 * loud via {@link readFlowFile}.
 * @param root - the project root whose `.dsh/flows` directory is listed.
 * @returns the flow summaries, oldest saves first by id order.
 */
export async function listFlowFiles(root: string): Promise<FlowSummary[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(join(root, FLOW_DIR_REL), { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const flows: FlowSummary[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(FLOW_FILE_EXT)) continue
    const id = entry.name.slice(0, -FLOW_FILE_EXT.length)
    try {
      const [info, graph] = await Promise.all([stat(join(root, FLOW_DIR_REL, entry.name)), readFlowFile(root, id)])
      flows.push({
        id,
        name: graph.name,
        ...(graph.description === undefined ? {} : { description: graph.description }),
        nodeCount: graph.nodes.length,
        updatedAt: info.mtimeMs,
      })
    } catch {
      // A corrupt document stays on disk so it can be deleted by hand; the
      // listing omits it rather than surfacing every bad file at once.
    }
  }
  flows.sort((a, b) => a.id.localeCompare(b.id))
  return flows
}

/**
 * Read and validate one flow document. Refuses an oversized file, a missing
 * one, an unsupported `formatVersion`, a graph that fails structural
 * validation, and an id/name that contradicts the file name.
 * @param root - the project root.
 * @param flowId - the flow's id (also the file name).
 * @returns the validated graph.
 * @throws {@link FlowError} with `FLOW_NOT_FOUND`, `FLOW_VERSION`, or
 *   `FLOW_INVALID` for each refusal.
 */
export async function readFlowFile(root: string, flowId: string): Promise<FlowGraph> {
  const path = flowPath(root, flowId)
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingPathError(error)) throw new FlowError(`flow "${flowId}" does not exist`, 'FLOW_NOT_FOUND')
    throw error
  }
  if (content.length > MAX_FLOW_BYTES) {
    throw new FlowError(`flow "${flowId}" exceeds the ${MAX_FLOW_BYTES}-byte size cap`, 'FLOW_INVALID')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new FlowError(`flow "${flowId}" is not valid JSON`, 'FLOW_INVALID', { cause: error })
  }
  if (!isFlowFile(parsed)) {
    throw new FlowError(`flow "${flowId}" carries an unsupported format version`, 'FLOW_VERSION')
  }
  const validation = validateFlow(parsed.flow)
  if (!validation.ok) {
    throw new FlowError(`flow "${flowId}" is invalid: ${validation.errors.join('; ')}`, 'FLOW_INVALID')
  }
  if (parsed.flow.id !== flowId) {
    throw new FlowError(`flow "${flowId}" is stored under a different id "${parsed.flow.id}"`, 'FLOW_INVALID')
  }
  return parsed.flow
}

/** Whether `value` is a flow document with the current format version. */
function isFlowFile(value: unknown): value is FlowFile {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  return doc.formatVersion === FLOW_FORMAT_VERSION && typeof doc.flow === 'object' && doc.flow !== null
}

/**
 * Atomically write a flow document (creating `.dsh/flows` on first save). The
 * caller validates the graph before calling; the id pattern is re-checked by
 * {@link flowPath} as the file-name guard.
 * @param root - the project root.
 * @param graph - the graph to persist under `<id>.flow.json`.
 */
export async function writeFlowFile(root: string, graph: FlowGraph): Promise<void> {
  const doc: FlowFile = { formatVersion: FLOW_FORMAT_VERSION, flow: graph }
  await writeFileAtomic(flowPath(root, graph.id), `${JSON.stringify(doc, null, 2)}\n`, {
    mode: 0o600,
    dirMode: 0o700,
  })
}

/**
 * Delete a flow document.
 * @param root - the project root.
 * @param flowId - the flow's id.
 * @throws {@link FlowError} with `FLOW_NOT_FOUND` when no such document exists.
 */
export async function deleteFlowFile(root: string, flowId: string): Promise<void> {
  try {
    await unlink(flowPath(root, flowId))
  } catch (error) {
    if (isMissingPathError(error)) throw new FlowError(`flow "${flowId}" does not exist`, 'FLOW_NOT_FOUND')
    throw error
  }
}

/** Whether `error` is a filesystem ENOENT (a missing path). */
function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}
