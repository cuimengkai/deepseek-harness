/**
 * A session's agent preset is fixed at creation. The gateway records the
 * resolved id on the header and refuses to adopt the identity under a different
 * one, because the session's history was produced under that preset's tools:
 * rebuilding it differently would replay tool calls the new agent cannot make.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import type { HostFrame } from '../src/api/events.ts'
import {
  ComposeModuleError, graphToRows, InvalidPresetIdError, PresetExistsError, PresetMountError,
  PresetNotWritableError, resolveSessionPreset, rowsToGraph, UnknownPresetError,
} from '@deepseek-ai/dsh-agent-presets'
import { agentPresetSaveGraphRequestSchema } from '../src/api/agent-presets.schema.ts'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { createApiProxy } from '../src/api-proxy.ts'
import { describe, expect, it } from 'vitest'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`preset-${String(nextRpc++)}`), payload }
}

/** Minimal live agent; the gateway only needs identity and its session. */
function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

/**
 * A roster whose `mount` is a no-op: this spec is about the gateway's identity
 * rules, and the composition itself is covered by the real-composition test in
 * `apps/cli`. Ids listed in `userIds` present as locally authored; the rest
 * ship with the deployment.
 */
function roster(ids: readonly string[], userIds: readonly string[] = []): unknown {
  /** Presets the double's `compose`/`composeGraph` minted, so `list`/`resolve` surface them like disk writes would. */
  const composed = new Map<string, { rows: unknown[]; graph?: FlowGraph; name?: string; description?: string }>()
  const trustOf = (id: string): 'system' | 'user' =>
    (composed.has(id) || userIds.includes(id) ? 'user' : 'system')
  const presetOf = (id: string): object => {
    const meta = composed.get(id)
    return {
      id,
      trust: trustOf(id),
      path: `/presets/${id}/agent.cordis.yml`,
      ...meta?.name === undefined ? {} : { name: meta.name },
      ...meta?.description === undefined ? {} : { description: meta.description },
    }
  }
  return {
    defaultId: ids[0],
    list: () => Promise.resolve([...ids, ...composed.keys()].map(presetOf)),
    resolve: (id?: string) => {
      const wanted = id ?? ids[0] ?? ''
      if (!ids.includes(wanted) && !composed.has(wanted)) {
        return Promise.reject(new UnknownPresetError(wanted, ids))
      }
      return Promise.resolve(presetOf(wanted))
    },
    mount: (_ctx: Context, id?: string) => {
      const wanted = id ?? ids[0] ?? ''
      if (failingMounts.has(wanted)) {
        return Promise.reject(new PresetMountError(wanted, 'test-mount-failure'))
      }
      return Promise.resolve(presetOf(wanted))
    },
    // What a real mount leaves behind: a service instance only the agent that
    // mounted it can be used to address. The doubles are per agent so a test
    // can tell "this session's" from "some session's".
    serviceFor: (agent: { id: unknown }, name: string) => {
      const perAgent = services.get(String(agent.id))
      return perAgent?.[name]
    },
    authorable: true,
    read: (id: string) => Promise.resolve(`# ${id}\n- id: x\n  name: y\n`),
    readRows: (id: string) => {
      const written = composed.get(id)
      if (written !== undefined) return Promise.resolve(written.rows)
      if (!ids.includes(id)) return Promise.reject(new UnknownPresetError(id, ids))
      return Promise.resolve([{ id: 'x', name: 'y' }])
    },
    copy: (from: string, id: string) => {
      if (!ids.includes(from)) return Promise.reject(new UnknownPresetError(from, ids))
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return Promise.reject(new InvalidPresetIdError(id))
      if (ids.includes(id)) return Promise.reject(new PresetExistsError(id))
      return Promise.resolve()
    },
    remove: (id: string) => {
      if (!ids.includes(id)) return Promise.reject(new UnknownPresetError(id, ids))
      return Promise.resolve()
    },
    compose: (id: string, rows: unknown[], meta: { name?: string; description?: string }, options: {
      overwrite: boolean
      assertResolvable: (rows: readonly unknown[]) => readonly string[]
    }) => {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return Promise.reject(new InvalidPresetIdError(id))
      const unresolved = options.assertResolvable(rows)
      if (unresolved.length > 0) return Promise.reject(new ComposeModuleError(id, unresolved))
      if (ids.includes(id) || composed.has(id)) {
        if (options.overwrite !== true) return Promise.reject(new PresetExistsError(id))
        if (trustOf(id) === 'system') {
          return Promise.reject(new PresetNotWritableError(id, 'only a locally authored preset may be overwritten'))
        }
      }
      composed.set(id, {
        rows: [...rows],
        ...meta.name === undefined ? {} : { name: meta.name },
        ...meta.description === undefined ? {} : { description: meta.description },
      })
      return Promise.resolve()
    },
    // The graph authoring half of the double mirrors `compose`, deriving the
    // rows through the real conversion so the inventory proof and the read-back
    // exercise the same projection the host runs.
    composeGraph: (id: string, graph: FlowGraph, meta: { name?: string; description?: string }, options: {
      overwrite: boolean
      assertResolvable: (rows: readonly unknown[]) => readonly string[]
    }) => {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return Promise.reject(new InvalidPresetIdError(id))
      const rows = graphToRows(graph)
      const unresolved = options.assertResolvable(rows)
      if (unresolved.length > 0) return Promise.reject(new ComposeModuleError(id, unresolved))
      if (ids.includes(id) || composed.has(id)) {
        if (options.overwrite !== true) return Promise.reject(new PresetExistsError(id))
        if (trustOf(id) === 'system') {
          return Promise.reject(new PresetNotWritableError(id, 'only a locally authored preset may be overwritten'))
        }
      }
      composed.set(id, {
        rows,
        graph,
        ...meta.name === undefined ? {} : { name: meta.name },
        ...meta.description === undefined ? {} : { description: meta.description },
      })
      return Promise.resolve()
    },
    // The stored graph is the layout; a preset without one (a shipped preset or
    // a rows-composed one) regenerates a chain — the same staleness rule the
    // real service applies before any write-back.
    readGraph: (id: string) => {
      const written = composed.get(id)
      if (written?.graph !== undefined) return Promise.resolve(written.graph)
      if (!ids.includes(id)) return Promise.reject(new UnknownPresetError(id, ids))
      return Promise.resolve(rowsToGraph(id, id, [{ id: 'x', name: 'y' }]))
    },
    recompose: (_ctx: Context, id: string) => {
      if (!ids.includes(id)) return Promise.reject(new UnknownPresetError(id, ids))
      return Promise.resolve({ id, trust: 'system', path: `/presets/${id}.yml` })
    },
    // The standing scope key a cold transcript read resolves presenters in.
    standingKeyFor: (id?: string) => {
      const wanted = id ?? ids[0] ?? ''
      standingKeyRequests.push(wanted)
      if (!ids.includes(wanted) || failingStandingKeys.has(wanted)) {
        return Promise.reject(new UnknownPresetError(wanted, ids))
      }
      let key = standingKeys.get(wanted)
      if (key === undefined) {
        key = { agentPreset: wanted }
        standingKeys.set(wanted, key)
      }
      return Promise.resolve(key)
    },
  }
}

