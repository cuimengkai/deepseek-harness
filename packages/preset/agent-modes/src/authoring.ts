/**
 * Mode authoring: create, copy, delete, bind update, and flow save under a
 * writable user root.
 * @module @deepseek-ai/dsh-agent-modes/authoring
 */

import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  FLOW_FORMAT_VERSION,
  type FlowFile,
  type FlowGraph,
} from '@deepseek-ai/dsh-flow/types'
import { validateFlow } from '@deepseek-ai/dsh-flow'
import { MODE_ID, type ModeRoot } from './mode.ts'
import { BIND_FILE, renderModeBind, type ModeBind } from './bind.ts'
import { FLOWS_DIR } from './discovery.ts'
import { METADATA_FILE, renderModeMetadata, type ModeMetadata } from './metadata.ts'

/** Per-document size cap for a mode-owned flow file. */
const MAX_FLOW_BYTES = 1024 * 1024

/** Default entry-flow id for a newly created blank mode. */
export const DEFAULT_ENTRY_FLOW_ID = 'pipeline'

/** A mode id that fails the containment pattern. */
export class InvalidModeIdError extends Error {
  constructor(readonly modeId: string) {
    super(`agent-modes: mode id "${modeId}" is not kebab-case (lowercase letters, digits, hyphens)`)
  }
}

/** A write targeted a system mode or a root that is not writable. */
export class ModeNotWritableError extends Error {
  constructor(readonly modeId: string, readonly reason: string) {
    super(`agent-modes: mode "${modeId}" is not writable: ${reason}`)
  }
}

/** A create targeted an id that already exists. */
export class ModeExistsError extends Error {
  constructor(readonly modeId: string) {
    super(`agent-modes: mode "${modeId}" already exists`)
  }
}

/**
 * Minimal valid entry graph for a brand-new mode (start → one agent → end).
 * The agent prompt is a short authoring hint so the first canvas open is not blank.
 * @param entryFlowId - flow and graph id (must match `bind.entryFlow`).
 * @returns a graph the flow validator accepts.
 */
export function blankEntryGraph(entryFlowId: string = DEFAULT_ENTRY_FLOW_ID): FlowGraph {
  return {
    id: entryFlowId,
    name: entryFlowId,
    nodes: [
      { id: 'start', type: 'start', position: { x: 80, y: 160 }, label: 'Start' },
      {
        id: 'step',
        type: 'agent',
        position: { x: 320, y: 160 },
        label: 'Main step',
        prompt: 'Describe what this agent should accomplish in this mode.',
      },
      { id: 'end', type: 'end', position: { x: 560, y: 160 }, label: 'End' },
    ],
    edges: [
      { id: 'e-start-step', from: 'start', to: 'step' },
      { id: 'e-step-end', from: 'step', to: 'end' },
    ],
  }
}

/**
 * The first user-trust root, or undefined when the deployment has none.
 * @param roots - resolved roots in precedence order.
 * @returns the writable root, or undefined.
 */
export function writableRoot(roots: readonly ModeRoot[]): ModeRoot | undefined {
  return roots.find(root => root.trust === 'user')
}

/**
 * Absolute path of one mode's flow document.
 * @param modeDirectory - the mode directory.
 * @param flowId - the flow id (must match the graph's id).
 * @returns the flow document path.
 */
export function modeFlowPath(modeDirectory: string, flowId: string): string {
  return join(modeDirectory, FLOWS_DIR, `${flowId}.flow.json`)
}

/**
 * Read and validate one mode-owned flow document.
 * @param modeDirectory - the mode directory.
 * @param flowId - the flow id.
 * @returns the validated graph.
 */
