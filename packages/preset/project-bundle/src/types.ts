/**
 * Project-bundle vocabulary: one persisted shared bundle a session can start in.
 * @module @deepseek-ai/dsh-project-bundle/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one saved project bundle. Also the persisted file name. */
export type ProjectBundleId = Branded<'ProjectBundleId'>

/** Brand a string as a {@link ProjectBundleId}.
 * @param id - the raw id string.
 * @returns the same string, branded.
 */
export function ProjectBundleId(id: string): ProjectBundleId {
  return id as ProjectBundleId
}

/** On-disk document version; readers refuse any other. */
export const PROJECT_BUNDLE_FORMAT_VERSION = 1

/** One persisted project bundle. */
export interface ProjectBundle {
  readonly id: ProjectBundleId
  readonly name: string
  readonly instructions: string
  readonly connectorIds: readonly string[]
  readonly expertPresetIds: readonly string[]
  readonly skillPaths: readonly string[]
  /** Workspace directory every session started in this project uses. */
  readonly sharedRoot: string
  readonly updatedAt: number
}

/** Fields `create` / `update` accept. */
export interface ProjectBundleDraft {
  readonly name: string
  readonly instructions?: string
  readonly connectorIds?: readonly string[]
  readonly expertPresetIds?: readonly string[]
  readonly skillPaths?: readonly string[]
  readonly sharedRoot: string
}