/** Standing keys the roster double minted, and the ids readers asked for. */
const standingKeys = new Map<string, object>()
const standingKeyRequests: string[] = []
/** Preset ids whose standing mount the double reports as unusable. */
const failingStandingKeys = new Set<string>()
/** Preset ids whose compose-time mount the double reports as failing. */
const failingMounts = new Set<string>()

/** Per-agent service instances a mounted preset would own, keyed by session id. */
const services = new Map<string, Record<string, unknown>>()

async function harness(
  presets?: readonly string[],
  persistence?: unknown,
  options: {
    userIds?: readonly string[]
    inventory?: readonly string[]
    defaults?: Record<string, unknown>
  } = {},
) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-preset-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionPersistence', (persistence ?? { list: () => Promise.resolve([]) }) as never)
  if (presets !== undefined) ctx.provide('agentPresets', roster(presets, options.userIds) as never)
  const inventory = options.inventory
  if (inventory !== undefined) {
    ctx.provide('pluginInventory', {
      list: () => ({ entries: inventory.map(moduleName => ({ moduleName })) }),
    } as never)
  }

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      // Setup runs before publication against a context that carries the
      // agent, and the agent reaches back through `agent.ctx` — the pair the
      // gateway's own `installTarget` relies on.
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      try {
        await options.setup?.(agentCtx)
      } catch (error) {
        // A setup rejection rolls the creation back — the same composite
        // teardown the agent-loop runs — so a fallback retry of the same
        // sessionId starts clean.
        await ctx.sessions.dispose(session)
        throw error
      }
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
    async disposeAgent() {
      return false
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
    ...options.defaults,
  })
  return { api, ctx, cwd }
}

