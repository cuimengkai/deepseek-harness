/**
 * Human-facing `/compact` command over the backend-independent compaction seam.
 * @module @deepseek-ai/dsh-command-compact
 */

import type { Context } from '@deepseek-ai/cordis'
import { ManualCompactionError, type CompactionResult } from '@deepseek-ai/dsh-compaction'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'command-compact'
export const inject = ['commands', 'compaction']

const USAGE = 'Usage: /compact — policy range, or /compact <startSeq>:<endSeq> — explicit surface range'

/** Grammar of the explicit-range argument: two inclusive surface seqs. */
const RANGE_INPUT = /^\s*(\d+)\s*:\s*(\d+)\s*$/u

/** Fail loudly if a locally closed union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never): never {
  throw new TypeError(`unknown manual compaction error code: ${String(value)}`)
}
/* v8 ignore stop */

/** Convert expected capability failures into concise human-only outcomes. */
function expectedFailure(error: ManualCompactionError): CommandResult {
  switch (error.code) {
    case 'busy':
      return {
        kind: 'error',
        text: 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.',
      }
    case 'cancelled':
      return { kind: 'error', text: 'Compaction cancelled.' }
    case 'changed':
      return {
        kind: 'error',
        text: 'The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.',
      }
    case 'summary':
      return {
        kind: 'error',
        text: 'Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.',
      }
    case 'commit':
      return {
        kind: 'error',
        text: 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.',
      }
    case 'persistence':
      return {
        kind: 'error',
        text: 'Compaction finished, but the session could not be saved.',
      }
    /* v8 ignore next 2 -- ManualCompactionErrorCode is closed and every member is handled above */
    default: return assertNever(error.code)
  }
}

/**
 * Render one committed manual compaction outcome.
 * @param result - the committed transaction.
 * @returns the human success text with its summary event anchor.
 */
function successOf(result: CompactionResult): CommandResult {
  return {
    kind: 'success',
    text: `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).`,
    sourceEventSeq: result.summarySeq,
  }
}

/**
 * Execute one manual compaction request: argument-free selects the retention
 * policy's range; `<startSeq>:<endSeq>` compacts exactly that inclusive
 * surface range. Any other argument is a usage error.
 */
async function executeCompact(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const raw = invocation.rawInput.trim()
  const range = RANGE_INPUT.exec(raw)
  if (raw.length > 0 && range === null) {
    return { kind: 'error', text: USAGE }
  }
  try {
    if (range === null) {
      const result = await ctx.compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId)
      if (result === null) return { kind: 'success', text: 'No compactable history yet.' }
      return successOf(result)
    }
    const result = await ctx.compaction.compactRegionNow(
      Number(range[1]),
      Number(range[2]),
      invocation.agent,
      invocation.signal,
      invocation.commandId,
    )
    return successOf(result)
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Compaction cancelled.' }
    if (error instanceof ManualCompactionError) return expectedFailure(error)
    // A rejected range (missing, reversed, or unbalanced edge) is a plain
    // Error whose message already names the violated edge; surface it verbatim.
    if (error instanceof Error && range !== null) return { kind: 'error', text: error.message }
    throw error
  }
}

/**
 * Register `/compact` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the compaction seam.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeCompact(ctx, invocation)
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
      name: 'compact',
      description: 'Compact older conversation history, or an explicit inclusive surface range',
      input: { hint: '[<startSeq>:<endSeq>]' },
      handler,
    })
  }, 'command-compact lifecycle')
}
