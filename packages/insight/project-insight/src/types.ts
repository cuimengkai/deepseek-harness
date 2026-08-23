/**
 * Type-only surface of `@deepseek-ai/dsh-project-insight`: the Cordis event the
 * service emits when a workspace scan commits. This module carries no runtime
 * code; it exists so consumers merge the typed event into their programs.
 * @module @deepseek-ai/dsh-project-insight/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A project-insight scan for one session's workspace committed to disk.
     * Emitted only after the atomic write succeeds, so listeners treat the
     * event as proof the `.dsh/project-insight.json` document is readable.
     * @param sessionId - the session whose workspace was scanned.
     * @mode emit
     */
    'project-insight/updated'(sessionId: SessionId): void
  }
}
