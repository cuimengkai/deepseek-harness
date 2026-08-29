/**
 * The project-insight auto-scan hook: a develop-mode session with a working
 * directory auto-scans its workspace into `.dsh/insight/` after a
 * per-root debounce, and `project-insight/updated` fires only at the commit
 * point. Sessions under another preset and sessions without a cwd stay inert,
 * while a session that switches into develop mid-lifecycle re-triggers a scan.
 */

import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { PROJECT_INSIGHT_META_REL } from '../src/fingerprint.ts'
import { ProjectInsight } from '../src/service.ts'
import type {} from '../src/types.ts'

/** A pinned mtime (seconds, year 2096) an edited file is bumped to, so the
 * stale assertion never depends on filesystem timestamp granularity. */
const FUTURE_MTIME = 4_000_000_000

let roots: string[] = []

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-insight-service-'))
  roots.push(root)
  return root
}

/** Seed a project tree with `rel → content` files. */
async function seed(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function docExists(root: string): Promise<boolean> {
  try {
    await readFile(join(root, PROJECT_INSIGHT_META_REL))
    return true
  } catch {
    return false
  }
}

/** Poll a condition until it holds or the deadline elapses. */
async function until(predicate: () => boolean | Promise<boolean>, label: string, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`)
    await sleep(10)
  }
}

async function dispose(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
}

afterEach(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

/**
 * Mount the session store plus the host-plane service with a short debounce.
 * The auto-scan trigger is the subject; the tool and LLM layers are irrelevant.
 */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(ProjectInsight, { autoScanPresets: ['develop'], scanDebounceMs: 10 })
  const updated: SessionId[] = []
  ctx.on('project-insight/updated', (sessionId) => { updated.push(sessionId) })
  return { ctx, updated }
}

describe('project-insight auto-scan hook', () => {
  it('scans a develop-mode session workspace and emits the commit-point event', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': "import { a } from './a'\n",
      'src/a.ts': 'export const a = 1',
    })
    const { ctx, updated } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('session-a'), {
        meta: { cwd: root, agentPreset: 'develop' },
      })

      // The event is emitted only after the atomic write commits, so its
      // presence is proof the document is readable.
      await until(() => updated.length > 0, 'project-insight/updated')
      expect(updated).toEqual([session.id])
      expect(await docExists(root)).toBe(true)

      const read = await ctx.projectInsight.read(root)
      expect(read.status).toBe('fresh')
      expect(read.root).toBe(basename(root))
      expect(read.doc?.formatVersion).toBe(5)
    } finally {
      await dispose(ctx)
    }
  })

  it('re-triggers a scan when a session switches into develop mid-lifecycle', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': 'export const x = 1\n',
    })
    const { ctx, updated } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('session-b'), {
        meta: { cwd: root, agentPreset: 'code' },
      })
      // The non-develop creation must not have scheduled anything: the debounce
      // (10ms) plus a scan of this tiny tree settle well inside this margin.
      await sleep(150)
      expect(await docExists(root)).toBe(false)
      expect(updated).toEqual([])

      session.append('agent-preset/selected', { agentPreset: 'develop' })
      await until(() => updated.length > 0, 'project-insight/updated after preset switch')
      expect(updated).toEqual([session.id])
      expect(await docExists(root)).toBe(true)
    } finally {
      await dispose(ctx)
    }
  })

  it('leaves a non-develop session workspace unscanned', async () => {
    const root = await tempProject()
    await seed(root, { 'package.json': '{}' })
    const { ctx, updated } = await setup()
    try {
      ctx.sessions.create(SessionId('session-c'), { meta: { cwd: root, agentPreset: 'code' } })
      await sleep(150)
      expect(await docExists(root)).toBe(false)
      expect(updated).toEqual([])
    } finally {
      await dispose(ctx)
    }
  })

  it('leaves a develop-mode session without a working directory unscanned', async () => {
    const { ctx, updated } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('session-d'), { meta: { agentPreset: 'develop' } })
      await sleep(150)
      expect(updated).toEqual([])
      expect(ctx.sessions.get(session.id)).toBe(session)
    } finally {
      await dispose(ctx)
    }
  })

  it('reports none, fresh, stale, and unchanged through read and scan', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': 'export const x = 1\n',
    })
    const other = await tempProject()
    await seed(other, { 'package.json': '{}' })
    const { ctx, updated } = await setup()
    try {
      const session = ctx.sessions.create(SessionId('session-e'), {
        meta: { cwd: root, agentPreset: 'develop' },
      })
      await until(() => updated.length > 0, 'project-insight/updated')

      // A fresh document reads back; a second scan is a no-op.
      const fresh = await ctx.projectInsight.read(root)
      expect(fresh.status).toBe('fresh')
      expect(fresh.doc?.formatVersion).toBe(5)
      const again = await ctx.projectInsight.scan(root, session.id)
      expect(again.status).toBe('unchanged')

      // A project that was never scanned reads as `none`.
      const none = await ctx.projectInsight.read(other)
      expect(none.status).toBe('none')
      expect(none.root).toBe(basename(other))

      // Editing a scanned source file turns the document stale.
      await writeFile(join(root, 'src', 'index.ts'), 'export const x = 2\n')
      await utimes(join(root, 'src', 'index.ts'), FUTURE_MTIME, FUTURE_MTIME)
      const stale = await ctx.projectInsight.read(root)
      expect(stale.status).toBe('stale')
    } finally {
      await dispose(ctx)
    }
  })

  it('a read never schedules a re-scan', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': 'export const x = 1\n',
    })
    const { ctx, updated } = await setup()
    try {
      ctx.sessions.create(SessionId('session-f'), { meta: { cwd: root, agentPreset: 'develop' } })
      await until(() => updated.length > 0, 'project-insight/updated')
      const committed = updated.length

      // Editing turns the document stale, but reading must not schedule a
      // re-scan: the stale document persists until an explicit trigger.
      await writeFile(join(root, 'src', 'index.ts'), 'export const x = 2\n')
      await utimes(join(root, 'src', 'index.ts'), FUTURE_MTIME, FUTURE_MTIME)
      const stale = await ctx.projectInsight.read(root)
      expect(stale.status).toBe('stale')
      await sleep(150) // well past the 10 ms debounce
      expect(updated).toHaveLength(committed)
      expect((await ctx.projectInsight.read(root)).status).toBe('stale')
    } finally {
      await dispose(ctx)
    }
  })

  it('self-heals a document committed under an older format version', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': 'export const x = 1\n',
    })
    const { ctx, updated } = await setup()
    try {
      ctx.sessions.create(SessionId('session-g'), { meta: { cwd: root, agentPreset: 'develop' } })
      await until(() => updated.length > 0, 'project-insight/updated')

      // Rewrite the committed meta at a format the reader refuses, simulating a
      // document left behind by an older release: the read must surface it as
      // stale (and schedule a rebuild) rather than strand it in a permanent error.
      const metaPath = join(root, PROJECT_INSIGHT_META_REL)
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
      await writeFile(metaPath, JSON.stringify({ ...meta, formatVersion: 2 }))

      const read = await ctx.projectInsight.read(root)
      expect(read.status).toBe('stale')
      expect(read.doc).toBeUndefined()

      // The read schedules a background rebuild at the current format.
      await until(async () => {
        const rebuilt = JSON.parse(await readFile(metaPath, 'utf8')) as { formatVersion: number }
        return rebuilt.formatVersion === 5
      }, 'self-healed meta at formatVersion 5')
      const healed = await ctx.projectInsight.read(root)
      expect(healed.status).toBe('fresh')
      expect(healed.doc?.formatVersion).toBe(5)
    } finally {
      await dispose(ctx)
    }
  })
})
