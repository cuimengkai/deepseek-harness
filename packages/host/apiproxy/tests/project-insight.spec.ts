/**
 * projectInsight.read rides the optional `ctx.get('projectInsight')` boundary:
 * the domain forwards the service's result verbatim, passes the carrier's
 * request signal through, refuses with `internal` when the composition mounts
 * no service, and maps a thrown read onto the wire vocabulary (cancelled when
 * the caller's signal already fired, internal otherwise). No scan is triggered
 * here — the auto-scan hook owns that, so these cases never assert a side
 * effect beyond the service call itself.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ProjectInsightDoc } from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import type { ApiProxy, ProjectInsightReadResult, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`pi-${String(nextRpc++)}`), payload }
}

/** A committed doc a fresh read returns; typed so the wire literals stay narrow. */
const FRESH_DOC: ProjectInsightDoc = {
  formatVersion: 5,
  rootName: 'fixture',
  contentFingerprint: 'test-fingerprint',
  statSignature: 'test-stat-signature',
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

/** Minimal project-insight service double: records calls, scripts results. */
function insightDouble(impl: (cwd: string, signal?: AbortSignal) => Promise<ProjectInsightReadResult>) {
  return { read: impl }
}

async function harness(
  service?: ReturnType<typeof insightDouble>,
): Promise<{ ctx: Context; api: ApiProxy }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (service !== undefined) ctx.provide('projectInsight', service as never)
  return {
    ctx,
    api: createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
  }
}

describe('projectInsight.read', () => {
  it('serves the stored document result verbatim', async () => {
    const service = insightDouble(async () => ({
      status: 'fresh' as const,
      root: 'fixture',
      doc: FRESH_DOC,
    }))
    const { api } = await harness(service)

    const response = await api.projectInsight.read(request({ cwd: '/tmp/project' }), new AbortController().signal)

    expect(response.result.ok).toBe(true)
    if (response.result.ok) {
      expect(response.result.value).toEqual({
        status: 'fresh',
        root: 'fixture',
        doc: FRESH_DOC,
      })
    }
  })

  it('forwards the request signal to the service', async () => {
    const seen: AbortSignal[] = []
    const service = insightDouble(async (_cwd, signal) => {
      if (signal !== undefined) seen.push(signal)
      return { status: 'none' as const, root: 'fixture' }
    })
    const { api } = await harness(service)
    const signal = new AbortController().signal

    await api.projectInsight.read(request({ cwd: '/tmp/project' }), signal)

    expect(seen).toEqual([signal])
  })

  it('refuses when the composition mounts no service', async () => {
    const { api } = await harness()

    const response = await api.projectInsight.read(request({ cwd: '/tmp/project' }), new AbortController().signal)

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('internal')
    expect(response.result.error.message).toContain('project-insight service is absent')
  })

  it('maps a thrown read onto an internal error', async () => {
    const service = insightDouble(async () => {
      throw new Error('boom')
    })
    const { api } = await harness(service)

    const response = await api.projectInsight.read(request({ cwd: '/tmp/project' }), new AbortController().signal)

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('internal')
    expect(response.result.error.message).toContain('boom')
  })

  it('maps an abort-raced throw onto cancelled', async () => {
    const service = insightDouble(async () => {
      throw new Error('walk interrupted')
    })
    const { api } = await harness(service)
    const controller = new AbortController()
    controller.abort()

    const response = await api.projectInsight.read(request({ cwd: '/tmp/project' }), controller.signal)

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('cancelled')
  })
})
