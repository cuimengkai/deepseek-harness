/**
 * The `scan_project` tool is a thin, loud-fast adapter over the project-insight
 * service: the model-visible surface is the compact summary (never the full
 * document), a session without a cwd or without a session at all fails with the
 * structured NO_CWD / NO_SESSION codes, and mounting the tool without the host
 * service fails at mount rather than at a call.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { ProjectInsight } from '../src/service.ts'
import { apply } from '../src/tool.ts'

let roots: string[] = []

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-insight-tool-'))
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

afterEach(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

/**
 * Mount the tools topology plus the project-insight service and tool: session
 * store, tool runtime, the host-plane service, then the tool's `apply` (the
 * service must already be resolvable through `ctx.get`).
 */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(ProjectInsight, { autoScanPresets: [], scanDebounceMs: 10 })
  apply(ctx)

  /** Resolve the live session for one named agent, creating it on first use. */
  const sessionOf = (sessionId: string, cwd?: string): Session =>
    ctx.sessions.get(SessionId(sessionId)) ?? ctx.sessions.create(
      SessionId(sessionId),
      cwd === undefined ? {} : { meta: { cwd } },
    )

  /** Execute one registered tool as one session's agent. */
  const run = async (
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
    options: { cwd?: string } = {},
  ): Promise<ToolExecutionResult> => {
    const agent: Agent = {
      ctx: new Context(),
      id: SessionId(sessionId),
      options: {},
      session: sessionOf(sessionId, options.cwd),
      inbox: undefined as never,
      status: 'idle',
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => { throw new Error('unused in tool spec') },
      cancel() {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
    return ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('tools-spec-call'),
      name,
      arguments: args,
      agent,
    })
  }

  return { ctx, sessionOf, run }
}

async function dispose(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
}

describe('scan_project tool', () => {
  it('scans the session workspace and commits the document with the compact summary', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': "import { a } from './a'\n",
      'src/a.ts': 'export const a = 1',
    })
    const { ctx, run } = await setup()
    try {
      const result = await run('session-a', 'scan_project', {}, { cwd: root })
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({
        status: 'scanned',
        root: root.split('/').pop(),
        path: '.dsh/project-insight.json',
        summary: { files: 2, modules: 2, edges: 1, components: 0, prompts: 0, agentTechFiles: 0 },
      })
      expect(result.meta).toMatchObject({ code: 'scanned', modules: 2, components: 0 })

      // The document is committed to the project's own .dsh directory.
      const { readFile } = await import('node:fs/promises')
      const doc = JSON.parse(await readFile(join(root, '.dsh', 'project-insight.json'), 'utf8')) as { formatVersion: number; contentFingerprint: string }
      expect(doc.formatVersion).toBe(1)
      expect(doc.contentFingerprint).toBeTruthy()

      // A second scan is a no-op while the document is fresh.
      const again = await run('session-a', 'scan_project', {}, { cwd: root })
      expect(again.isError).toBe(false)
      expect(again.value).toMatchObject({ status: 'unchanged' })
    } finally {
      await dispose(ctx)
    }
  })

  it('fails a session without a working directory with the NO_CWD code', async () => {
    const { ctx, run } = await setup()
    try {
      const result = await run('session-a', 'scan_project', {})
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('NO_CWD')
    } finally {
      await dispose(ctx)
    }
  })

  it('fails a tool call without an agent session with the NO_SESSION code', async () => {
    const { ctx } = await setup()
    try {
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('tools-spec-call'),
        name: 'scan_project',
        arguments: {},
      })
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('NO_SESSION')
    } finally {
      await dispose(ctx)
    }
  })

  it('fails loud at mount when the project-insight service is absent', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      expect(() => apply(ctx)).toThrow(/projectInsight service is not mounted/)
    } finally {
      await dispose(ctx)
    }
  })
})
