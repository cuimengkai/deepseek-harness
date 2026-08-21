/**
 * Process-out engine driver: delegates one agent run to a dedicated child
 * engine process whose data lives in a per-workspace store and JSONL log
 * root — the physical-isolation mechanism for isolated workspaces (the e2b
 * family is a remote-VM backend on the same seam). The driver spawns the child
 * through `ctx.subprocess`, sends the drive over stdin, and reads the child's
 * single JSON result line off stdout. Session persistence is file-backed and
 * process-agnostic, so `readLog`/`listSessions` read the durable JSONL logs
 * the child wrote.
 * @module @deepseek-ai/dsh-experimental-engine-isolation/process-out
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell'
import { EngineIsolationError } from './error.ts'
import type { AgentRunRequest, EngineDriver, RunHandle } from './types.ts'

/** Configuration for the process-out engine driver. */
export interface ProcessOutConfig {
  /** Absolute path to the child engine worker script (its assembly entry). */
  readonly workerScript: string
  /** Scratch root; each isolated workspace owns `storeRoot/<workspace>/`. */
  readonly storeRoot: string
  /** Log root; each isolated workspace appends its JSONL logs under `logRoot/<workspace>/`. */
  readonly logRoot: string
  /** Working directory for the child process. */
  readonly cwd: string
  /** Grace period (ms) for the child's terminate escalation. */
  readonly graceMs: number
  /** Extra node args before the worker script (a TS source worker needs `['--import', 'tsx/esm']`). */
  readonly nodeArgs?: string[]
}

/** The child's single stdout result line (the last non-empty stdout line). */
export interface WorkerResult {
  readonly ok: boolean
  readonly sessionId: string
  readonly pid: number
  readonly storePath: string
  readonly logRoot: string
}

/** Max retained child stdout bytes; the result line rides the tail. */
const MAX_RESULT_BYTES = 64 * 1024
/** Max child stdout spill bytes before the retained window is lossy. */
const MAX_SPILL_BYTES = 256 * 1024
/** The sqlite store filename inside each isolated workspace's store dir. */
const STORE_FILENAME = 'platform.sqlite'

/**
 * Whether one stdout value has the child result-line shape.
 * @param value - the parsed stdout value to check.
 * @returns true when every result field is present with its declared type.
 */
function isWorkerResult(value: unknown): value is WorkerResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.ok === 'boolean'
    && typeof record.sessionId === 'string'
    && typeof record.pid === 'number'
    && typeof record.storePath === 'string'
    && typeof record.logRoot === 'string'
}

/**
 * Parse the child's single JSON result line (the last non-empty stdout line).
 * @param stdout - the child's collected stdout.
 * @returns the parsed result line.
 * @throws EngineIsolationError when the line is absent or not a valid result.
 */
export function parseWorkerResult(stdout: string): WorkerResult {
  const lines = stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  const line = lines[lines.length - 1]
  if (line === undefined) {
    throw new EngineIsolationError('ENGINE_SPAWN_FAILED', 'child engine printed no result line')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new EngineIsolationError('ENGINE_SPAWN_FAILED', `child engine result line is not JSON: ${line}`)
  }
  if (!isWorkerResult(parsed)) {
    throw new EngineIsolationError('ENGINE_SPAWN_FAILED', `child engine result line is missing fields: ${line}`)
  }
  return parsed
}

/**
 * Collect every `.jsonl` session-log file under a root.
 * @param root - the directory to walk recursively.
 * @returns the sorted log file paths; a missing root yields an empty list.
 */
async function jsonlFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // A missing or torn log root simply holds no logs yet.
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.jsonl')) found.push(path)
    }
  }
  await walk(root)
  return found.sort()
}

/**
 * The first non-empty line of one file, trimmed.
 * @param path - the file to read.
 * @returns the first line, or undefined when the file is unreadable or empty.
 */
async function firstLine(path: string): Promise<string | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    // A torn or vanished log yields no header line.
    return undefined
  }
  return raw.split('\n').map(line => line.trim()).find(line => line.length > 0)
}

/**
 * The session id one log's header line names.
 * @param path - the log file to inspect.
 * @returns the header's session id, or undefined when the file is not a log.
 */
async function headerId(path: string): Promise<string | undefined> {
  const line = await firstLine(path)
  if (line === undefined) return undefined
  let parsed: { type?: unknown; id?: unknown }
  try {
    parsed = JSON.parse(line) as { type?: unknown; id?: unknown }
  } catch {
    return undefined
  }
  return parsed.type === 'session' && typeof parsed.id === 'string' ? parsed.id : undefined
}

