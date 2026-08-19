/**
 * Human-facing `/session-delete` command over the cascade deletion seam.
 * @module @deepseek-ai/dsh-command-session-delete
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionDeletionError } from '@deepseek-ai/dsh-session-deletion'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'command-session-delete'
export const inject = ['commands', 'sessionDeletion']

const USAGE = 'Usage: /session-delete <sessionId>'

/** Convert the single expected capability failure into a concise human outcome. */
function expectedFailure(error: SessionDeletionError): CommandResult {
  return {
    kind: 'error',
    text: `Cannot delete running session(s): ${error.liveSessions.join(', ')}. Stop them before deleting.`,
  }
}

/** Execute one argument-carrying delete request. */
async function executeDelete(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const id = invocation.rawInput.trim()
  if (id.length === 0 || /\s/.test(id)) {
    return { kind: 'error', text: USAGE }
  }
  try {
    const result = await ctx.sessionDeletion.deleteSession(SessionId(id))
    if (result.deleted.length === 0) {
      return { kind: 'error', text: `Session "${id}" not found.` }
    }
    return {
      kind: 'success',
      text: result.notFound.length === 0
        ? `Deleted ${result.deleted.length} session(s).`
        : `Deleted ${result.deleted.length} session(s); ${result.notFound.length} were already absent.`,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Deletion cancelled.' }
    if (error instanceof SessionDeletionError) return expectedFailure(error)
    throw error
  }
}

/* jscpd:ignore-start -- the command registration/drain pattern is shared with command-compact's apply */
/**
 * Register `/session-delete` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the deletion seam.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeDelete(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'session-delete',
      description: 'Delete a session and its subagent tree',
      handler,
    })
  }, 'command-session-delete lifecycle')
}
/* jscpd:ignore-end */
