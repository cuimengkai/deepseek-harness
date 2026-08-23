/**
 * project-insight domain zod schemas (names derived from the map key:
 * projectInsightReadRequestSchema / projectInsightReadValueSchema). The value
 * schema re-declares the bounded document vocabulary so the browser validates
 * the wire without importing the scanner's Node runtime.
 */

import { z } from 'zod'
import type { RequestPayload } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { ProjectInsightReadResult } from './project-insight.ts'

/** ManifestRow row of the tech-stack section. */
export const manifestRowSchema = z.object({
  kind: z.union([
    z.literal('package.json'),
    z.literal('pnpm-lock'),
    z.literal('package-lock'),
    z.literal('yarn-lock'),
    z.literal('bun-lock'),
    z.literal('requirements.txt'),
    z.literal('pyproject.toml'),
    z.literal('go.mod'),
    z.literal('Cargo.toml'),
  ]),
  path: z.string(),
}) satisfies z.ZodType<Wire<{
  kind: 'package.json' | 'pnpm-lock' | 'package-lock' | 'yarn-lock' | 'bun-lock'
    | 'requirements.txt' | 'pyproject.toml' | 'go.mod' | 'Cargo.toml'
  path: string
}>>

/** DependencyRow row of the tech-stack section. */
export const dependencyRowSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  category: z.union([
    z.literal('dependencies'),
    z.literal('devDependencies'),
    z.literal('peerDependencies'),
    z.literal('optionalDependencies'),
    z.literal('requirements'),
  ]),
}) satisfies z.ZodType<Wire<{ name: string; version?: string; category: string }>>

/** RuntimeRow row of the tech-stack section. */
export const runtimeRowSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
}) satisfies z.ZodType<Wire<{ name: string; version?: string }>>

/** SourceFileRow row of the tech-stack section. */
export const sourceFileRowSchema = z.object({
  path: z.string(),
  language: z.string(),
  lines: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<{ path: string; language: string; lines: number }>>

/** The tech-stack section. */
export const techStackSectionSchema = z.object({
  manifests: z.array(manifestRowSchema),
  dependencies: z.array(dependencyRowSchema),
  runtimes: z.array(runtimeRowSchema),
  files: z.array(sourceFileRowSchema),
})

/** ModuleFileRow row of the module-topology section. */
export const moduleFileRowSchema = z.object({
  path: z.string(),
  imports: z.array(z.string()),
}) satisfies z.ZodType<Wire<{ path: string; imports: string[] }>>

/** The module-topology section. */
export const moduleTopologySectionSchema = z.object({
  files: z.array(moduleFileRowSchema),
  internalRoots: z.array(z.string()),
  aliases: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })),
  externalCount: z.number().int().nonnegative(),
})

/** ComponentDependencyRow row of the component-dependency section. */
export const componentDependencyRowSchema = z.object({
  path: z.string(),
  imports: z.array(z.string()),
}) satisfies z.ZodType<Wire<{ path: string; imports: string[] }>>

/** The component-dependency section. */
export const componentDependenciesSectionSchema = z.object({
  components: z.array(componentDependencyRowSchema),
  cycles: z.array(z.tuple([z.string(), z.string()])),
})

/** ComponentRow row of the components section. */
export const componentRowSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.union([
    z.literal('react'),
    z.literal('vue'),
    z.literal('svelte'),
    z.literal('jsx'),
    z.literal('other'),
  ]),
  defaultExport: z.boolean(),
  hasProps: z.boolean(),
}) satisfies z.ZodType<Wire<{ path: string; name: string; kind: string; defaultExport: boolean; hasProps: boolean }>>

/** The components section. */
export const componentsSectionSchema = z.object({
  components: z.array(componentRowSchema),
  count: z.number().int().nonnegative(),
})

/** PromptRow row of the prompts section. */
export const promptRowSchema = z.object({
  path: z.string(),
  title: z.string().optional(),
  bytes: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<{ path: string; title?: string; bytes: number }>>

/** The prompts section. */
export const promptsSectionSchema = z.object({
  files: z.array(promptRowSchema),
  count: z.number().int().nonnegative(),
})

/** AgentTechFileRow row of the agent-related-technology section. */
export const agentTechFileRowSchema = z.object({
  path: z.string(),
  kind: z.union([
    z.literal('agent-config'),
    z.literal('tool-config'),
    z.literal('instructions'),
    z.literal('notes'),
    z.literal('other'),
  ]),
}) satisfies z.ZodType<Wire<{ path: string; kind: string }>>

/** AgentTechToolRow row of the agent-related-technology section. */
export const agentTechToolRowSchema = z.object({
  name: z.string(),
  path: z.string(),
}) satisfies z.ZodType<Wire<{ name: string; path: string }>>

/** The agent-related-technology section. */
export const agentTechSectionSchema = z.object({
  files: z.array(agentTechFileRowSchema),
  tools: z.array(agentTechToolRowSchema),
  count: z.number().int().nonnegative(),
})

/** The committed `project-insight.json` document. */
export const projectInsightDocSchema = z.object({
  formatVersion: z.literal(1),
  rootName: z.string(),
  contentFingerprint: z.string(),
  scannedAt: z.number().int().nonnegative(),
  sections: z.object({
    techStack: techStackSectionSchema,
    moduleTopology: moduleTopologySectionSchema,
    componentDependencies: componentDependenciesSectionSchema,
    components: componentsSectionSchema,
    prompts: promptsSectionSchema,
    agentTech: agentTechSectionSchema,
  }),
})

/** projectInsight.read request payload. */
export const projectInsightReadRequestSchema = z.object({
  cwd: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'projectInsight.read'>>>

/** projectInsight.read response value. */
export const projectInsightReadValueSchema = z.object({
  status: z.union([
    z.literal('none'),
    z.literal('fresh'),
    z.literal('stale'),
    z.literal('error'),
  ]),
  root: z.string(),
  doc: projectInsightDocSchema.optional(),
  error: z.string().optional(),
}) satisfies z.ZodType<Wire<ProjectInsightReadResult>>
