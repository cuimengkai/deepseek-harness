// Platform capability services for the role-preset demo.
//
// This is a harness plugin, demonstrating how the platform's capability layer
// mounts beside the runtime: a service contributes an asset registry plus the
// credential tools both role presets expose to their agents. Nothing here
// requires a real LLM — the demo drives the loop with the mock LLM server, so
// the entire role isolation story runs keyless.
//
// In the real platform these registries live on the control-plane side and the
// ACL is enforced at the fs/sandbox provider boundary; this demo keeps them in
// one plugin so the shape is visible in one file.

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    platformService: PlatformService
  }
}

/**
 * A registered platform asset: what the platform's unified asset store keeps
 * for a produced artifact. `content` holds the AI-visible projection (plain
 * text / structured data), not a binary file — the platform stores pointers to
 * real media elsewhere and only this projection enters the session context.
 */
export interface PlatformAsset {
  /** Stable id in the platform's business-object store. */
  id: string
  /** `requirement` | `design` | `code` | `test-case` | `handoff` */
  kind: string
  /** Free-form content (the AI-readable projection). */
  content: string
  /** Producing role: `product` | `ui` | `dev` | `qa`. */
  role: string
}

/** The capability surface the platform presents to a role's agent. */
export class PlatformService extends Service {
  private readonly assets = new Map<string, PlatformAsset>()
  private seq = 0

  constructor(ctx: Context) {
    super(ctx, 'platformService')
  }

  /** Register a produced asset, returning its id. */
  registerAsset(asset: Omit<PlatformAsset, 'id'>): string {
    const id = `${asset.kind}-${++this.seq}`
    this.assets.set(id, { ...asset, id })
    return id
  }

  /** Look up assets produced by a given role. */
  listAssets(role: string): PlatformAsset[] {
    return [...this.assets.values()].filter(asset => asset.role === role)
  }

  /** Look up a single asset by id. */
  getAsset(id: string): PlatformAsset | undefined {
    return this.assets.get(id)
  }
}

export default PlatformService
