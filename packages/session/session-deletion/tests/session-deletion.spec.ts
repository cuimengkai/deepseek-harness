import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import SessionDeletion, { SessionDeletionError, cascadeScope } from '../src/index.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-session-deletion-'))
  dirs.push(dir)
  return dir
}

/** A subagent header under `parent` with `origin: 'subagent'`. */
function subagentMeta(id: string, parent: SessionId, cwd?: string): SessionHeader {
  return { ...meta(id, cwd), parentSession: parent, origin: 'subagent', delegationDepth: 1 }
}

interface Harness {
  ctx: Context
  persistence: SessionPersistence
  deletion: SessionDeletion
  dir: string
  dispose: () => Promise<void>
}

/** Boot the real JSONL persistence + storage-domain + deletion composition. */
async function harness(): Promise<Harness> {
  const dir = await freshRoot()
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: dir, compression: 'none' })
  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionDeletion)
  return {
    ctx,
    persistence: ctx.sessionPersistence,
    deletion: ctx.sessionDeletion,
    dir,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}

/** Persist a closed-turn session with the given header and optional seed events. */
async function persist(h: Harness, header: SessionHeader, events = oneTurnLog()): Promise<void> {
  await h.persistence.create(header)
  await h.persistence.append(header.id, events)
}

describe('cascadeScope', () => {
  it('returns the root alone when it has no subagent descendants', () => {
    expect(cascadeScope(SessionId('root'), [meta('root'), meta('other')])).toEqual([SessionId('root')])
  })

  it('walks multi-generation subagent descendants in pre-order', () => {
    const root = SessionId('root')
    const child = SessionId('child')
    const grand = SessionId('grand')
    const headers = [
      meta('root'),
      subagentMeta('child', root),
      subagentMeta('grand', child),
      meta('unrelated'),
    ]
    expect(cascadeScope(root, headers)).toEqual([root, child, grand])
  })

  it('sweeps an already-orphaned child whose parent is absent from the corpus', () => {
    const root = SessionId('root')
    const orphan = SessionId('orphan')
    // `orphan` references `root` as parent but root's own header is absent:
    // the child is still traversable and swept.
    expect(cascadeScope(root, [subagentMeta('orphan', root)])).toEqual([root, orphan])
  })

  it('is cycle-safe', () => {
    const root = SessionId('root')
    const a = SessionId('a')
    const b = SessionId('b')
    const headers = [
      meta('root'),
      subagentMeta('a', root),
      subagentMeta('b', a),
      { ...subagentMeta('root-as-child', b), id: root },
    ]
    expect(cascadeScope(root, headers)).toEqual([root, a, b])
  })
})

describe('SessionDeletion.deleteSession', () => {
  it('physically deletes a parent and its whole subagent tree, and records the ledger', async () => {
    const h = await harness()
    try {
      const root = meta('root', '/work')
      const child = subagentMeta('child', root.id, '/work')
      const grand = subagentMeta('grand', child.id, '/work')
      await persist(h, root)
      await persist(h, child)
      await persist(h, grand)

      const result = await h.deletion.deleteSession(root.id, { reason: 'cleanup' })
      expect(result).toEqual({ deleted: [root.id, child.id, grand.id], notFound: [] })
      expect(await h.persistence.list()).toEqual([])

      const [record] = h.deletion.listDeletions()
      expect(record).toMatchObject({
        id: root.id,
        scope: [root.id, child.id, grand.id],
        deleted: [root.id, child.id, grand.id],
        notFound: [],
        reason: 'cleanup',
      })
      expect(record?.deletedAt).toBeGreaterThan(0)
    } finally {
      await h.dispose()
    }
  })

  it('refuses the whole tree when any member is live, deleting nothing', async () => {
    const h = await harness()
    try {
      const root = meta('live-root', '/work')
      const child = subagentMeta('live-child', root.id, '/work')
      await persist(h, root)
      await persist(h, child)

      // Make the child live.
      const live = h.ctx.sessions.create(child.id, { seed: oneTurnLog(), meta: child })
      await h.ctx.sessions.flush(live)

      await expect(h.deletion.deleteSession(root.id)).rejects.toBeInstanceOf(SessionDeletionError)
      // Both logs survive the refusal.
      expect(await h.persistence.list()).toHaveLength(2)
      expect(h.deletion.listDeletions()).toEqual([])
    } finally {
      await h.dispose()
    }
  })

  it('reports absent members as notFound without writing a ledger record', async () => {
    const h = await harness()
    try {
      const result = await h.deletion.deleteSession(SessionId('never-existed'))
      expect(result).toEqual({ deleted: [], notFound: [SessionId('never-existed')] })
      expect(h.deletion.listDeletions()).toEqual([])
    } finally {
      await h.dispose()
    }
  })

  it('cleans mounted consumers (projection cache, workspace) per deleted session', async () => {
    const h = await harness()
    const evict = vi.fn(async () => {})
    const forget = vi.fn(async () => {})
    // Minimal fakes satisfy the optional `ctx.get` cleanup path.
    h.ctx.provide('sessionProjectionCache', { evict } as never)
    h.ctx.provide('workspaceRegistry', { forgetSession: forget } as never)
    try {
      const root = meta('cleanup-root', '/work')
      const child = subagentMeta('cleanup-child', root.id, '/work')
      await persist(h, root)
      await persist(h, child)
      await h.deletion.deleteSession(root.id)
      expect(evict).toHaveBeenCalledTimes(2)
      expect(evict).toHaveBeenCalledWith(root.id)
      expect(evict).toHaveBeenCalledWith(child.id)
      expect(forget).toHaveBeenCalledTimes(2)
      expect(forget).toHaveBeenCalledWith(child.id)
    } finally {
      await h.dispose()
    }
  })
})

describe('SessionDeletion.listDeletions', () => {
  it('returns one record per delete operation, most recent first', async () => {
    const h = await harness()
    try {
      const first = meta('ledger-first', '/work')
      await persist(h, first)
      await h.deletion.deleteSession(first.id)
      const second = meta('ledger-second', '/work')
      await persist(h, second)
      await h.deletion.deleteSession(second.id)

      const records = h.deletion.listDeletions()
      expect(records.map(record => record.id)).toEqual([second.id, first.id])
    } finally {
      await h.dispose()
    }
  })
})
