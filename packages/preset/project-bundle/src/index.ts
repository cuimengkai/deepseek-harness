/**
 * Project bundles: persist a shared instructions + connectors + experts +
 * skills + sharedRoot card, and enable its connectors when a session starts
 * in that project.
 * @module @deepseek-ai/dsh-project-bundle
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ConnectorRegistry } from '@deepseek-ai/dsh-connector-registry'
import { ConnectorId } from '@deepseek-ai/dsh-connector-registry'
import {
  deleteProjectFile,
  idFromName,
  listProjectFiles,
  writeProjectFile,
} from './persist.ts'
import type { ProjectBundle, ProjectBundleDraft, ProjectBundleId } from './types.ts'

export type { ProjectBundle, ProjectBundleDraft } from './types.ts'
export { PROJECT_BUNDLE_FORMAT_VERSION, ProjectBundleId } from './types.ts'
export { PROJECT_BUNDLE_ID_PATTERN, idFromName } from './persist.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectBundles: ProjectBundleRegistry
  }
}

/** Deployment-tunable store root. */
export interface Config {
  /** Directory that holds `<id>.json` bundle documents. */
  readonly root: string
}

/**
 * File-backed project-bundle roster.
 */
export class ProjectBundleRegistry extends TypertRemoteService {
  static inject = []

  static Config = z.object({
    root: z.string().default(dshHomePath('projects')),
  }) as unknown as z<Config>

  private readonly bundles = new Map<string, ProjectBundle>()
  private connectors: ConnectorRegistry | undefined
  private ready: Promise<void>

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'projectBundles')
    ctx.inject(['connectors'], (scope) => {
      this.connectors = scope.connectors
      scope.effect(() => () => {
        this.connectors = undefined
      }, 'projectBundles.connectors()')
    })
    this.ready = this.hydrate()
  }

  /**
   * List every persisted bundle.
   * @returns bundles, id order.
   */
  @Remote('list')
  async list(): Promise<readonly ProjectBundle[]> {
    await this.ready
    return [...this.bundles.values()]
  }

  /**
   * Create one bundle.
   * @param draft - name, sharedRoot, and optional lists.
   * @returns the saved bundle.
   */
  @Remote('create')
  async create(draft: ProjectBundleDraft): Promise<ProjectBundle> {
    await this.ready
    const bundle = this.normalize(idFromName(draft.name, new Set(this.bundles.keys())), draft)
    await writeProjectFile(this.config.root, bundle)
    this.bundles.set(bundle.id, bundle)
    return bundle
  }

  /**
   * Replace one bundle's fields.
   * @param id - existing id.
   * @param draft - replacement fields.
   * @returns the saved bundle.
   */
  @Remote('update')
  async update(id: ProjectBundleId, draft: ProjectBundleDraft): Promise<ProjectBundle> {
    await this.ready
    if (!this.bundles.has(id)) throw new Error(`project "${id}" is not saved`)
    const bundle = this.normalize(id, draft)
    await writeProjectFile(this.config.root, bundle)
    this.bundles.set(id, bundle)
    return bundle
  }

  /**
   * Delete one bundle.
   * @param id - existing id.
   */
  @Remote('remove')
  async remove(id: ProjectBundleId): Promise<void> {
    await this.ready
    this.bundles.delete(id)
    await deleteProjectFile(this.config.root, id)
  }

  /**
   * Enable the project's connectors and return the bundle for session start.
   * The caller creates the session with `cwd = sharedRoot` and the first
   * `expertPresetIds` entry as `agentPreset` when present.
   * @param id - project id.
   * @returns the bundle after connector enable.
   */
  @Remote('prepareStart')
  async prepareStart(id: ProjectBundleId): Promise<ProjectBundle> {
    await this.ready
    const bundle = this.bundles.get(id)
    if (bundle === undefined) throw new Error(`project "${id}" is not saved`)
    if (this.connectors !== undefined) {
      for (const connectorId of bundle.connectorIds) {
        await this.connectors.setEnabled(ConnectorId(connectorId), true)
      }
    }
    return bundle
  }

  private normalize(id: ProjectBundleId, draft: ProjectBundleDraft): ProjectBundle {
    if (draft.name.trim() === '') throw new Error('project name is required')
    if (draft.sharedRoot.trim() === '') throw new Error('project sharedRoot is required')
    return {
      id,
      name: draft.name.trim(),
      instructions: draft.instructions ?? '',
      connectorIds: draft.connectorIds === undefined ? [] : [...draft.connectorIds],
      expertPresetIds: draft.expertPresetIds === undefined ? [] : [...draft.expertPresetIds],
      skillPaths: draft.skillPaths === undefined ? [] : [...draft.skillPaths],
      sharedRoot: draft.sharedRoot.trim(),
      updatedAt: Date.now(),
    }
  }

  private async hydrate(): Promise<void> {
    for (const bundle of await listProjectFiles(this.config.root)) {
      this.bundles.set(bundle.id, bundle)
    }
  }
}

export default ProjectBundleRegistry