export async function readModeFlow(modeDirectory: string, flowId: string): Promise<FlowGraph> {
  const path = modeFlowPath(modeDirectory, flowId)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`missing flow "${flowId}": ${error instanceof Error ? error.message : String(error)}`)
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_FLOW_BYTES) {
    throw new Error(`flow "${flowId}" exceeds the ${String(MAX_FLOW_BYTES)} byte cap`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`unparseable flow "${flowId}": ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !('formatVersion' in parsed) || !('flow' in parsed)) {
    throw new Error(`flow "${flowId}" is not a FlowFile`)
  }
  const file = parsed as FlowFile
  if (file.formatVersion !== FLOW_FORMAT_VERSION) {
    throw new Error(`flow "${flowId}" has unsupported formatVersion ${String(file.formatVersion)}`)
  }
  if (file.flow.id !== flowId) {
    throw new Error(`flow file id "${file.flow.id}" does not match path id "${flowId}"`)
  }
  const validation = validateFlow(file.flow)
  if (!validation.ok) {
    throw new Error(`invalid flow "${flowId}": ${validation.errors.join('; ')}`)
  }
  return file.flow
}

/**
 * Atomically write one mode-owned flow document.
 * @param modeDirectory - the mode directory.
 * @param graph - the validated graph to store.
 */
export async function writeModeFlow(modeDirectory: string, graph: FlowGraph): Promise<void> {
  const validation = validateFlow(graph)
  if (!validation.ok) {
    throw new Error(`cannot save an invalid flow: ${validation.errors.join('; ')}`)
  }
  const path = modeFlowPath(modeDirectory, graph.id)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const body = `${JSON.stringify({ formatVersion: FLOW_FORMAT_VERSION, flow: graph }, null, 2)}\n`
  if (Buffer.byteLength(body, 'utf8') > MAX_FLOW_BYTES) {
    throw new Error(`flow "${graph.id}" exceeds the ${String(MAX_FLOW_BYTES)} byte cap`)
  }
  await writeFileAtomic(path, body, { mode: 0o600, dirMode: 0o700 })
}

/**
 * Overwrite a mode's bind.yml.
 * @param modeDirectory - the mode directory.
 * @param bind - the bind contract to store.
 */
export async function writeModeBindFile(modeDirectory: string, bind: ModeBind): Promise<void> {
  await writeFile(join(modeDirectory, BIND_FILE), renderModeBind(bind), { mode: 0o600 })
}

/**
 * Overwrite a mode's optional display metadata.
 * @param modeDirectory - the mode directory.
 * @param metadata - display fields to store.
 */
export async function writeModeMetadataFile(
  modeDirectory: string,
  metadata: ModeMetadata,
): Promise<void> {
  const rendered = renderModeMetadata(metadata)
  if (rendered === undefined) {
    await rm(join(modeDirectory, METADATA_FILE), { force: true })
    return
  }
  await writeFile(join(modeDirectory, METADATA_FILE), rendered, { mode: 0o600 })
}

/**
 * Copy one mode directory into a writable root under a new id.
 * @param fromDirectory - the source mode directory.
 * @param toRoot - the writable user root.
 * @param id - the new mode id.
 * @param metadata - optional display override written as `mode.yml`.
 */
export async function copyMode(
  fromDirectory: string,
  toRoot: ModeRoot,
  id: string,
  metadata?: ModeMetadata,
): Promise<string> {
  if (!MODE_ID.test(id)) throw new InvalidModeIdError(id)
  const target = join(toRoot.path, id)
  try {
    await accessExists(target)
    throw new ModeExistsError(id)
  } catch (error) {
    if (error instanceof ModeExistsError) throw error
    // Target does not exist — proceed.
  }
  await mkdir(toRoot.path, { recursive: true, mode: 0o700 })
  await cp(fromDirectory, target, { recursive: true })
  if (metadata !== undefined) {
    await writeModeMetadataFile(target, metadata)
  }
  return target
}

/**
 * Write a brand-new mode directory (bind + metadata + entry flow).
 * @param toRoot - the writable user root.
 * @param id - the new mode id.
 * @param bind - the bind contract.
 * @param entryGraph - the entry flow graph (its id must equal `bind.entryFlow`).
 * @param metadata - optional display metadata.
 */
export async function writeMode(
  toRoot: ModeRoot,
  id: string,
  bind: ModeBind,
  entryGraph: FlowGraph,
  metadata?: ModeMetadata,
): Promise<string> {
  if (!MODE_ID.test(id)) throw new InvalidModeIdError(id)
  if (entryGraph.id !== bind.entryFlow) {
    throw new Error(`entry flow id "${entryGraph.id}" must equal bind.entryFlow "${bind.entryFlow}"`)
  }
  const target = join(toRoot.path, id)
  try {
    await accessExists(target)
    throw new ModeExistsError(id)
  } catch (error) {
    if (error instanceof ModeExistsError) throw error
  }
  await mkdir(target, { recursive: true, mode: 0o700 })
  await writeModeBindFile(target, bind)
  if (metadata !== undefined) {
    await writeModeMetadataFile(target, metadata)
  }
  await writeModeFlow(target, entryGraph)
  return target
}

/**
 * Delete one user mode directory.
 * @param directory - the mode directory to remove.
 */
export async function deleteMode(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}

/** Throw when `path` exists (any kind of entry). */
async function accessExists(path: string): Promise<void> {
  await access(path)
}
