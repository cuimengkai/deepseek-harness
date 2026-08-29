/**
 * The project-insight read controller: a fresh committed document renders
 * immediately; `none`/`stale` poll on a short interval until the wire reports
 * `fresh`; a rejected or `ok:false` read surfaces as an error; a newer load or
 * dispose supersedes every older in-flight read via the generation counter.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProjectInsightDoc } from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import { inject } from '../src/client/index.ts'
import { POLL_INTERVAL_MS, ProjectInsightController } from '../src/client/insight-store.ts'

/** A minimal committed document; sections are empty to keep the fixture light. */
const DOC: ProjectInsightDoc = {
  formatVersion: 5,
  rootName: 'fake-root',
  contentFingerprint: 'deadbeef',
  statSignature: 'deadbeef-stat',
  scannedAt: 0,
  sections: {
    techStack: { manifests: [], dependencies: [], runtimes: [], files: [] },
    moduleTopology: { files: [], internalRoots: [], aliases: [], externalCount: 0 },
    componentDependencies: { components: [], cycles: [] },
    components: { components: [], count: 0 },
    prompts: { files: [], count: 0 },
    agentTech: { files: [], tools: [], count: 0, skills: [], mcp: [], prompts: [] },
    documents: { files: [], count: 0 },
  },
}

type ReadValue = {
  status: 'none' | 'fresh' | 'stale' | 'error'
  root: string
  doc?: ProjectInsightDoc
  error?: string
}

/** A wire whose read promises the test settles by hand, in order. */
function readWire() {
  const pending: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = []
  const calls: string[] = []
  const wire = {
    projectInsight: {
      read: (cwd: string) => {
        calls.push(cwd)
        return new Promise((resolve, reject) => pending.push({ resolve, reject }))
      },
    },
  } as unknown as Pick<ClientRemote, 'projectInsight'>
  return {
    wire,
    calls,
    pendingCount: () => pending.length,
    answerOk(value: ReadValue): void {
      const slot = pending.shift()!
      slot.resolve({ ok: true as const, value })
    },
    answerErr(message: string): void {
      const slot = pending.shift()!
      slot.resolve({ ok: false as const, error: { code: 'internal', message } })
    },
    rejectLast(error: Error): void {
      const slot = pending.shift()!
      slot.reject(error)
    },
  }
}

/** Flush the microtask chain an awaited read continuation runs on. */
const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the project-insight read controller', () => {
  it('renders nothing for a session with no project root', async () => {
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => undefined)
    controller.load()
    await flush()

    // No cwd, no project to scan: the tab stays idle and the wire is never touched.
    expect(controller.store.getSnapshot()).toEqual({ status: 'idle', error: null, doc: null })
    expect(h.calls).toEqual([])
  })

  it('renders a fresh committed document immediately', async () => {
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    await flush()
    expect(h.calls).toEqual(['/proj'])
    expect(controller.store.getSnapshot().status).toBe('loading')

    h.answerOk({ status: 'fresh', root: 'fake-root', doc: DOC })
    await flush()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.doc).toBe(DOC)
  })

  it('surfaces a rejected wire call as an error', async () => {
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    await flush()

    h.rejectLast(new Error('boom'))
    await flush()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
    expect(state.doc).toBeNull()
  })

  it('surfaces an ok:false wire result as an error', async () => {
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    await flush()

    h.answerErr('the host has no insight service')
    await flush()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('the host has no insight service')
  })

  it('polls a none result until a fresh document lands', async () => {
    vi.useFakeTimers()
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    await flush()

    h.answerOk({ status: 'none', root: 'fake-root' })
    await flush()
    expect(controller.store.getSnapshot().status).toBe('none')
    expect(controller.store.getSnapshot().doc).toBeNull()
    expect(h.calls).toHaveLength(1)

    // The poll interval fires a second read; the wire then answers fresh.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(h.calls).toHaveLength(2)
    h.answerOk({ status: 'fresh', root: 'fake-root', doc: DOC })
    await flush()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.doc).toBe(DOC)
  })

  it('polls a stale result exactly like none', async () => {
    vi.useFakeTimers()
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    await flush()

    h.answerOk({ status: 'stale', root: 'fake-root' })
    await flush()
    expect(controller.store.getSnapshot().status).toBe('stale')

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(h.calls).toHaveLength(2)
    h.answerOk({ status: 'fresh', root: 'fake-root', doc: DOC })
    await flush()
    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('dispose stops the pending poll', async () => {
    vi.useFakeTimers()
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    await flush()

    h.answerOk({ status: 'none', root: 'fake-root' })
    await flush()
    expect(h.calls).toHaveLength(1)

    controller.dispose()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(h.calls).toHaveLength(1)
  })

  it('ignores a second load while one read is in flight', async () => {
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    await flush()
    expect(h.pendingCount()).toBe(1)

    controller.load()
    await flush()
    expect(h.pendingCount()).toBe(1)
  })

  it('a newer load supersedes an older in-flight read', async () => {
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    controller.dispose()
    controller.load()
    await flush()
    expect(h.pendingCount()).toBe(2)

    // Read #1 resolves late to a stale result; its generation is stale, so it
    // is discarded rather than flashing a previous session's document.
    h.answerOk({ status: 'none', root: 'old-root' })
    await flush()
    expect(controller.store.getSnapshot().status).toBe('loading')

    h.answerOk({ status: 'fresh', root: 'new-root', doc: DOC })
    await flush()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.doc).toBe(DOC)
  })

  it('dispose discards an in-flight result that lands afterwards', async () => {
    const h = readWire()
    const controller = new ProjectInsightController(h.wire, () => '/proj')
    controller.load()
    controller.dispose()

    h.answerErr('boom')
    await flush()

    // Dispose reset the snapshot and bumped the generation; the late result is
    // discarded, and the store holds the clean initial state a remount reads.
    expect(controller.store.getSnapshot()).toEqual({ status: 'idle', error: null, doc: null })
  })
})

describe('the plugin inject array', () => {
  it('declares the Remote namespace the store reads through', () => {
    // The wire face is reached as ctx.remote.projectInsight, and the Cordis
    // fiber refuses an undeclared property with "cannot get property …
    // without inject" — the whole tab ring dies on one missing name.
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.projectInsight', 'sessions'])
  })
})
