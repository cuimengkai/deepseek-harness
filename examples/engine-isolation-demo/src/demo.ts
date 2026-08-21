/**
 * engine-isolation-demo host driver: boots the platform-shell composition, then
 * mounts the engine-isolation service programmatically (its in-process runner
 * closes over this process's agent loop and the process-out config points at
 * this demo's `src/worker.ts`). It creates a SHARED workspace and an ISOLATED
 * workspace, binds one platform user to the shared drive, drives the shared
 * workspace in-process and the isolated workspace through a dedicated child
 * engine, and asserts the physical-isolation evidence: the isolation record
 * routes each drive, the child pid differs from the parent, the isolated
 * workspace's asset lands in the child's per-workspace SQLite store while the
 * shared store lacks it, and `readLog` returns the child's durable JSONL events
 * after the child has exited. Runs keyless and scrubs its scratch root on exit.
 * @module engine-isolation-demo
 */

import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { openDatabase } from '@deepseek-ai/dsh-experimental-platform-shell/src/schema.ts'
import { loadSqliteConstructor } from '@deepseek-ai/dsh-experimental-platform-shell/src/database.ts'
import { RoleId, WorkspaceId } from '@deepseek-ai/dsh-experimental-platform-shell/src/types.ts'
import EngineIsolationService from '@deepseek-ai/dsh-experimental-engine-isolation/src/index.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { bindActor } from './engine-isolation-demo.ts'
import { findAgent, readPersistedEvents, waitForStatus } from './shared.ts'

const COMPOSE_PATH = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const DEMO_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const WORKER_PATH = join(DEMO_DIR, 'src', 'worker.ts')

/** The workspace rows and asset contents of one platform store file. */
interface StoreFacts {
  readonly workspaces: string[]
  readonly assets: string[]
}

/**
 * Read one platform store's workspaces and asset contents through a second,
 * validated connection (the shared store stays open in-process; the isolated
 * store was closed when its child engine exited).
 * @param path - the SQLite store file to inspect.
 * @returns the stored workspace ids and asset contents.
 */
async function storeFacts(path: string): Promise<StoreFacts> {
  const module = await loadSqliteConstructor()
  const db = await openDatabase(module.DatabaseSync, path, 'wal', 5000)
  try {
    const workspaces = (db.prepare('SELECT workspace_id FROM workspaces').all() as { workspace_id: string }[])
      .map(row => row.workspace_id)
    const assets = (db.prepare('SELECT content FROM assets').all() as { content: string }[])
      .map(row => row.content)
    return { workspaces, assets }
  } finally {
    db.close()
  }
}

