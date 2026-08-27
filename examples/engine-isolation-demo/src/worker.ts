/**
 * engine-isolation-demo process-out child engine. The host driver spawns this
 * script for an ISOLATED workspace, passes the drive over stdin, and reads one
 * JSON result line off stdout. The child boots the SAME cordis.yml as the
 * parent, but with two id-targeted overrides: the platform-shell store path
 * points at the isolated workspace's per-workspace SQLite file and the
 * persistence root at the workspace's JSONL log root. Before boot it raw-seeds
 * that store with the parent's workspace identity (the workspace row, a user,
 * the product membership, and the default roles), so the drive's `register_asset`
 * commits into a store that literally contains the isolated workspace — the
 * physical-isolation proof the demo asserts. It then binds the session, drives
 * one agent turn against the scripted `engine-demo` provider, flushes the
 * durable session log, and exits 0 after printing the result line.
 * @module engine-isolation-demo-worker
 */

import { chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { openDatabase } from '@deepseek-ai/dsh-experimental-platform-shell/src/schema.ts'
import { loadSqliteConstructor } from '@deepseek-ai/dsh-experimental-platform-shell/src/database.ts'
import { assignRole, insertUser, insertWorkspace, upsertRole } from '@deepseek-ai/dsh-experimental-platform-shell/src/identity.ts'
import { DEFAULT_ROLES } from '@deepseek-ai/dsh-experimental-platform-shell/src/service.ts'
import { RoleId, UserId, WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell/src/types.ts'
import type { AgentDrive } from '@deepseek-ai/dsh-experimental-engine-isolation/src/types.ts'
import { bindActor } from './engine-isolation-demo.ts'
import { findAgent, waitForStatus } from './shared.ts'

const COMPOSE_PATH = fileURLToPath(new URL('../cordis.yml', import.meta.url))

/** One arg-parsed drive invocation. */
interface WorkerArgs {
  storePath: string
  logRoot: string
  sessionId: string
  workspaceId: string
}

/** Parse the `--store/--logroot/--session/--workspace` argv the driver passes. */
function parseArgs(argv: readonly string[]): WorkerArgs {
  const values: WorkerArgs = { storePath: '', logRoot: '', sessionId: '', workspaceId: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`worker arg ${flag} is missing its value`)
    if (flag === '--store') values.storePath = value
    else if (flag === '--logroot') values.logRoot = value
    else if (flag === '--session') values.sessionId = value
    else if (flag === '--workspace') values.workspaceId = value
    else throw new Error(`unknown worker arg ${flag}`)
    i += 1
  }
  return values
}

/** Read the drive JSON the parent sends over stdin, to EOF. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    // stdin is a process boundary: chunks arrive as strings or Buffers, and
    // anything else means the parent's wire is broken, not worth decoding.
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) {
      throw new Error('worker: stdin chunk is neither string nor Buffer')
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Seed the isolated workspace's store with the parent's workspace identity
 * before the platform-shell service opens it: the workspace row (isolated),
 * one user, the product membership, and the default roles. The service's own
 * open re-seeds roles idempotently, so the raw seed only needs to make the
 * drive's actor and workspace resolvable by the later agent turn.
 */
async function seedIsolatedStore(storePath: string, workspaceId: WorkspaceId, userId: UserId): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true, mode: 0o700 })
  const module = await loadSqliteConstructor()
  const db = await openDatabase(module.DatabaseSync, storePath, 'wal', 5000)
  try {
    const now = Date.now()
    for (const role of DEFAULT_ROLES) upsertRole(db, role.id, role.displayName, role.permissions)
    insertUser(db, userId, 'Isolated Engine User', now)
    insertWorkspace(db, workspaceId, 'Isolated', true, now)
    assignRole(db, workspaceId, userId, RoleId('product'))
  } finally {
    db.close()
  }
  // node:sqlite creates the file with umask-derived permissions; the platform
  // service rejects a group/world-accessible store, so tighten it to owner-only
  // before the service opens and validates the same file.
  await chmod(storePath, 0o600)
}

async function main(): Promise<void> {
  loadEnv('engine-isolation-worker')
  const args = parseArgs(process.argv.slice(2))
  const sessionId = SessionId(args.sessionId)
  const workspaceId = WorkspaceId(args.workspaceId)
  const userId = UserId(`user-${process.pid}`)
  const drive = JSON.parse(await readStdin()) as AgentDrive

  await seedIsolatedStore(args.storePath, workspaceId, userId)

  const ctx = await boot(
    'engine-isolation-worker',
    resolveConfigPath(COMPOSE_PATH, undefined),
    [{
      // The isolated workspace's store: every control-plane row this process
      // writes lands in the per-workspace SQLite file, never the shared store.
      id: 'platform-shell',
      name: '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts',
      config: { path: args.storePath },
    }, {
      // The isolated workspace's JSONL log root: the parent's readLog reads
      // this durable log back after the child exits.
      id: 'persistence',
      name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: args.logRoot, compression: 'none' },
    }],
    () => {},
  )

  try {
    bindActor(String(sessionId), userId)
    await ctx.agentLoop.createAgent(ctx, {
      sessionId,
      agentOptions: { provider: drive.provider, model: drive.model },
      meta: { cwd: drive.cwd },
    })
    const agent = findAgent(ctx, String(sessionId))
    if (agent === undefined) throw new Error(`worker: agent ${sessionId} missing after createAgent`)
    // The isolated engine records its own drive in the workspace's session log —
    // the durable projection of the isolation record the parent routed by.
    agent.session.append('platform/workspace/isolated', { workspaceId, isolated: true })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: drive.prompt }],
      source: { kind: 'user' },
    }))
    await waitForStatus(ctx, agent, 'idle')
    await ctx.sessions.flush(agent.session)
  } finally {
    await ctx.fiber.dispose()
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    sessionId: args.sessionId,
    pid: process.pid,
    storePath: args.storePath,
    logRoot: args.logRoot,
  }) + '\n', () => process.exit(0))
}

void main().catch((error: unknown) => {
  console.error('engine-isolation worker failed:', error)
  process.exit(1)
})
