/**
 * Authoring a preset copies an existing one's directory into the deployment's
 * `user` root, or writes a validated tree through the rows-based `write`
 * primitive the platform preset assembler uses. Neither lets a caller supply
 * freeform composition text: a copy reuses an existing preset verbatim, and
 * `write` owns id validation, occupancy refusal, mode tightening, and atomic
 * writes. The id is a directory name, so its pattern is a containment boundary
 * rather than a style rule; the shipped `.system` set stays read-only.
 */

import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import * as yaml from 'js-yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import AgentPresets, {
  ComposeModuleError, COMPOSITION_FILE, copyComposition, METADATA_FILE, parseComposition,
} from '@deepseek-ai/dsh-agent-presets'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const VALID = '- id: tool-alpha\n  name: ../../plugins/contribute.js\n  config:\n    tool: alpha\n'

let ctx: Context
let userRoot: string

/** Hand-craft a preset directory (tests cannot author text through the service). */
async function seedPreset(
  root: string, id: string, options: { composition?: string; metadata?: string; extras?: Record<string, string> } = {},
): Promise<void> {
  await mkdir(join(root, id), { recursive: true })
  await writeFile(join(root, id, COMPOSITION_FILE), options.composition ?? VALID)
  if (options.metadata !== undefined) {
    await writeFile(join(root, id, METADATA_FILE), options.metadata)
  }
  for (const [name, content] of Object.entries(options.extras ?? {})) {
    await mkdir(dirname(join(root, id, name)), { recursive: true })
    await writeFile(join(root, id, name), content)
  }
}

beforeEach(async () => {
  userRoot = await mkdtemp(join(tmpdir(), 'dsh-preset-authoring-'))
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(AgentPresets, {
    default: 'standard',
    roots: [
      { path: join(FIXTURES, 'system'), trust: 'system' as const },
      { path: userRoot, trust: 'user' as const },
    ],
    // Every roster in this file pins its own roots: the derived harness-home
    // root would add the developer's real presets to what these assertions
    // count, and `copy` would write into it.
    includeUserRoot: false,
  })
})