async function main() {
  loadEnv('engine-isolation-demo')

  // A scratch root for the shared control-plane store, the shared session logs,
  // and the process-out store/log roots. Repo-local `.storages/` keeps it
  // gitignored; the worker children write per-workspace stores under it.
  const workdir = join(import.meta.dirname, '..', '..', '..', '.storages', 'engine-isolation-demo')
  const sharedStorePath = join(workdir, 'control-plane.sqlite')
  const sharedLogRoot = join(workdir, '.sessions')
  const storeRoot = join(workdir, 'stores')
  const logRoot = join(workdir, 'logs')
  await mkdir(workdir, { recursive: true })
  await mkdir(sharedLogRoot, { recursive: true })
  await mkdir(storeRoot, { recursive: true })
  await mkdir(logRoot, { recursive: true })
  await mkdir(join(workdir, 'shared'), { recursive: true })
  await mkdir(join(workdir, 'isolated'), { recursive: true })

  const ctx = await boot(
    'engine-isolation-demo',
    resolveConfigPath(COMPOSE_PATH, undefined),
    [{
      // The shared control-plane store: the isolation record for BOTH workspaces
      // lives here; the isolated workspace's DATA lives in the child's store.
      id: 'platform-shell',
      name: '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts',
      config: { path: sharedStorePath },
    }, {
      // Shared session logs land in the scratch root instead of the checked-in
      // `.engine-isolation-demo-sessions` default.
      id: 'persistence',
      name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: sharedLogRoot, compression: 'none' },
    }],
    () => {},
  )

  // ── tenant: one shared workspace, one isolated workspace, one user ────────
  const shell = ctx.platformShell
  const shared = shell.createWorkspace('Shared')
  const isolated = shell.createWorkspace('Isolated', { isolated: true })
  const alice = shell.registerUser('Alice')
  shell.assignRole(shared, alice, RoleId('product'))
  // The child engine binds its own store's user to the isolated session; only
  // the shared session is bound in this process.
  bindActor('engine-shared', alice)

  // ── engine-isolation service: routed by the isolation record ──────────────
  await ctx.plugin(EngineIsolationService, {
    inProcess: {
      // The shared-workspace engine: drive one agent turn on THIS process.
      run: async (request) => {
        await ctx.agentLoop.createAgent(ctx, {
          sessionId: request.sessionId,
          agentOptions: { provider: request.drive.provider, model: request.drive.model },
          meta: { cwd: request.drive.cwd },
        })
        const agent = findAgent(ctx, String(request.sessionId))
        if (agent === undefined) throw new Error(`in-process engine: agent ${request.sessionId} missing`)
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: request.drive.prompt }],
          source: { kind: 'user' },
        }))
        await waitForStatus(ctx, agent, 'idle')
        await ctx.sessions.flush(agent.session)
      },
      storePath: sharedStorePath,
      logRoot: sharedLogRoot,
      readLog: sessionId => readPersistedEvents(sharedLogRoot, String(sessionId)),
      listSessions: async () => ctx.sessions.list().map(session => session.id),
    },
    processOut: {
      // The isolated-workspace engine: delegate the drive to a dedicated child
      // process whose store and log root are per-workspace. `nodeArgs` runs the
      // TS worker under the same tsx ESM hook the host uses.
      workerScript: WORKER_PATH,
      storeRoot,
      logRoot,
      cwd: DEMO_DIR,
      graceMs: 60_000,
      nodeArgs: ['--import', 'tsx/esm'],
    },
  })

  // ── drive both workspaces through their routed engines ────────────────────
  const engine = ctx.engineIsolation
  const sharedHandle = await engine.drive({
    sessionId: SessionId('engine-shared'),
    workspaceId: shared,
    drive: {
      prompt: `Register the requirement asset R-shared in workspace ${shared}.`,
      provider: 'engine-demo',
      model: 'mock-model',
      cwd: join(workdir, 'shared'),
    },
  })
  const isolatedHandle = await engine.drive({
    sessionId: SessionId('engine-isolated'),
    workspaceId: isolated,
    drive: {
      prompt: `Register the requirement asset R-isolated in workspace ${isolated}.`,
      provider: 'engine-demo',
      model: 'mock-model',
      cwd: join(workdir, 'isolated'),
    },
  })

  // ── durable evidence: routing, process boundary, store separation, log ────
  const isolationRecord = {
    shared: shell.workspaceIsolation(shared),
    isolated: shell.workspaceIsolation(isolated),
  }
  const routing = {
    shared: engine.driver(shared).kind,
    isolated: engine.driver(isolated).kind,
    sharedInProcess: engine.driver(shared).kind === 'in-process',
    isolatedProcessOut: engine.driver(isolated).kind === 'process-out',
  }
  let unknownFailsLoud = false
  try {
    engine.driver(WorkspaceId('ws-ghost'))
  } catch {
    unknownFailsLoud = true
  }
  const processBoundary = {
    parentPid: process.pid,
    sharedEnginePid: sharedHandle.pid,
    isolatedEnginePid: isolatedHandle.pid,
    sharedEngineIsParent: sharedHandle.pid === process.pid,
    isolatedEngineIsChild: isolatedHandle.pid !== process.pid && isolatedHandle.pid > 0,
  }
  const sharedStore = await storeFacts(sharedStorePath)
  const isolatedStore = await storeFacts(join(storeRoot, String(isolated), 'platform.sqlite'))
  const storeSeparation = {
    sharedStoreWorkspaces: [...sharedStore.workspaces].sort(),
    isolatedStoreWorkspaces: [...isolatedStore.workspaces].sort(),
    sharedAssetInSharedStore: sharedStore.assets.includes('R-shared'),
    sharedAssetInIsolatedStore: isolatedStore.assets.includes('R-shared'),
    isolatedAssetInSharedStore: sharedStore.assets.includes('R-isolated'),
    isolatedAssetInIsolatedStore: isolatedStore.assets.includes('R-isolated'),
    isolatedStoreHoldsOnlyIsolatedWorkspace: isolatedStore.workspaces.length === 1
      && isolatedStore.workspaces[0] === String(isolated),
  }
  const isolatedEvents = await engine.readLog(SessionId('engine-isolated'))
  const sharedEvents = await engine.readLog(SessionId('engine-shared'))
  const persisted = {
    isolatedToolCalls: isolatedEvents.filter((e): e is Extract<SessionEvent, { type: 'tool/call' }> =>
      e.type === 'tool/call').map(e => e.data.name),
    isolatedRegistered: isolatedEvents.filter((e): e is Extract<SessionEvent, { type: 'asset/register' }> =>
      e.type === 'asset/register').map(e => String(e.data.workspaceId)),
    sharedRegistered: sharedEvents.filter((e): e is Extract<SessionEvent, { type: 'asset/register' }> =>
      e.type === 'asset/register').map(e => String(e.data.workspaceId)),
    isolatedSessions: await engine.listSessions(isolated),
    sharedSessions: await engine.listSessions(shared),
    isolatedIsolationEvents: isolatedEvents.filter((e): e is Extract<SessionEvent, { type: 'platform/workspace/isolated' }> =>
      e.type === 'platform/workspace/isolated').map(e => String(e.data.workspaceId)),
    isolatedLogReconstructable: isolatedEvents.filter(e => e.type === 'asset/register').length === 1,
  }
  const note = sharedStore.assets.includes('R-isolated')
    ? 'the isolated asset leaked into the shared store — physical isolation failed'
    : isolatedStore.assets.includes('R-isolated') && !sharedStore.assets.includes('R-isolated')
      ? 'the isolated workspace\'s data lives only in the child engine\'s per-workspace store'
      : 'the drive did not produce the expected assets — the demo drive failed'

  console.log(JSON.stringify({
    workspaces: {
      shared,
      isolated,
      isolationRecord,
    },
    routing: {
      ...routing,
      unknownFailsLoud,
    },
    processBoundary,
    storeSeparation,
    persisted,
    note,
  }, null, 2))

  await ctx.fiber.dispose()
  await rm(workdir, { recursive: true, force: true })
}

void main()