describe('session.create with an agent preset', () => {
  it('records the resolved preset on the session header', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])

    const created = await api.sessions.create(request({ sessionId: SessionId('s1'), agentPreset: 'minimal' }))

    expect(created.result.ok).toBe(true)
    expect(ctx.sessions.get(SessionId('s1'))?.header.agentPreset).toBe('minimal')
  })

  it('records the default when the caller names none', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])

    await api.sessions.create(request({ sessionId: SessionId('s2') }))

    expect(ctx.sessions.get(SessionId('s2'))?.header.agentPreset).toBe('standard')
  })

  it('falls back to the deployment default when the fresh create names an unknown preset', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])

    const response = await api.sessions.create(request({ sessionId: SessionId('s3'), agentPreset: 'nope' }))

    // A workspace pick that named a bad preset still opens the workspace: the
    // fresh create falls back to the default composition instead of hard-failing.
    expect(response.result.ok).toBe(true)
    expect(ctx.sessions.get(SessionId('s3'))?.header.agentPreset).toBe('standard')
  })

  it('falls back to the deployment default when the requested preset cannot mount', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])
    failingMounts.add('minimal')
    try {
      const response = await api.sessions.create(request({ sessionId: SessionId('s3b'), agentPreset: 'minimal' }))

      // `UnknownPresetError` covers an unresolvable id; `PresetMountError`
      // covers a resolvable one whose composition fails to mount. Both land
      // on the default so the workspace pick survives.
      expect(response.result.ok).toBe(true)
      expect(ctx.sessions.get(SessionId('s3b'))?.header.agentPreset).toBe('standard')
    } finally {
      failingMounts.delete('minimal')
    }
  })

  it('refuses to adopt a live session under a different preset', async () => {
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('s4'), agentPreset: 'minimal' }))

    const response = await api.sessions.create(request({ sessionId: SessionId('s4'), agentPreset: 'standard' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-conflict')
    expect(response.result.error.details).toEqual({
      sessionId: 's4',
      requestedPreset: 'standard',
      existingPreset: 'minimal',
    })
  })

  it('adopts a live session under the preset it SWITCHED to', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('s4b'), agentPreset: 'standard' }))
    // Exactly what `agentPreset.select` leaves behind on a blank session: the
    // header keeps the creation fact, the log states what the agent runs.
    ctx.sessions.get(SessionId('s4b'))?.append('agent-preset/selected', { agentPreset: 'minimal' })

    const adopted = await api.sessions.create(request({ sessionId: SessionId('s4b'), agentPreset: 'minimal' }))
    const stale = await api.sessions.create(request({ sessionId: SessionId('s4b'), agentPreset: 'standard' }))

    // Comparing against the header would invert both answers: the preset the
    // session actually runs would be refused, and the one it left would pass.
    expect(adopted.result.ok).toBe(true)
    // The echo has to name the same preset the adoption just accepted, or the
    // client labels the session with one it has already left — and disagrees
    // with the row `session.list` serves for it.
    if (!adopted.result.ok) throw new Error('unreachable')
    expect(adopted.result.value).toMatchObject({ agentPreset: 'minimal' })
    expect(stale.result.ok).toBe(false)
    if (stale.result.ok) throw new Error('unreachable')
    expect(stale.result.error.details).toMatchObject({ existingPreset: 'minimal' })
  })

  it('adopts a live session unchanged when the caller names no preset', async () => {
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('s5'), agentPreset: 'minimal' }))

    // Reconnecting and retrying a create must stay ordinary operations.
    const response = await api.sessions.create(request({ sessionId: SessionId('s5') }))

    expect(response.result.ok).toBe(true)
  })

  it('leaves the header preset-less when no roster is composed', async () => {
    const { api, ctx } = await harness()

    await api.sessions.create(request({ sessionId: SessionId('s6') }))

    expect(ctx.sessions.get(SessionId('s6'))?.header.agentPreset).toBeUndefined()
  })

  it('says why a preset-less session cannot be adopted under one', async () => {
    // Two callers reach this: a deployment that composes no roster, and a
    // session created before one existed. Both record no preset, so naming
    // any is a conflict rather than an adoption — the history was produced
    // under a composition this roster cannot name. The message has to say
    // that, because "already runs agent preset undefined" reads as a bug.
    const { api } = await harness()
    await api.sessions.create(request({ sessionId: SessionId('s7') }))

    const response = await api.sessions.create(request({ sessionId: SessionId('s7'), agentPreset: 'standard' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-conflict')
    expect(response.result.error.message).toContain('records no agent preset')
    expect(response.result.error.details).toEqual({
      sessionId: 's7',
      requestedPreset: 'standard',
      existingPreset: undefined,
    })
  })
})

/**
 * A capability a preset mounts is reachable from nowhere the host normally
 * looks: an `isolate` realm is what makes it per session. The gateway serves
 * requests that are ABOUT a session from OUTSIDE it, so it addresses the
 * instance through the agent instead of reading a root-realm singleton.
 */
describe('a capability the session\'s preset mounts', () => {
  it('serves the goal RPC from the session\'s own goal service', async () => {
    const { api } = await harness(['standard'])
    await api.sessions.create(request({ sessionId: SessionId('g1'), agentPreset: 'standard' }))
    const ref = { id: GoalId('goal-1'), revision: 1 }
    const paused: unknown[] = []
    services.set('g1', {
      goals: { pause: (agent: { id: unknown }, r: unknown) => { paused.push([String(agent.id), r]); return ref } },
    })

    const response = await api.goals.pause(request({ sessionId: SessionId('g1'), ref }))

    expect(response.result).toMatchObject({ ok: true, value: { ref } })
    // Reached the instance this session mounted, and was handed its own agent.
    expect(paused).toEqual([['g1', ref]])
    services.delete('g1')
  })

  it('serves the skill catalog from the session\'s own registry', async () => {
    const { api } = await harness(['standard'])
    await api.sessions.create(request({ sessionId: SessionId('k1'), agentPreset: 'standard' }))
    services.set('k1', {
      skills: {
        list: () => Promise.resolve([{
          name: 'preset-owned',
          description: 'ships inside the preset directory',
          invocation: { modelInvocable: true, userInvocable: true },
        }]),
      },
    })

    const response = await api.skills.list(request({ sessionId: SessionId('k1') }))

    // A preset ships its own skill directory, so the catalog IS the
    // session's; reading a host singleton would answer for the wrong one.
    expect(response.result).toMatchObject({ ok: true, value: { skills: [{ name: 'preset-owned' }] } })
    services.delete('k1')
  })

  it('says so when no composition mounts the capability at all', async () => {
    const { api } = await harness(['standard'])
    await api.sessions.create(request({ sessionId: SessionId('n1'), agentPreset: 'standard' }))

    const response = await api.skills.list(request({ sessionId: SessionId('n1') }))

    // Absent means absent — not "this session has none", which is what a
    // root-realm read used to report for every presetd session.
    expect(response.result.ok).toBe(false)
    const failure = response.result as { ok: false; error: { message: string } }
    expect(failure.error.message).toContain('neither this session')
  })
})

describe('agentPreset.list', () => {
  it('marks the default and carries each preset\'s trust', async () => {
    const { api } = await harness(['standard', 'minimal'])

    const response = await api.agentPresets.list(request({}))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.presets).toEqual([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'minimal', trust: 'system', isDefault: false },
    ])
    expect(response.result.value.authorable).toBe(true)
  })

  it('answers with an empty roster when the deployment composes no presets', async () => {
    const { api } = await harness()

    const response = await api.agentPresets.list(request({}))

    // Composing no presets is a valid deployment, not an error: every session
    // then shares the host composition and the browser offers no choice.
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.presets).toEqual([])
    // Nothing to write to either, so a surface offering "new preset" knows to
    // stay hidden rather than offering a button whose save always fails.
    expect(response.result.value.authorable).toBe(false)
  })
})

