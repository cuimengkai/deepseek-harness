/**
 * The scanner is a pure function of the bounded file tree: same tree → the same
 * sections, fingerprint, and summary (modulo the runtime-only `scannedAt`),
 * arrays sorted, no absolute paths, caps enforced, ignored directories never
 * entered, and a committed document reads back fresh until the tree changes.
 */

import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanProject } from '../src/scanner.ts'
import {
  MAX_AGENT_TECH_MARKDOWN_BYTES, MAX_AGENT_TECH_MARKDOWN_ROWS,
  MAX_FINGERPRINT_FILES, MAX_SOURCE_BYTES, MAX_SOURCE_FILES,
} from '../src/schema.ts'
import { readDocument, writeDocument } from '../src/fingerprint.ts'

/** A pinned mtime (seconds, year 2096) an edited file is bumped to, so the
 * stale assertion never depends on filesystem timestamp granularity. */
const FUTURE_MTIME = 4_000_000_000

let roots: string[] = []

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-insight-scan-'))
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

describe('project-insight scanner', () => {
  it('produces identical sections, fingerprint, and summary across runs', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': JSON.stringify({ name: 'demo', dependencies: { vue: '^3.4.0' }, devDependencies: { typescript: '^5.0.0' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
      'src/main.ts': "import { App } from './app'\nimport vue from 'vue'\n",
      'src/app.ts': 'export const App = 1\n',
      'src/App.vue': "<script setup lang='ts'>\nimport { Button } from '@/components/button'\nimport AppHeader from './components/header.vue'\ndefineProps({ title: String })\n</script>\n<template><div><AppHeader /><Button /></div></template>",
      'src/components/button.ts': 'export default function Button() {}\n',
      'src/components/header.vue': '<template><header>H</header></template>',
      'prompts/fix.prompt.md': '# Fix the bug\nDescribe the bug.',
      'AGENTS.md': '# Project instructions',
    })

    const first = await scanProject(root)
    const second = await scanProject(root)

    // Runtime metadata differs; everything the document is judged on does not.
    expect(first.doc.scannedAt).not.toBe(second.doc.scannedAt)
    expect(first.doc.contentFingerprint).toBe(second.doc.contentFingerprint)
    expect(first.doc.statSignature).toBe(second.doc.statSignature)
    expect(first.doc.statSignature).toMatch(/^[0-9a-f]{64}$/)
    expect(first.doc.rootName).toBe(second.doc.rootName)
    expect(first.doc.sections).toEqual(second.doc.sections)
    expect(first.summary).toEqual(second.summary)
    expect(first.doc.formatVersion).toBe(3)
  })

  it('never leaks an absolute host path into the document', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': "import { a } from './a'\n",
      'src/a.ts': 'export const a = 1',
    })
    const { doc } = await scanProject(root)
    expect(JSON.stringify(doc)).not.toContain(root)
    expect(doc.rootName).toBe(basename(root))
  })

  it('emits every collection sorted by its stable key', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/z.ts': 'export const z = 1',
      'src/a.ts': 'export const a = 1',
      'src/m/b.ts': 'export const b = 1',
    })
    const { doc } = await scanProject(root)
    const modulePaths = doc.sections.moduleTopology.files.map(file => file.path)
    expect([...modulePaths].sort()).toEqual(modulePaths)
    const componentPaths = doc.sections.components.components.map(component => component.path)
    expect([...componentPaths].sort()).toEqual(componentPaths)
    expect(doc.sections.moduleTopology.internalRoots).toEqual(['src'])
  })

  it('resolves relative imports, aliases, and external packages', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
      'src/index.ts': "import { a } from './a'\nimport { b } from '@/lib'\nimport vue from 'vue'\nimport { c } from '@vue/compiler-sfc'\n",
      'src/a.ts': 'export const a = 1',
      'src/lib.ts': 'export const b = 2',
    })
    const { doc } = await scanProject(root)
    const file = doc.sections.moduleTopology.files.find(entry => entry.path === 'src/index.ts')
    expect(file?.imports).toEqual(['src/a.ts', 'src/lib.ts', 'external:vue', 'external:@vue/compiler-sfc'])
    expect(doc.sections.moduleTopology.aliases).toEqual([{ key: '@', value: 'src' }])
    expect(doc.sections.moduleTopology.externalCount).toBe(2)
  })

  it('extracts Vue SFC script imports and template component edges', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/App.vue': "<script setup lang='ts'>\nimport { Header } from './Header.vue'\n</script>\n<template>\n<Header />\n<Footer />\n</template>",
      'src/Header.vue': '<template><header>H</header></template>',
      'src/Footer.vue': '<template><footer>F</footer></template>',
    })
    const { doc } = await scanProject(root)
    expect(doc.sections.components.count).toBe(3)
    const app = doc.sections.componentDependencies.components.find(entry => entry.path === 'src/App.vue')
    // The script import plus the template tags reference both components.
    expect(app?.imports).toEqual(['src/Header.vue', 'src/Footer.vue'])
  })

  it('caps module files at MAX_SOURCE_FILES', async () => {
    const root = await tempProject()
    const files: Record<string, string> = { 'package.json': '{}' }
    for (let index = 0; index < 500; index += 1) {
      files[`src/mod${index}.ts`] = 'export const x = 1'
    }
    await seed(root, files)
    const { doc, summary } = await scanProject(root)
    expect(doc.sections.moduleTopology.files).toHaveLength(MAX_SOURCE_FILES)
    expect(summary.files).toBe(MAX_SOURCE_FILES)
    expect(summary.modules).toBe(MAX_SOURCE_FILES)
  })

  it('skips source files over the byte cap', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/small.ts': 'export const s = 1',
      'src/huge.ts': 'x'.repeat(MAX_SOURCE_BYTES + 1),
    })
    const { doc, summary } = await scanProject(root)
    const paths = doc.sections.moduleTopology.files.map(file => file.path)
    expect(paths).toEqual(['src/small.ts'])
    expect(summary.files).toBe(1)
  })

  it('never descends into ignored directories', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/index.ts': 'export {}',
      'node_modules/pkg/index.ts': 'export {}',
      '.git/config': '[core]',
      'dist/bundle.js': '// bundle',
      'build/out.ts': 'export {}',
      '.dsh/insight/meta.json': '{}',
    })
    const { doc } = await scanProject(root)
    const json = JSON.stringify(doc)
    expect(json).not.toContain('node_modules')
    expect(json).not.toContain('.git')
    expect(json).not.toContain('dist/')
    expect(json).not.toContain('build/')
    expect(json).not.toContain('.dsh')
  })

  it('reports a committed document fresh, then stale after an edit', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      'src/a.ts': 'export const a = 1',
    })
    const { doc } = await scanProject(root)
    await writeDocument(root, doc)

    const fresh = await readDocument(root, MAX_FINGERPRINT_FILES)
    expect(fresh?.status).toBe('fresh')

    await writeFile(join(root, 'src/a.ts'), 'export const a = 2')
    // The mtime bump is what turns the tree stale (the edit is same-size, so
    // only the stat mtime changes); pin it forward so the assertion never
    // depends on filesystem timestamp granularity.
    await utimes(join(root, 'src/a.ts'), FUTURE_MTIME, FUTURE_MTIME)
    const stale = await readDocument(root, MAX_FINGERPRINT_FILES)
    expect(stale?.status).toBe('stale')
  })

  it('detects the tech stack, runtimes, prompts, and agent files', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': JSON.stringify({ name: 'demo', engines: { node: '>=22' }, dependencies: { vue: '^3.4.0' } }),
      'pnpm-lock.yaml': 'lockfileVersion: \'9.0\'',
      'src/index.ts': 'export {}',
      'AGENTS.md': '# Repo instructions',
      'prompts/review.prompt.md': '# Review guide\nCheck the diff.',
      '.github/workflows/ci.yml': 'jobs: {}',
      '.agents/skills/deploy/SKILL.md': '# Deploy',
    })
    const { doc } = await scanProject(root)

    const tech = doc.sections.techStack
    expect(tech.manifests.map(entry => entry.path)).toEqual(['package.json', 'pnpm-lock.yaml'])
    expect(tech.dependencies).toEqual([{ name: 'vue', version: '^3.4.0', category: 'dependencies' }])
    expect(tech.runtimes).toContainEqual({ name: 'node', version: '>=22' })

    expect(doc.sections.prompts.count).toBe(2)
    expect(doc.sections.prompts.files).toContainEqual({ path: 'AGENTS.md', title: 'Repo instructions', bytes: expect.any(Number) })

    const agentTech = doc.sections.agentTech
    expect(agentTech.count).toBe(3)
    expect(agentTech.files).toContainEqual({ path: 'AGENTS.md', kind: 'instructions' })
    expect(agentTech.files).toContainEqual({ path: '.agents/skills/deploy/SKILL.md', kind: 'agent-config' })
    expect(agentTech.files).toContainEqual({ path: '.github/workflows/ci.yml', kind: 'tool-config' })
    expect(agentTech.tools).toContainEqual({ name: 'deploy', path: '.agents/skills/deploy/SKILL.md' })
    expect(agentTech.skills).toContainEqual({
      name: 'deploy', path: '.agents/skills/deploy/SKILL.md', markdown: '# Deploy',
    })
  })

  it('embeds skill, mcp, and prompt content with mcp env values redacted', async () => {
    const root = await tempProject()
    await seed(root, {
      'package.json': '{}',
      '.agents/skills/deploy/SKILL.md': '# Deploy\n\nShip the build.',
      '.claude/skills/review/SKILL.md': '# Review\n\nCheck the diff.',
      '.mcp.json': JSON.stringify({
        mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret-value' } } },
      }),
      'AGENTS.md': '# Repo instructions',
      '.claude/prompts/fix.prompt.md': '# Fix\n\nResolve the issue.',
    })
    const { doc } = await scanProject(root)
    const agentTech = doc.sections.agentTech

    // Skills: one row per SKILL.md, sorted by path, name is the skill directory.
    expect(agentTech.skills.map(row => row.name)).toEqual(['deploy', 'review'])
    expect(agentTech.skills).toContainEqual({
      name: 'deploy', path: '.agents/skills/deploy/SKILL.md', markdown: '# Deploy\n\nShip the build.',
    })

    // MCP: one row per config, env values redacted, rendered as a JSON block.
    expect(agentTech.mcp).toHaveLength(1)
    expect(agentTech.mcp[0]?.path).toBe('.mcp.json')
    expect(agentTech.mcp[0]?.markdown).toContain('```json')
    expect(agentTech.mcp[0]?.markdown).toContain('github')
    expect(agentTech.mcp[0]?.markdown).toContain('<redacted>')
    expect(agentTech.mcp[0]?.markdown).not.toContain('secret-value')

    // Prompts: agent-native prompt directories count alongside the root prompts.
    expect(agentTech.prompts.map(row => row.path)).toContain('.claude/prompts/fix.prompt.md')
    expect(agentTech.prompts.map(row => row.path)).toContain('AGENTS.md')
    expect(doc.sections.prompts.count).toBe(2)

    // The mcp config is also classified as a tool-config file in the inventory.
    expect(agentTech.files).toContainEqual({ path: '.mcp.json', kind: 'tool-config' })
  })

  it('caps and bounds the agent-tech markdown content deterministically', async () => {
    const root = await tempProject()
    const files: Record<string, string> = {}
    for (let index = 0; index < MAX_AGENT_TECH_MARKDOWN_ROWS + 5; index += 1) {
      files[`.agents/skills/skill${String(index).padStart(2, '0')}/SKILL.md`] = `# Skill ${index}`
    }
    files['.agents/skills/huge/SKILL.md'] = 'x'.repeat(MAX_AGENT_TECH_MARKDOWN_BYTES + 1)
    await seed(root, files)
    const { doc } = await scanProject(root)
    const agentTech = doc.sections.agentTech
    expect(agentTech.skills).toHaveLength(MAX_AGENT_TECH_MARKDOWN_ROWS)
    // A skill over the per-row byte cap is skipped, not embedded.
    expect(agentTech.skills.some(row => row.name === 'huge')).toBe(false)
    const second = await scanProject(root)
    expect(second.doc.sections.agentTech).toEqual(agentTech)
  })
})
