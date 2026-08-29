import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentModes, { UnknownModeError, ModeInvalidError } from '../src/index.ts'

const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-modes-'))
  temps.push(dir)
  return dir
}

async function writeFixtureMode(
  root: string,
  id: string,
  bind: string,
  flow?: string,
): Promise<void> {
  const dir = join(root, id)
  await mkdir(join(dir, 'flows'), { recursive: true })
  await writeFile(join(dir, 'bind.yml'), bind)
  await writeFile(join(dir, 'mode.yml'), `name: ${id}\norder: 1\n`)
  if (flow !== undefined) {
    await writeFile(join(dir, 'flows', 'pipeline.flow.json'), flow)
  }
}

const VALID_FLOW = JSON.stringify({
  formatVersion: 1,
  flow: {
    id: 'pipeline',
    name: 'Pipe',
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      { id: 'a', type: 'agent', position: { x: 100, y: 0 }, prompt: 'hi' },
      { id: 'end', type: 'end', position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'a' },
      { id: 'e2', from: 'a', to: 'end' },
    ],
  },
}, null, 2)

describe('AgentModes', () => {
  it('lists and resolves modes from configured roots', async () => {
    const root = await tempRoot()
    await writeFixtureMode(root, 'demo', 'preset: standard\nentryFlow: pipeline\n', VALID_FLOW)
    const ctx = new Context()
    await ctx.plugin(AgentModes, {
      roots: [{ path: root, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })
    const modes = await ctx.agentModes.list()
    expect(modes.map(mode => mode.id)).toEqual(['demo'])
    const bind = await ctx.agentModes.resolveBind('demo')
    expect(bind).toMatchObject({ modeId: 'demo', preset: 'standard', entryFlow: 'pipeline' })
    const graph = await ctx.agentModes.readEntryFlow('demo')
    expect(graph.id).toBe('pipeline')
  })

  it('marks a mode broken when bind.yml is missing required fields', async () => {
    const root = await tempRoot()
    await writeFixtureMode(root, 'broken', 'preset: standard\n')
    const ctx = new Context()
    await ctx.plugin(AgentModes, {
      roots: [{ path: root, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })
    const [mode] = await ctx.agentModes.list()
    expect(mode?.broken).toMatch(/entryFlow/)
    await expect(ctx.agentModes.resolveBind('broken')).rejects.toBeInstanceOf(ModeInvalidError)
  })

  it('refuses an unknown mode id', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentModes, {
      roots: [],
      includeShippedRoot: false,
      includeUserRoot: false,
    })
    await expect(ctx.agentModes.resolve('nope')).rejects.toBeInstanceOf(UnknownModeError)
  })

  it('copies a mode into the user root and can delete it', async () => {
    const system = await tempRoot()
    const user = await tempRoot()
    await writeFixtureMode(system, 'demo', 'preset: standard\nentryFlow: pipeline\n', VALID_FLOW)
    const ctx = new Context()
    await ctx.plugin(AgentModes, {
      roots: [
        { path: system, trust: 'system' },
        { path: user, trust: 'user' },
      ],
      includeShippedRoot: false,
      includeUserRoot: false,
    })
    await ctx.agentModes.copy('demo', 'my-demo', 'Mine')
    const modes = await ctx.agentModes.list()
    expect(modes.some(mode => mode.id === 'my-demo' && mode.trust === 'user')).toBe(true)
    await ctx.agentModes.remove('my-demo')
    expect((await ctx.agentModes.list()).some(mode => mode.id === 'my-demo')).toBe(false)
  })

  it('creates a blank user mode and can update its bind', async () => {
    const user = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(AgentModes, {
      roots: [{ path: user, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })
    await ctx.agentModes.create('my-mode', 'standard', 'Mine', 'A custom mode')
    const modes = await ctx.agentModes.list()
    expect(modes).toEqual([expect.objectContaining({
      id: 'my-mode',
      trust: 'user',
      name: 'Mine',
      description: 'A custom mode',
    })])
    const bind = await ctx.agentModes.resolveBind('my-mode')
    expect(bind).toMatchObject({ modeId: 'my-mode', preset: 'standard', entryFlow: 'pipeline' })
    const graph = await ctx.agentModes.readEntryFlow('my-mode')
    expect(graph.nodes.some(node => node.type === 'agent')).toBe(true)
    await ctx.agentModes.updateBind('my-mode', 'develop', 'Renamed')
    expect(await ctx.agentModes.resolveBind('my-mode')).toMatchObject({
      modeId: 'my-mode',
      preset: 'develop',
      entryFlow: 'pipeline',
    })
    expect((await ctx.agentModes.list())[0]).toMatchObject({ name: 'Renamed' })
  })

  it('ships the hello-orchestration learning sample when includeShippedRoot is on', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentModes, {
      includeShippedRoot: true,
      includeUserRoot: false,
      roots: [],
    })
    const roster = await ctx.agentModes.remoteExportList()
    expect(roster.modes.map(mode => mode.id)).toEqual(['hello-orchestration'])
    expect(roster.modes[0]).toMatchObject({
      trust: 'system',
      preset: 'orchestration-sample',
      entryFlow: 'pipeline',
    })
    const doc = await ctx.agentModes.readDocument('hello-orchestration')
    expect(doc.bind.preset).toBe('orchestration-sample')
    const types = new Set(doc.entryGraph.nodes.map(node => node.type))
    expect(types.has('condition')).toBe(true)
    expect(types.has('loop')).toBe(true)
    expect(types.has('agent')).toBe(true)
    expect(doc.entryGraph.edges.some(edge => edge.label === 'true')).toBe(true)
    expect(doc.entryGraph.edges.some(edge => edge.label === 'body')).toBe(true)
    expect(doc.entryGraph.nodes.some(node =>
      node.type === 'agent' && node.agentOptions?.model !== undefined)).toBe(true)
    expect(doc.entryGraph.nodes.every(node =>
      node.type !== 'agent' || node.childPresetId === undefined)).toBe(true)
    // Parallel fan-out: one agent with two unlabeled outgoing edges.
    const parallelSource = doc.entryGraph.nodes.find(node => node.id === 'decline')
    expect(parallelSource?.type).toBe('agent')
    expect(doc.entryGraph.edges.filter(edge => edge.from === 'decline')).toHaveLength(2)
  })

  it('startEntry runs the bound entry flow and refuses sessions without a mode', async () => {
    const root = await tempRoot()
    await writeFixtureMode(root, 'demo', 'preset: standard\nentryFlow: pipeline\n', VALID_FLOW)
    const ctx = new Context()
    const run = vi.fn(() => ({ runId: 'run-1' }))
    ctx.provide('flowEngine', { run, getRun: () => undefined })
    await ctx.plugin(AgentModes, {
      roots: [{ path: root, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })
    const blank = {
      session: {
        header: {
          version: 0,
          id: 's',
          createdAt: 1,
          delegationDepth: 0,
        },
        events: [],
      },
    }
    await expect(ctx.agentModes.startEntry(blank as never)).rejects.toMatchObject({
      failure: { code: 'agent-mode-missing' },
    })
    const stamped = {
      session: {
        header: {
          version: 0,
          id: 's',
          createdAt: 1,
          delegationDepth: 0,
          agentMode: 'demo',
        },
        events: [],
      },
    }
    await expect(ctx.agentModes.startEntry(stamped as never, 'goal text')).resolves.toEqual({
      runId: 'run-1',
      agentMode: 'demo',
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      parent: stamped,
      input: 'goal text',
      graph: expect.objectContaining({ id: 'pipeline' }),
    }))
  })

  it('validate reports a valid graph as empty and a broken one without writing', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentModes, { roots: [], includeShippedRoot: false, includeUserRoot: false })
    const valid = JSON.parse(VALID_FLOW).flow
    expect(await ctx.agentModes.validateGraph(valid)).toEqual({ errors: [] })
    const dangling = {
      ...valid,
      edges: [...valid.edges, { id: 'stray', from: 'a', to: 'nowhere' }],
    }
    const { errors } = await ctx.agentModes.validateGraph(dangling)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(error => error.includes('nowhere'))).toBe(true)
  })
})