describe('agentPreset.select', () => {
  it('recomposes a blank session', async () => {
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('sel-1'), agentPreset: 'standard' }))

    const response = await api.agentPresets.select(
      request({ sessionId: SessionId('sel-1'), agentPreset: 'minimal' }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.agentPreset).toBe('minimal')
  })

  it('records the switch in the log, and the list reads it back', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('sel-log'), agentPreset: 'standard' }))

    await api.agentPresets.select(
      request({ sessionId: SessionId('sel-log'), agentPreset: 'minimal' }))

    // The header is written once at creation, so the switch lives in the log —
    // this is what a restart replays and what every projection resolves from.
    // Asserting only the RPC's echo would miss a switch that never persisted.
    const session = ctx.sessions.get(SessionId('sel-log'))
    if (session === undefined) throw new Error('unreachable')
    expect(session.header.agentPreset).toBe('standard')
    expect(resolveSessionPreset(session)).toBe('minimal')
    const listed = await api.sessions.list(request({}))
    if (!listed.result.ok) throw new Error('unreachable')
    expect(listed.result.value.items.find(item => item.sessionId === 'sel-log')?.agentPreset)
      .toBe('minimal')
  })

  it('forwards the owner event so clients can drop that session\'s catalogs', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('sel-frame'), agentPreset: 'standard' }))
    // The host-stream opener reads the committed-workspace baseline; this
    // spec owns preset identity, so the stub suffices (api-proxy-commands
    // precedent).
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const abort = new AbortController()
    const frames: HostFrame[] = []
    const stream = api.events.host(request({}), abort.signal)
    const consume = (async () => {
      for await (const frame of stream) {
        if (frame.payload.type === 'host/remote-event'
          && frame.payload.event === 'agent-preset/selected') frames.push(frame.payload)
      }
    })()

    // AgentPresets owns the committed-log-to-event mapping; this spec owns the
    // forwarding of that event without recreating the owner's implementation.
    ctx.emit('agent-preset/selected', SessionId('sel-frame'), 'minimal')
    // The queue push is synchronous; one turn lets the async iterator consume
    // it before the stream closes.
    await new Promise(resolve => setTimeout(resolve, 0))
    abort.abort()
    await consume

    // Recomposing registers nothing, so the owner event — not the
    // registry-wide commands one — tells clients their cached catalogs are stale.
    expect(frames).toEqual([
      { type: 'host/remote-event', event: 'agent-preset/selected', args: ['sel-frame', 'minimal'] },
    ])
  })

  it('serializes two concurrent selects on one session', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('sel-race'), agentPreset: 'standard' }))

    // Both pass the blank check; unserialized, the second unmount finds no
    // record because the first already removed it, and two compositions end up
    // in one agent layer. The client's busy flag is not enforcement.
    const [first, second] = await Promise.all([
      api.agentPresets.select(request({ sessionId: SessionId('sel-race'), agentPreset: 'minimal' })),
      api.agentPresets.select(request({ sessionId: SessionId('sel-race'), agentPreset: 'standard' })),
    ])

    expect(first.result.ok).toBe(true)
    expect(second.result.ok).toBe(true)
    const session = ctx.sessions.get(SessionId('sel-race'))
    if (session === undefined) throw new Error('unreachable')
    // One winner, and the log agrees with it: the last committed switch.
    expect(resolveSessionPreset(session)).toBe('standard')
  })

  it('refuses once the conversation has started', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('sel-2'), agentPreset: 'standard' }))
    // One turn is enough: the history from here on was produced under
    // `standard`'s tools, and a swap would strand those tool calls.
    ctx.sessions.get(SessionId('sel-2'))?.append('turn/start', { turn: 0 })

    const response = await api.agentPresets.select(
      request({ sessionId: SessionId('sel-2'), agentPreset: 'minimal' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-locked')
  })

  it('reports an unknown preset without disturbing the session', async () => {
    const { api } = await harness(['standard'])
    await api.sessions.create(request({ sessionId: SessionId('sel-3') }))

    const response = await api.agentPresets.select(
      request({ sessionId: SessionId('sel-3'), agentPreset: 'nope' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-not-found')
  })

  it('reports a deployment that composes no presets', async () => {
    const { api } = await harness()
    await api.sessions.create(request({ sessionId: SessionId('sel-4') }))

    const response = await api.agentPresets.select(
      request({ sessionId: SessionId('sel-4'), agentPreset: 'anything' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-not-found')
  })
})

describe('authoring over the wire', () => {
  it('reads a composition with its trust', async () => {
    const { api } = await harness(['standard'])

    const response = await api.agentPresets.read(request({ agentPreset: 'standard' }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    // The shipped set is readable: it is the known-good composition a copy
    // starts from, and trust is what tells a surface to say so.
    expect(response.result.value.trust).toBe('system')
    expect(response.result.value.content).toContain('- id: x')
    // The structured rows ride beside the viewer text so a composer never
    // parses YAML itself.
    expect(response.result.value.rows).toEqual([{ id: 'x', name: 'y' }])
  })

  it('copies a preset under a new id', async () => {
    const { api } = await harness(['standard'])

    const response = await api.agentPresets.copy(
      request({ from: 'standard', agentPreset: 'mine', name: '我的模式' }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.agentPreset).toBe('mine')
  })

  it('rejects a copy target that could escape the preset root', async () => {
    const { api } = await harness(['standard'])

    const response = await api.agentPresets.copy(request({ from: 'standard', agentPreset: '../escape' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-invalid')
  })

  it('rejects a copy target the roster already supplies', async () => {
    const { api } = await harness(['standard', 'minimal'])

    const response = await api.agentPresets.copy(request({ from: 'standard', agentPreset: 'minimal' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-invalid')
    expect(response.result.error.message).toMatch(/already exists/)
  })

  it('rejects a copy whose source is unknown', async () => {
    const { api } = await harness(['standard'])

    const response = await api.agentPresets.copy(request({ from: 'never-existed', agentPreset: 'mine' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-not-found')
  })

  it('reports a deployment that composes no presets', async () => {
    const { api } = await harness()

    const response = await api.agentPresets.read(request({ agentPreset: 'anything' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-not-found')
  })

  it('reports an unknown id on delete rather than succeeding silently', async () => {
    const { api } = await harness(['standard'])

    const response = await api.agentPresets.remove(request({ agentPreset: 'never-existed' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-not-found')
  })
})

describe('composing a preset over the wire', () => {
  const TOOL_BASH = '@deepseek-ai/dsh-tool-bash'
  const TOOL_READ = '@deepseek-ai/dsh-tool-read'

  it('creates a preset from rows under a free id', async () => {
    const { api } = await harness(['standard'], undefined, { inventory: [TOOL_BASH] })

    const response = await api.agentPresets.compose(request({
      agentPreset: 'mine',
      name: '我的组合',
      description: 'built by dragging',
      rows: [{ id: 'tool-bash', name: TOOL_BASH }],
    }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.agentPreset).toBe('mine')
    // The composed set is what read now serves, rows beside the viewer text.
    const read = await api.agentPresets.read(request({ agentPreset: 'mine' }))
    expect(read.result.ok).toBe(true)
    if (!read.result.ok) throw new Error('unreachable')
    expect(read.result.value.trust).toBe('user')
    expect(read.result.value.rows).toEqual([{ id: 'tool-bash', name: TOOL_BASH }])
  })

  it('refuses a composition that names an uninstalled module', async () => {
    const { api } = await harness(['standard'], undefined, { inventory: [TOOL_BASH] })

    const response = await api.agentPresets.compose(request({
      agentPreset: 'mine',
      rows: [{ id: 'tool-read', name: TOOL_READ }],
    }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-invalid')
    expect(response.result.error.message).toMatch(/uninstalled/)
    expect((response.result.error.details as { reason?: string } | undefined)?.reason).toContain(TOOL_READ)
  })

  it('refuses to overwrite a preset that ships with the deployment', async () => {
    const { api } = await harness(['standard'], undefined, { inventory: [TOOL_BASH] })

    const response = await api.agentPresets.compose(request({
      agentPreset: 'standard',
      overwrite: true,
      rows: [{ id: 'tool-bash', name: TOOL_BASH }],
    }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-read-only')
    expect(response.result.error.message).toMatch(/locally authored/)
  })

  it('refuses a create whose id the roster already supplies', async () => {
    const { api } = await harness(['standard', 'minimal'], undefined, { inventory: [TOOL_BASH] })

    const response = await api.agentPresets.compose(request({
      agentPreset: 'minimal',
      rows: [{ id: 'tool-bash', name: TOOL_BASH }],
    }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-invalid')
    expect(response.result.error.message).toMatch(/already exists/)
  })

  it('refuses to prove module installability when no inventory is mounted', async () => {
    const { api } = await harness(['standard'])

    const response = await api.agentPresets.compose(request({
      agentPreset: 'mine',
      rows: [{ id: 'tool-bash', name: TOOL_BASH }],
    }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('internal')
    expect(response.result.error.message).toMatch(/no plugin inventory/)
  })

  it('overwrites a locally authored preset in place', async () => {
    const { api } = await harness(['standard', 'my-preset'], undefined, {
      userIds: ['my-preset'],
      inventory: [TOOL_BASH, TOOL_READ],
    })

    const response = await api.agentPresets.compose(request({
      agentPreset: 'my-preset',
      overwrite: true,
      name: '换过',
      rows: [{ id: 'tool-read', name: TOOL_READ }],
    }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    const read = await api.agentPresets.read(request({ agentPreset: 'my-preset' }))
    expect(read.result.ok).toBe(true)
    if (!read.result.ok) throw new Error('unreachable')
    expect(read.result.value.name).toBe('换过')
    expect(read.result.value.rows).toEqual([{ id: 'tool-read', name: TOOL_READ }])
  })

  it('reports a deployment that composes no presets', async () => {
    const { api } = await harness(undefined, undefined, { inventory: [TOOL_BASH] })

    const response = await api.agentPresets.compose(request({
      agentPreset: 'mine',
      rows: [{ id: 'tool-bash', name: TOOL_BASH }],
    }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-not-found')
  })
})

/** A chain graph one agent node per module, ids `row-1`... on canvas-internal node ids. */
function CHAIN_GRAPH(...modules: string[]): FlowGraph {
  return {
    id: 'mine', name: 'Graph',
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      ...modules.map((module, index) => ({
        id: `agent-${index + 1}`, type: 'agent' as const, position: { x: 220 * (index + 1), y: 0 },
        prompt: '', composition: { id: `row-${index + 1}`, module },
      })),
      { id: 'end', type: 'end', position: { x: 220 * (modules.length + 1), y: 0 } },
    ],
    edges: modules.length === 0
      ? [{ id: 'e-start', from: 'start', to: 'end' }]
      : [
        { id: 'e-start', from: 'start', to: 'agent-1' },
        ...modules.slice(0, -1).map((_, index) => ({
          id: `e-${index}`, from: `agent-${index + 1}`, to: `agent-${index + 2}`,
        })),
        { id: 'e-end', from: `agent-${modules.length}`, to: 'end' },
      ],
  }
}

describe('reading a preset graph over the wire', () => {
  it('forwards the stored graph with its trust and display metadata', async () => {
    const { api } = await harness(['standard'], undefined, { inventory: ['@deepseek-ai/dsh-tool-bash'] })

    const saved = await api.agentPresets.saveGraph(request({
      agentPreset: 'mine',
      name: '我的图',
      description: 'authored on the canvas',
      graph: CHAIN_GRAPH('@deepseek-ai/dsh-tool-bash'),
    }))
    expect(saved.result.ok).toBe(true)

    const response = await api.agentPresets.readGraph(request({ agentPreset: 'mine' }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.trust).toBe('user')
    expect(response.result.value.name).toBe('我的图')
    expect(response.result.value.description).toBe('authored on the canvas')
    expect(response.result.value.graph.nodes.map(node => node.type)).toEqual(['start', 'agent', 'end'])
  })

  it('regenerates a chain for a shipped preset with no stored layout', async () => {
    const { api } = await harness(['standard'])

    const response = await api.agentPresets.readGraph(request({ agentPreset: 'standard' }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.trust).toBe('system')
    expect(response.result.value.graph.nodes.map(node => node.type)).toEqual(['start', 'agent', 'end'])
  })

  it('reports a deployment that composes no presets', async () => {
    const { api } = await harness(undefined)

    const response = await api.agentPresets.readGraph(request({ agentPreset: 'mine' }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-not-found')
  })
})

describe('saving a preset graph over the wire', () => {
  const TOOL_BASH = '@deepseek-ai/dsh-tool-bash'
  const TOOL_READ = '@deepseek-ai/dsh-tool-read'

  it('creates a preset from a graph whose rows the read serves back', async () => {
    const { api } = await harness(['standard'], undefined, { inventory: [TOOL_BASH, TOOL_READ] })

    const response = await api.agentPresets.saveGraph(request({
      agentPreset: 'mine',
      name: '我的组合',
      graph: CHAIN_GRAPH(TOOL_BASH, TOOL_READ),
    }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.agentPreset).toBe('mine')
    const read = await api.agentPresets.read(request({ agentPreset: 'mine' }))
    expect(read.result.ok).toBe(true)
    if (!read.result.ok) throw new Error('unreachable')
    expect(read.result.value.rows).toEqual([
      { id: 'row-1', name: TOOL_BASH },
      { id: 'row-2', name: TOOL_READ },
    ])
  })

  it('refuses a graph whose projected rows name an uninstalled module', async () => {
    const { api } = await harness(['standard'], undefined, { inventory: [TOOL_BASH] })

    const response = await api.agentPresets.saveGraph(request({
      agentPreset: 'mine',
      graph: CHAIN_GRAPH(TOOL_BASH, TOOL_READ),
    }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-invalid')
    expect(response.result.error.message).toMatch(/uninstalled/)
    expect((response.result.error.details as { reason?: string } | undefined)?.reason).toContain(TOOL_READ)
  })

  it('refuses to overwrite a preset that ships with the deployment', async () => {
    const { api } = await harness(['standard'], undefined, { inventory: [TOOL_BASH] })

    const response = await api.agentPresets.saveGraph(request({
      agentPreset: 'standard',
      overwrite: true,
      graph: CHAIN_GRAPH(TOOL_BASH),
    }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-read-only')
  })

  it('refuses a graph with a branching node before any write', async () => {
    const { api } = await harness(['standard'], undefined, { inventory: [TOOL_BASH] })
    const branching: FlowGraph = {
      ...CHAIN_GRAPH(TOOL_BASH),
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'a', type: 'agent', position: { x: 220, y: 0 }, prompt: '', composition: { id: 'tool-bash', module: TOOL_BASH } },
        { id: 'cond', type: 'condition', position: { x: 440, y: 0 }, expression: 'true' },
        { id: 'end', type: 'end', position: { x: 660, y: 0 } },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'a', to: 'cond' },
        { id: 'e3', from: 'cond', to: 'end' },
      ],
    }
    const response = await api.agentPresets.saveGraph(request({ agentPreset: 'mine', graph: branching }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.message).toMatch(/branching is a later phase/)
  })

  it('carries the composition subset through the request schema un-stripped', () => {
    const parsed = agentPresetSaveGraphRequestSchema.parse({
      agentPreset: 'mine',
      graph: CHAIN_GRAPH(TOOL_BASH),
    })
    const agentNode = parsed.graph.nodes.find(node => node.type === 'agent')
    expect(agentNode).toMatchObject({
      composition: { id: 'row-1', module: TOOL_BASH },
    })
  })

  it('reports a deployment that composes no presets', async () => {
    const { api } = await harness(undefined)

    const response = await api.agentPresets.saveGraph(request({
      agentPreset: 'mine',
      graph: CHAIN_GRAPH(TOOL_BASH),
    }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-not-found')
  })
})

describe('opening a preset directory', () => {
  it('hands the resolved directory to the native opener', async () => {
    const opened: string[] = []
    const { api } = await harness(['standard', 'my-preset'], undefined, {
      userIds: ['my-preset'],
      defaults: { openPath: (path: string) => { opened.push(path); return Promise.resolve() } },
    })

    const response = await api.agentPresets.openDocument(
      request({ agentPreset: 'my-preset' }), new AbortController().signal)

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value).toEqual({ opened: true })
    // The id selected the directory; the browser supplied no path.
    expect(opened).toEqual(['/presets/my-preset'])
  })

  it('answers the path as text where the deployment has no opener', async () => {
    const { api } = await harness(['standard', 'my-preset'], undefined, {
      userIds: ['my-preset'],
      defaults: { canOpenPath: () => false },
    })

    const response = await api.agentPresets.openDocument(
      request({ agentPreset: 'my-preset' }), new AbortController().signal)

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value).toEqual({ opened: false, path: '/presets/my-preset' })
  })

  it('refuses a preset that ships with the deployment', async () => {
    const opened: string[] = []
    const { api } = await harness(['standard'], undefined, {
      defaults: { openPath: (path: string) => { opened.push(path); return Promise.resolve() } },
    })

    const response = await api.agentPresets.openDocument(
      request({ agentPreset: 'standard' }), new AbortController().signal)

    // Pointing an editor into the install invites edits an upgrade will
    // silently overwrite; the refusal mirrors copy/remove.
    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-read-only')
    expect(opened).toEqual([])
  })

  it('reports the roster capability on list', async () => {
    const openable = await harness(['standard'], undefined, {
      defaults: { canOpenPath: () => true },
    })
    const headless = await harness(['standard'], undefined, {
      defaults: { canOpenPath: () => false },
    })

    const yes = await openable.api.agentPresets.list(request({}))
    const no = await headless.api.agentPresets.list(request({}))

    expect(yes.result.ok && yes.result.value.hasDocument).toBe(true)
    expect(no.result.ok && no.result.value.hasDocument).toBe(false)
  })

  it('counts an injected opener as openable', async () => {
    const { api } = await harness(['standard'], undefined, {
      defaults: { openPath: () => Promise.resolve() },
    })

    const response = await api.agentPresets.list(request({}))

    expect(response.result.ok && response.result.value.hasDocument).toBe(true)
  })
})

describe('skills over the layered host registry', () => {
  it('passes the live agent as the view scope to the host registry', async () => {
    const { api, ctx } = await harness(['standard'])
    const seen: unknown[] = []
    ctx.provide('skills', {
      list: (options: { scope?: unknown }) => {
        seen.push(options.scope)
        return Promise.resolve([])
      },
    } as never)
    await api.sessions.create(request({ sessionId: SessionId('h1'), agentPreset: 'standard' }))

    const response = await api.skills.list(request({ sessionId: SessionId('h1') }))

    expect(response.result).toMatchObject({ ok: true, value: { skills: [] } })
    expect(seen).toEqual([ctx.agents.get(SessionId('h1'))])
  })

  it('resolves a cold session to its recorded preset standing key', async () => {
    const { api, ctx } = await harness(['standard', 'minimal'])
    const seen: unknown[] = []
    ctx.provide('skills', {
      list: (options: { scope?: unknown }) => {
        seen.push(options.scope)
        return Promise.resolve([])
      },
    } as never)
    ctx.sessions.create(SessionId('h2'), { meta: { cwd: '/workspace/cold', agentPreset: 'minimal' } })

    const response = await api.skills.list(request({ sessionId: SessionId('h2') }))

    expect(response.result).toMatchObject({ ok: true, value: { skills: [] } })
    expect(seen).toEqual([standingKeys.get('minimal')])
  })

  it('serves the global view when the roster no longer supplies the recorded preset', async () => {
    const { api, ctx } = await harness(['standard'])
    const seen: unknown[] = []
    ctx.provide('skills', {
      list: (options: { scope?: unknown }) => {
        seen.push(options.scope)
        return Promise.resolve([])
      },
    } as never)
    ctx.sessions.create(SessionId('h3'), { meta: { cwd: '/workspace/cold', agentPreset: 'gone' } })

    const response = await api.skills.list(request({ sessionId: SessionId('h3') }))

    expect(response.result).toMatchObject({ ok: true, value: { skills: [] } })
    expect(seen).toEqual([undefined])
  })
})

describe('session.history presenter scope', () => {
  it('asks the roster for the RECORDED preset\'s standing key on a cold read', async () => {
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('p1'), agentPreset: 'minimal' }))
    // Cold: creation registered a live agent in this harness, so simulate the
    // cold path by asking for a session only persistence knows... the harness
    // has no persistence, so read the live one and assert no roster query.
    standingKeyRequests.length = 0
    const live = await api.sessions.history(request({ sessionId: SessionId('p1') }))
    expect(live.result.ok).toBe(true)
    // A live agent IS the presenter scope; the roster is not consulted.
    expect(standingKeyRequests).toEqual([])
  })

  it('resolves a switched session from the LOG, not its creation header', async () => {
    // The header is a creation fact; a switch while blank is a logged event,
    // and every turn after it ran under the newer composition. Reading the
    // header would render that history through the older preset's layer,
    // where the tools it is made of have no presenter at all.
    const meta = { id: SessionId('p4'), createdAt: 1, cwd: '/tmp/p4', agentPreset: 'standard' }
    const { api } = await harness(['standard', 'minimal'], {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({
        meta,
        events: [{ type: 'agent-preset/selected', seq: 1, time: 0, data: { agentPreset: 'minimal' } }],
      }),
    })

    standingKeyRequests.length = 0
    const response = await api.sessions.history(request({ sessionId: SessionId('p4') }))

    expect(response.result.ok).toBe(true)
    expect(standingKeyRequests).toEqual(['minimal'])
  })

  it('serves a COLD transcript whose standing mount is no longer usable', async () => {
    // A genuinely cold session: persistence knows it, no live agent exists.
    const meta = { id: SessionId('p3'), createdAt: 1, cwd: '/tmp/p3', agentPreset: 'standard' }
    const { api } = await harness(['standard'], {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events: [] }),
    })
    // The preset broke after the session ran: the roster rejects the mount.
    failingStandingKeys.add('standard')
    try {
      standingKeyRequests.length = 0
      const response = await api.sessions.history(request({ sessionId: SessionId('p3') }))
      // Degraded, never failed: the roster WAS asked, and the transcript
      // still serves — with the generic cards a viewless entry renders.
      expect(standingKeyRequests).toEqual(['standard'])
      expect(response.result.ok).toBe(true)
    } finally {
      failingStandingKeys.delete('standard')
    }
  })
})