describe('copying a preset', () => {
  it('copies a shipped preset into the user root and lists it', async () => {
    await ctx.agentPresets.copy('standard', 'mine')

    expect(await readFile(join(userRoot, 'mine', COMPOSITION_FILE), 'utf8'))
      .toBe(await ctx.agentPresets.read('standard'))
    const listed = await ctx.agentPresets.list()
    expect(listed.find(preset => preset.id === 'mine')?.trust).toBe('user')
  })

  it('copies the whole directory and tightens POSIX modes', async () => {
    await seedPreset(userRoot, 'source', {
      extras: { 'skills/demo/SKILL.md': '# demo\n', 'skills/demo/run.sh': '#!/bin/sh\n' },
    })
    if (process.platform !== 'win32') {
      await chmod(join(userRoot, 'source', 'skills', 'demo', 'run.sh'), 0o755)
    }

    await ctx.agentPresets.copy('source', 'mine')

    expect(await readFile(join(userRoot, 'mine', 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe('# demo\n')
    // Windows mode bits are synthetic and cannot represent the inherited DACL.
    if (process.platform !== 'win32') {
      expect((await stat(join(userRoot, 'mine', 'skills', 'demo', 'run.sh'))).mode & 0o777).toBe(0o700)
      expect((await stat(join(userRoot, 'mine', 'skills', 'demo', 'SKILL.md'))).mode & 0o777).toBe(0o600)
      expect((await stat(join(userRoot, 'mine'))).mode & 0o777).toBe(0o700)
    }
  })

  it('keeps the source description but never its name or order', async () => {
    await seedPreset(userRoot, 'source', { metadata: 'name: 源模式\ndescription: 只做检索。\norder: 1\n' })

    await ctx.agentPresets.copy('source', 'mine')

    // Two rows presenting identically is how a roster stops being a chooser,
    // and the shipped set's declared order is not the copy's to claim.
    const metadata = await readFile(join(userRoot, 'mine', METADATA_FILE), 'utf8')
    expect(metadata).toContain('description: 只做检索。')
    expect(metadata).not.toContain('name:')
    expect(metadata).not.toContain('order:')
    expect((await ctx.agentPresets.list()).find(preset => preset.id === 'mine'))
      .toMatchObject({ description: '只做检索。' })
  })

  it('stores the display name the author supplied', async () => {
    await ctx.agentPresets.copy('standard', 'mine', '我的模式')

    expect(await readFile(join(userRoot, 'mine', METADATA_FILE), 'utf8')).toContain('name: 我的模式')
    expect((await ctx.agentPresets.list()).find(preset => preset.id === 'mine'))
      .toMatchObject({ name: '我的模式' })
  })

  it('publishes no metadata file when there is nothing to publish', async () => {
    await seedPreset(userRoot, 'source')

    await ctx.agentPresets.copy('source', 'mine')

    // An empty metadata document would read as an intentional blank name;
    // absence is what "this preset publishes no display text" looks like.
    expect(existsSync(join(userRoot, 'mine', METADATA_FILE))).toBe(false)
    expect((await ctx.agentPresets.list()).find(preset => preset.id === 'mine')?.name).toBeUndefined()
  })

  it('refuses an id that could escape the preset root', async () => {
    for (const id of ['../escape', 'a/b', '/abs', '..', 'Upper']) {
      await expect(ctx.agentPresets.copy('standard', id)).rejects.toThrow(/must match/)
    }
    // Nothing was created for any of them.
    expect(existsSync(join(userRoot, 'escape'))).toBe(false)
  })

  it('refuses an id the roster already supplies, shipped ones included', async () => {
    await ctx.agentPresets.copy('standard', 'mine')

    await expect(ctx.agentPresets.copy('standard', 'mine')).rejects.toThrow(/already exists/)
    // A user directory named like a shipped preset would be shadowed by it.
    await expect(ctx.agentPresets.copy('standard', 'minimal')).rejects.toThrow(/already exists/)
  })

  it('refuses a directory that occupies the name without being a preset', async () => {
    await mkdir(join(userRoot, 'occupied'), { recursive: true })
    await writeFile(join(userRoot, 'occupied', 'README.txt'), 'nope\n')

    // Discovery does not list it (no composition file), so only the disk
    // check can refuse it with a readable error instead of a filesystem code.
    await expect(ctx.agentPresets.copy('standard', 'occupied')).rejects.toThrow(/already exists/)
    expect(await readFile(join(userRoot, 'occupied', 'README.txt'), 'utf8')).toBe('nope\n')
  })

  it('reports an unknown source rather than creating anything', async () => {
    await expect(ctx.agentPresets.copy('never-existed', 'mine')).rejects.toThrow(/not found/)
    expect(existsSync(join(userRoot, 'mine'))).toBe(false)
  })

  it('leaves nothing behind when the copy itself fails', async () => {
    const source = {
      id: 'gone',
      trust: 'user' as const,
      path: join(userRoot, 'gone', COMPOSITION_FILE),
    }

    // The source vanished between resolve and copy: the half-made target is
    // rolled back rather than left invisible to discovery.
    await expect(copyComposition(
      [{ path: userRoot, trust: 'user' as const }], source, 'mine',
    )).rejects.toThrow()
    expect(existsSync(join(userRoot, 'mine'))).toBe(false)
  })
})

describe('deleting a preset', () => {
  it('removes a locally authored one', async () => {
    await ctx.agentPresets.copy('standard', 'mine')

    await ctx.agentPresets.remove('mine')

    expect(existsSync(join(userRoot, 'mine'))).toBe(false)
    expect((await ctx.agentPresets.list()).some(preset => preset.id === 'mine')).toBe(false)
  })

  it('refuses to delete a shipped one', async () => {
    await expect(ctx.agentPresets.remove('standard'))
      .rejects.toThrow(/ships with the deployment/)
  })

  it('reports an unknown id rather than silently succeeding', async () => {
    await expect(ctx.agentPresets.remove('never-existed')).rejects.toThrow(/not found/)
  })
})

describe('a deployment with more than one user root', () => {
  it('refuses to delete a preset the writable root does not own', async () => {
    const second = await mkdtemp(join(tmpdir(), 'dsh-preset-second-'))
    await seedPreset(second, 'elsewhere')
    const layered = new Context()
    layered.baseUrl = pathToFileURL(FIXTURES).href + '/'
    await layered.plugin(Loader)
    layered.loader.builtins.include = Include
    await layered.plugin(AgentPresets, {
      default: 'standard',
      roots: [
        { path: userRoot, trust: 'user' as const },
        { path: second, trust: 'user' as const },
      ],
      includeUserRoot: false,
    })

    // Writes go to the first user root, so a preset discovered from a later
    // one is `user` trust yet outside what deletion is allowed to touch —
    // `rm -r` on a directory this root does not own is the failure to avoid.
    await expect(layered.agentPresets.remove('elsewhere'))
      .rejects.toThrow(/does not live under the writable preset root/)
    expect(existsSync(join(second, 'elsewhere'))).toBe(true)
  })
})

describe('a deployment with no writable root', () => {
  it('says authoring is unavailable rather than guessing a directory', async () => {
    const readOnly = new Context()
    readOnly.baseUrl = pathToFileURL(FIXTURES).href + '/'
    await readOnly.plugin(Loader)
    readOnly.loader.builtins.include = Include
    await readOnly.plugin(AgentPresets, {
      default: 'standard',
      roots: [{ path: join(FIXTURES, 'system'), trust: 'system' as const }],
      includeUserRoot: false,
    })

    expect(readOnly.agentPresets.authorable).toBe(false)
    await expect(readOnly.agentPresets.copy('standard', 'mine'))
      .rejects.toThrow(/no user-writable preset root/)
  })
})

describe('a user root that does not exist yet', () => {
  it('is created by the first copy', async () => {
    const absent = join(await mkdtemp(join(tmpdir(), 'dsh-preset-absent-')), 'nested', 'preset')
    const fresh = new Context()
    fresh.baseUrl = pathToFileURL(FIXTURES).href + '/'
    await fresh.plugin(Loader)
    fresh.loader.builtins.include = Include
    await fresh.plugin(AgentPresets, {
      default: 'standard',
      roots: [
        { path: join(FIXTURES, 'system'), trust: 'system' as const },
        { path: absent, trust: 'user' as const },
      ],
      includeUserRoot: false,
    })

    await fresh.agentPresets.copy('standard', 'mine')

    expect(await readFile(join(absent, 'mine', COMPOSITION_FILE), 'utf8'))
      .toBe(await fresh.agentPresets.read('standard'))
  })
})

describe('display metadata beside a composition', () => {
  it('keeps a composition mountable when its metadata is unreadable', async () => {
    await ctx.agentPresets.copy('standard', 'mine')
    await writeFile(join(userRoot, 'mine', METADATA_FILE), 'name: [unclosed\n')

    // Presentation is not capability: discovery still yields the preset.
    const listed = (await ctx.agentPresets.list()).find(preset => preset.id === 'mine')
    expect(listed?.name).toBeUndefined()
    expect(await ctx.agentPresets.resolve('mine')).toMatchObject({ id: 'mine' })
  })
})

describe('the on-disk occupancy backstop', () => {
  it('refuses a directory the roster cannot see', async () => {
    // The service's roster check sees every id-shaped directory now, so this
    // is the race backstop: a directory appearing between the roster read and
    // the copy still gets the readable refusal, not a filesystem error code.
    await mkdir(join(userRoot, 'raced'), { recursive: true })
    const source = await ctx.agentPresets.resolve('standard')

    await expect(copyComposition(
      [{ path: userRoot, trust: 'user' as const }], source, 'raced',
    )).rejects.toThrow(/already exists/)
  })
})

describe('a ghost directory under the user root', () => {
  it('lists broken, blocks its id, and clears through remove', async () => {
    // The classic hand-edit: the composition file was deleted, the directory
    // stayed. It must not vanish from the roster — its id is still taken, so
    // there has to be something to see and delete.
    await mkdir(join(userRoot, 'ghost'), { recursive: true })
    await writeFile(join(userRoot, 'ghost', 'README.txt'), 'composition deleted by hand\n')

    const ghost = (await ctx.agentPresets.list()).find(preset => preset.id === 'ghost')
    expect(ghost?.broken).toMatch(/agent\.cordis\.yml is missing/)
    await expect(ctx.agentPresets.copy('standard', 'ghost')).rejects.toThrow(/already exists/)

    // remove is the way out the roster row offers; the id is claimable again.
    await ctx.agentPresets.remove('ghost')
    expect(existsSync(join(userRoot, 'ghost'))).toBe(false)
    await ctx.agentPresets.copy('standard', 'ghost')
    expect((await ctx.agentPresets.list()).find(preset => preset.id === 'ghost')?.broken).toBeUndefined()
  })
})

describe('writing a preset from rows', () => {
  it('writes a composition the roster reads back unchanged', async () => {
    const rows: EntryOptions[] = [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'base persona' } },
      { id: 'content-planning', name: 'persona-row', config: { section: 'capability:content-planning', order: 10, text: 'plan' } },
    ]

    await ctx.agentPresets.write('assembled', rows)

    const parsed = yaml.load(await ctx.agentPresets.read('assembled'), { schema: entryListSchema }) as EntryOptions[]
    expect(parsed).toEqual(rows)
    expect((await ctx.agentPresets.list()).find(preset => preset.id === 'assembled')?.trust).toBe('user')
  })

  it('round-trips a `!!js` disabled node through the written composition', async () => {
    const rows: EntryOptions[] = [
      {
        id: 'content-analytics-desktop', name: 'persona-row',
        disabled: { __jsExpr: "process.platform === 'darwin'" } as unknown as boolean,
        config: {},
      },
    ]

    await ctx.agentPresets.write('assembled-disabled', rows)

    // The entry-list YAML dialect dumps the plain `{ __jsExpr }` node back to
    // the evaluable `!!js` scalar — the loader-level disabled gate is intact.
    const text = await ctx.agentPresets.read('assembled-disabled')
    expect(text).toContain("!!js process.platform === 'darwin'")
    const parsed = yaml.load(text, { schema: entryListSchema }) as EntryOptions[]
    expect(parsed[0]?.disabled).toEqual({ __jsExpr: "process.platform === 'darwin'" })
  })

  it('publishes the metadata the author supplied and tightens POSIX modes', async () => {
    await ctx.agentPresets.write('assembled-meta', [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'base' } }], {
      name: 'Assembled',
      description: 'assembled from the capability market',
    })

    const metadata = await readFile(join(userRoot, 'assembled-meta', METADATA_FILE), 'utf8')
    expect(metadata).toContain('name: Assembled')
    expect(metadata).toContain('description: assembled from the capability market')
    expect((await ctx.agentPresets.list()).find(preset => preset.id === 'assembled-meta'))
      .toMatchObject({ name: 'Assembled', description: 'assembled from the capability market' })
    if (process.platform !== 'win32') {
      expect((await stat(join(userRoot, 'assembled-meta', COMPOSITION_FILE))).mode & 0o777).toBe(0o600)
      expect((await stat(join(userRoot, 'assembled-meta'))).mode & 0o777).toBe(0o700)
    }
  })

  it('refuses an id that could escape the preset root and one the roster already supplies', async () => {
    for (const id of ['../escape', 'a/b', '/abs', '..', 'Upper']) {
      await expect(ctx.agentPresets.write(id, [{ id: 'p', name: 'x' }])).rejects.toThrow(/must match/)
    }
    expect(existsSync(join(userRoot, 'escape'))).toBe(false)

    await ctx.agentPresets.write('assembled', [{ id: 'p', name: 'x' }])
    await expect(ctx.agentPresets.write('assembled', [{ id: 'q', name: 'y' }])).rejects.toThrow(/already exists/)
    // A shipped preset id is refused by the roster check, like copy.
    await expect(ctx.agentPresets.write('standard', [{ id: 'p', name: 'x' }])).rejects.toThrow(/already exists/)
  })
})

