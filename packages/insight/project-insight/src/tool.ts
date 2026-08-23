/**
 * The model-facing `scan_project` tool: a function plugin mounted inside agent
 * presets (the develop preset is the first consumer). It resolves the host-plane
 * project-insight service through `ctx.get` — the service lives in the host
 * composition, so a preset mounting this tool without it fails loud at mount.
 * The tool returns the compact model-visible summary, never the full document,
 * and its `presentationMeta` makes the outcome model-visible ⟺ logged.
 * @module @deepseek-ai/dsh-project-insight/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ProjectInsightError } from './error.ts'

/** Cordis plugin name. */
export const name = 'tool-project-insight'
/** Service the plugin registers its tool through. */
export const inject = ['tools']

/**
 * Register `scan_project` on the calling context.
 * @param ctx - context with the `tools` registry; the `projectInsight` service
 * must be mounted on the host composition.
 */
export function apply(ctx: Context): void {
  const service = ctx.get('projectInsight')
  if (service === undefined) {
    throw new Error(
      'tool-project-insight: the projectInsight service is not mounted; '
      + 'add "@deepseek-ai/dsh-project-insight" to the host composition',
    )
  }
  ctx.tools.register(defineTool({
    name: 'scan_project',
    description: 'Scan the current workspace project and return a compact map of its source modules, component dependencies, components, tech stack, prompts, and agent-related files. Call this once when entering a project workspace before planning changes, so you can locate the files a bug fix or feature change touches, and again after significant file changes to refresh the map.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['scanned', 'unchanged', 'error'] },
          root: { type: 'string', required: true, description: 'project root name' },
          path: { type: 'string', required: true, description: 'document path relative to the project root' },
          error: { type: 'string', description: 'failure text when status is error' },
          summary: {
            type: 'object',
            additionalProperties: false,
            properties: {
              files: { type: 'number', required: true },
              modules: { type: 'number', required: true },
              edges: { type: 'number', required: true },
              components: { type: 'number', required: true },
              techStack: { type: 'array', required: true, items: { type: 'string' } },
              prompts: { type: 'number', required: true },
              agentTechFiles: { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderScan(value) }],
      presentationMeta: (_args, value) => ({
        code: value.status,
        ...value.summary !== undefined
          ? { modules: value.summary.modules, components: value.summary.components }
          : {},
      }),
    },
    presentCall: () => ({ card: 'generic', title: 'Scan workspace project', kind: 'read', rawInput: '' }),
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new ProjectInsightError('NO_SESSION', 'scan_project requires an agent session')
      }
      const cwd = agent.session.header.cwd
      if (cwd === undefined) {
        throw new ProjectInsightError('NO_CWD', 'scan_project requires a session working directory')
      }
      return await service.scan(cwd, agent.session.id, exec.signal)
    },
  }))
}

/**
 * One-line model-facing projection of a scan result.
 * @param value - the tool's canonical output value.
 * @returns the text block content.
 */
function renderScan(value: {
  status: string
  root: string
  path: string
  error?: string
  summary?: {
    files: number
    modules: number
    edges: number
    components: number
    techStack: string[]
    prompts: number
    agentTechFiles: number
  }
}): string {
  if (value.status === 'scanned' && value.summary !== undefined) {
    return `scanned ${value.root} into ${value.path}: `
      + `${value.summary.modules} modules, ${value.summary.edges} import edges, `
      + `${value.summary.components} components, ${value.summary.files} source files`
  }
  if (value.status === 'unchanged') {
    return `workspace ${value.root} is unchanged; the document at ${value.path} is current`
  }
  return `scan of ${value.root} failed: ${value.error ?? 'unknown error'}`
}
