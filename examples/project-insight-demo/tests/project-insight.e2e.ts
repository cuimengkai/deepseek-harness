import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ProjectInsightDoc } from '@deepseek-ai/dsh-project-insight'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const binScript = fileURLToPath(new URL('./fixtures/project-insight-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/project-insight.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Write the deterministic fixture workspace the scan commits into `.dsh/`. */
async function seedFixtureProject(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'fixture-project',
    private: true,
    version: '0.0.1',
    engines: { node: '>=22' },
    dependencies: {
      '@element-plus/icons-vue': '^2.3.1',
      'element-plus': '^2.9.0',
      vue: '^3.5.0',
    },
    devDependencies: {
      typescript: '^5.6.0',
      vite: '^6.0.0',
    },
  }, null, 2))
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
  }, null, 2))
  await mkdir(join(root, 'src', 'components'), { recursive: true })
  await mkdir(join(root, 'src', 'utils'), { recursive: true })
  await writeFile(join(root, 'src', 'main.ts'), [
    "import Button from '@/components/Button'",
    "import Header from '@/components/Header.vue'",
    "import { formatDate } from '@/utils/format'",
    '',
    'console.log(formatDate(new Date()))',
    '',
  ].join('\n'))
  await writeFile(join(root, 'src', 'utils', 'format.ts'), [
    'export function formatDate(date: Date): string {',
    '  return date.toISOString()',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(root, 'src', 'components', 'Header.vue'), [
    '<script setup lang="ts">',
    "import Button from '@/components/Button'",
    'defineProps({ title: { type: String, required: true } })',
    '</script>',
    '',
    '<template>',
    '  <header class="header">',
    '    <h1>{{ title }}</h1>',
    '    <Button />',
    '  </header>',
    '</template>',
    '',
  ].join('\n'))
  await writeFile(join(root, 'src', 'components', 'Button.tsx'), [
    'export function Button(props: { label: string }): string {',
    '  return `<button>${props.label}</button>`',
    '}',
    '',
  ].join('\n'))
  await mkdir(join(root, 'prompts'), { recursive: true })
  await writeFile(join(root, 'prompts', 'review.prompt.md'), '# Review checklist\n', 'utf8')
  await mkdir(join(root, '.claude'), { recursive: true })
  await writeFile(join(root, '.claude', 'settings.json'), '{ "permissions": { "allow": [] } }\n', 'utf8')
}