describe('composing a preset from rows', () => {
  it('creates a preset the roster and readRows read back', async () => {
    await ctx.agentPresets.compose('composed', [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'base' } },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
    ], undefined, { overwrite: false, assertResolvable: () => [] })

    const preset = (await ctx.agentPresets.list()).find(candidate => candidate.id === 'composed')
    expect(preset?.trust).toBe('user')
    expect(await ctx.agentPresets.readRows('composed')).toEqual([
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'base' } },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
    ])
  })

  it('round-trips a `!!js` disabled node and a group row', async () => {
    await ctx.agentPresets.compose('composed-group', [
      {
        id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash',
        disabled: { __jsExpr: "process.platform === 'win32'" } as unknown as boolean,
      },
      { id: 'tools', name: 'tools-group', group: true, config: [{ id: 'a', name: 'x' }] },
    ], undefined, { overwrite: false, assertResolvable: () => [] })

    const text = await ctx.agentPresets.read('composed-group')
    expect(text).toContain("!!js process.platform === 'win32'")
    expect(await ctx.agentPresets.readRows('composed-group')).toEqual([
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: { __jsExpr: "process.platform === 'win32'" } },
      { id: 'tools', name: 'tools-group', group: true, config: [{ id: 'a', name: 'x' }] },
    ])
  })

  it('replaces a user preset in place and leaves its directory otherwise intact', async () => {
    await seedPreset(userRoot, 'mine', { composition: '- id: a\n  name: x\n', extras: { 'skill.md': 'keep' } })

    await ctx.agentPresets.compose('mine', [{ id: 'persona', name: '@deepseek-ai/dsh-persona' }],
      { name: 'Mine' }, { overwrite: true, assertResolvable: () => [] })

    expect(await ctx.agentPresets.readRows('mine')).toEqual([{ id: 'persona', name: '@deepseek-ai/dsh-persona' }])
    expect(await readFile(join(userRoot, 'mine', COMPOSITION_FILE), 'utf8')).toContain('name: \'@deepseek-ai/dsh-persona\'')
    expect(await readFile(join(userRoot, 'mine', METADATA_FILE), 'utf8')).toContain('name: Mine')
    // The directory's other contents survive; only the composition changed.
    expect(existsSync(join(userRoot, 'mine', 'skill.md'))).toBe(true)
  })

  it('refuses an uninstalled module through the resolvability proof', async () => {
    await expect(ctx.agentPresets.compose('composed-bad', [{ id: 'p', name: '@deepseek-ai/dsh-missing' }],
      undefined, { overwrite: false, assertResolvable: () => ['@deepseek-ai/dsh-missing'] }))
      .rejects.toThrow(ComposeModuleError)
    expect(existsSync(join(userRoot, 'composed-bad'))).toBe(false)
  })

  it('refuses an empty or duplicate-id composition', async () => {
    await expect(ctx.agentPresets.compose('composed-empty', [], undefined,
      { overwrite: false, assertResolvable: () => [] })).rejects.toThrow(/at least one plugin row/)
    await expect(ctx.agentPresets.compose('composed-dupe', [
      { id: 'p', name: 'x' }, { id: 'p', name: 'y' },
    ], undefined, { overwrite: false, assertResolvable: () => [] })).rejects.toThrow(/repeated/)
  })

  it('refuses to overwrite a shipped preset and to create over an occupied id', async () => {
    await expect(ctx.agentPresets.compose('standard', [{ id: 'p', name: 'x' }], undefined,
      { overwrite: true, assertResolvable: () => [] })).rejects.toThrow(/only a locally authored preset may be overwritten/)
    await seedPreset(userRoot, 'mine', {})
    await expect(ctx.agentPresets.compose('mine', [{ id: 'a', name: 'x' }], undefined,
      { overwrite: false, assertResolvable: () => [] })).rejects.toThrow(/already exists/)
  })

  it('readRows parses a shipped composition and refuses an unparsable one', async () => {
    const rows = await ctx.agentPresets.readRows('standard')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toMatchObject({ name: expect.any(String) })
    await seedPreset(userRoot, 'broken', { composition: 'not: [valid\n' })
    await expect(ctx.agentPresets.readRows('broken')).rejects.toThrow()
  })
})

describe('parsing a composition document', () => {
  it('refuses a non-list document', () => {
    expect(() => parseComposition('name: not-a-list\n')).toThrow(/not a top-level list/)
  })
})
