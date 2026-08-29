/**
 * Type-only surface of `@deepseek-ai/dsh-project-insight`: the Cordis event the
 * service emits when a workspace scan commits, plus the client-safe wire
 * vocabulary of the `projectInsight` Remote. This module carries no runtime
 * code; it exists so consumers merge the typed event and wire types into their
 * programs.
 * @module @deepseek-ai/dsh-project-insight/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A project-insight scan for one session's workspace committed to disk.
     * Emitted only after the atomic write succeeds, so listeners treat the
     * event as proof the `.dsh/insight/` document is readable.
     * @param sessionId - the session whose workspace was scanned.
     * @mode emit
     */
    'project-insight/updated'(sessionId: SessionId): void
  }
}

/** Whether a stored document exists and matches the current tree. */
export type ProjectInsightReadStatus = 'none' | 'fresh' | 'stale' | 'error'

/** The result of a project-insight document read. */
export interface ProjectInsightReadResult {
  readonly status: ProjectInsightReadStatus
  /** Project root basename — identity only, never a Host path. */
  readonly root: string
  /** The stored document, when one exists and parses. */
  readonly doc?: import('./schema.ts').ProjectInsightDoc
  /** Human-readable failure text when `status` is `'error'`. */
  readonly error?: string
}
