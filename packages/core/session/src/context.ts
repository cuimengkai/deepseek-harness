/**
 * Host-plane `ctx.sessions` face. Import this subpath explicitly in host-side
 * modules that read the durable `SessionStore` off the context. Client programs
 * never load it, so `@deepseek-ai/dsh-client-runtime`'s `ISessions` face stays
 * the only `sessions` declaration there; TypeScript refuses to merge two
 * Context augmentations that type the same key differently (TS2717), so each
 * plane opts in to its own face. The main index intentionally does not re-export
 * this module — that would re-inject the host face into client programs.
 *
 * @module @deepseek-ai/dsh-session/context
 */
import type { SessionStore } from './index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: SessionStore
  }
}