/**
 * Read one session's durable event log from a log root (uncompressed JSONL).
 * @param root - the log root to search.
 * @param sessionId - the session whose log to read.
 * @returns the session's committed events, or an empty list when absent.
 */
async function readSessionLog(root: string, sessionId: SessionId): Promise<readonly SessionEvent[]> {
  const id = String(sessionId)
  for (const file of await jsonlFiles(root)) {
    if (await headerId(file) !== id) continue
    const raw = await readFile(file, 'utf8')
    return raw.split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as { type?: string })
      .filter(record => record.type !== 'session')
      .map(record => record as SessionEvent)
  }
  return []
}

/**
 * List the session ids durable in a log root.
 * @param root - the log root to search.
 * @returns the committed session ids, in log discovery order.
 */
async function listSessionIds(root: string): Promise<readonly SessionId[]> {
  const ids: string[] = []
  for (const file of await jsonlFiles(root)) {
    const id = await headerId(file)
    if (id !== undefined) ids.push(id)
  }
  return ids.map(id => SessionId(id))
}

/**
 * The process-out {@link EngineDriver}: spawns a dedicated child engine for an
 * isolated workspace and returns a handle whose store and log live in the
 * child's per-workspace roots.
 */
export class ProcessOutEngineDriver implements EngineDriver {
  readonly kind = 'process-out' as const

  /**
   * @param ctx - context carrying the subprocess seam.
   * @param config - the child spawn and scratch-root facts.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: ProcessOutConfig,
  ) {}

  /**
   * Spawn the child engine, send the drive over stdin, and read the result line.
   * @param request - the run to delegate.
   * @returns the child's reported handle.
   * @throws EngineIsolationError when the child fails to spawn or exit cleanly.
   */
  async drive(request: AgentRunRequest): Promise<RunHandle> {
    const workspace = String(request.workspaceId)
    const storePath = join(this.config.storeRoot, workspace, STORE_FILENAME)
    const logRoot = join(this.config.logRoot, workspace)
    const child = this.ctx.subprocess.spawn(this.spawnSpec(request, storePath, logRoot))
    // The child reads stdin to EOF before driving; a failed spawn (pid -1)
    // rejects `done` below, so no stdin write happens for a process that never
    // started.
    if (child.pid > 0) child.stdin?.end(JSON.stringify(request.drive) + '\n')
    const outcome = await child.done
    const collected = child.collected.stdout?.readFrom(0)
    const stdout = collected?.text ?? ''
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      throw new EngineIsolationError(
        'ENGINE_SPAWN_FAILED',
        `child engine exited ${outcome.exitCode !== null ? `code ${outcome.exitCode}` : `on ${String(outcome.signal)}`}`,
      )
    }
    const result = parseWorkerResult(stdout)
    return {
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      pid: result.pid,
      status: result.ok ? 'completed' : 'failed',
      storePath: result.storePath,
      logRoot: result.logRoot,
    }
  }

  /**
   * List the sessions the process-out engine holds for one workspace.
   * @param workspaceId - the workspace whose per-workspace log root to scan.
   * @returns the committed session ids under `logRoot/<workspace>/`.
   */
  async listSessions(workspaceId: WorkspaceId): Promise<readonly SessionId[]> {
    return listSessionIds(join(this.config.logRoot, String(workspaceId)))
  }

  /**
   * Read one session's durable log from the process-out log roots.
   * @param sessionId - the session whose log to read.
   * @returns the committed events, or an empty list when the session is absent.
   */
  async readLog(sessionId: SessionId): Promise<readonly SessionEvent[]> {
    return readSessionLog(this.config.logRoot, sessionId)
  }

  /** Build the fully-specified spawn request for one drive (no seam defaults). */
  private spawnSpec(request: AgentRunRequest, storePath: string, logRoot: string): SubprocessSpawnSpec {
    return {
      argv: [
        process.execPath,
        ...(this.config.nodeArgs ?? []),
        this.config.workerScript,
        '--store', storePath,
        '--logroot', logRoot,
        '--session', String(request.sessionId),
        '--workspace', String(request.workspaceId),
      ],
      cwd: this.config.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: { maxBytes: MAX_RESULT_BYTES, spill: { maxBytes: MAX_SPILL_BYTES } },
        stderr: 'inherit',
      },
      graceMs: this.config.graceMs,
    }
  }
}