describe('project-insight demo keyless smoke', () => {
  it('boots the real Loader tree, runs a scan_project round trip, and commits the document', async () => {
    // `prepare` seeds the fixture project and points the child process at it via
    // an environment override layered in before spawn (runLoaderSmoke spreads
    // `options.env` after prepare runs).
    const env: NodeJS.ProcessEnv = {}
    let projectDir = ''
    let persistedDoc: ProjectInsightDoc | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'project-insight-demo',
      tempDirPrefix: 'project-insight-demo-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'scan the workspace project'],
      tsconfigPath,
      env,
      prepare: async (cwd) => {
        projectDir = join(cwd, 'fixture-project')
        env.DSH_DEMO_PROJECT_DIR = projectDir
        await seedFixtureProject(projectDir)
      },
      inspect: async (cwd) => {
        // Reassemble the committed document from its per-type layout: a meta
        // file with the identity fields plus one `data.json` per scanned section.
        const base = join(cwd, 'fixture-project', '.dsh', 'insight')
        const readJson = async (rel: string): Promise<unknown> =>
          JSON.parse(await readFile(join(base, rel), 'utf8'))
        const meta = await readJson('meta.json') as Record<string, unknown>
        persistedDoc = {
          formatVersion: meta['formatVersion'],
          rootName: meta['rootName'],
          contentFingerprint: meta['contentFingerprint'],
          statSignature: meta['statSignature'],
          scannedAt: meta['scannedAt'],
          sections: {
            techStack: await readJson('tech-stack/data.json'),
            moduleTopology: await readJson('module-topology/data.json'),
            componentDependencies: await readJson('component-dependencies/data.json'),
            components: await readJson('components/data.json'),
            prompts: await readJson('prompts/data.json'),
            agentTech: await readJson('agent-tech/data.json'),
          },
        } as unknown as ProjectInsightDoc
      },
    })

    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    const result = lines.at(-1)
    expect(stderr).toBe('')
    expect(events.some(event => event.type === 'tool/call' && event.data.name === 'scan_project')).toBe(true)
    const toolResult = events.find(event => event.type === 'tool/result')
    // The model-visible ⟺ logged projection: `presentationMeta` is persisted
    // verbatim on the durable tool/result event.
    expect(toolResult?.['data']?.['meta']).toEqual({ code: 'scanned', modules: 4, components: 2 })
    expect(String(result?.['output'])).toContain('Project scan round trip complete')
    expect(String(result?.['output'])).toContain('4 modules')

    expect(projectDir).not.toBe('')
    expect(persistedDoc).toBeDefined()
    const doc = persistedDoc!
    expect(doc.formatVersion).toBe(5)
    expect(doc.rootName).toBe('fixture-project')
    expect(doc.contentFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(doc.statSignature).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof doc.scannedAt).toBe('number')

    const topologyPaths = doc.sections.moduleTopology.files.map(file => file.path)
    expect(topologyPaths).toEqual([
      'src/components/Button.tsx',
      'src/components/Header.vue',
      'src/main.ts',
      'src/utils/format.ts',
    ])
    const main = doc.sections.moduleTopology.files.find(file => file.path === 'src/main.ts')
    expect(main?.imports).toEqual([
      'src/components/Button.tsx',
      'src/components/Header.vue',
      'src/utils/format.ts',
    ])
    expect(doc.sections.moduleTopology.aliases).toEqual([{ key: '@', value: 'src' }])
    expect(doc.sections.moduleTopology.internalRoots).toEqual(['src'])

    const components = doc.sections.components.components
    expect(doc.sections.components.count).toBe(2)
    expect(components).toContainEqual({
      path: 'src/components/Header.vue', name: 'Header', kind: 'vue', defaultExport: true, hasProps: true,
    })
    expect(components).toContainEqual({
      path: 'src/components/Button.tsx', name: 'Button', kind: 'react', defaultExport: false, hasProps: true,
    })

    const headerDeps = doc.sections.componentDependencies.components.find(row => row.path === 'src/components/Header.vue')
    expect(headerDeps?.imports).toEqual(['src/components/Button.tsx'])

    expect(doc.sections.techStack.manifests).toContainEqual({ kind: 'package.json', path: 'package.json' })
    const dependencyNames = doc.sections.techStack.dependencies.map(dependency => dependency.name)
    expect(dependencyNames).toContain('vue')
    expect(dependencyNames).toContain('element-plus')
    expect(doc.sections.techStack.runtimes).toContainEqual({ name: 'node', version: '>=22' })

    expect(doc.sections.prompts.files).toContainEqual({
      path: 'prompts/review.prompt.md', title: 'Review checklist', bytes: 19,
    })
    expect(doc.sections.agentTech.files).toContainEqual({
      path: '.claude/settings.json', kind: 'tool-config',
    })
    // The v5 agent-tech section carries the embedded content collections:
    // no skills or mcp configs are seeded, and the root prompt file is embedded.
    expect(doc.sections.agentTech.skills).toEqual([])
    expect(doc.sections.agentTech.mcp).toEqual([])
    expect(doc.sections.agentTech.prompts).toEqual([
      { name: 'review.prompt.md', path: 'prompts/review.prompt.md', content: '# Review checklist\n' },
    ])
    // The shared documents pool carries content for every remaining listed
    // file: the inventory's non-embedded configs, the source files, and the
    // manifests, sorted by path.
    expect(doc.sections.documents.files.map(row => row.path)).toEqual([
      '.claude/settings.json',
      'package.json',
      'src/components/Button.tsx',
      'src/components/Header.vue',
      'src/main.ts',
      'src/utils/format.ts',
    ])
    expect(doc.sections.documents.files).toContainEqual({
      name: 'settings.json', path: '.claude/settings.json',
      content: '{ "permissions": { "allow": [] } }\n',
    })
    expect(doc.sections.documents.count).toBe(6)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
