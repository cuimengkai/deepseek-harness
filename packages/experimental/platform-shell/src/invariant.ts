/**
 * Platform-shell package invariant: every committed lineage-bridge reference
 * event names a business object the control-plane store actually holds
 * (platform-lineage-bridge §5). Asset events must reference an existing asset;
 * an approval transition event must name the state the ticket committed to.
 * The check is store-backed because reference events span sessions (the dev
 * session reads the product session's asset), so a per-session fold cannot see
 * the referenced object.
 * @module @deepseek-ai/dsh-experimental-platform-shell/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-platform-shell'

/** One committed lineage-bridge reference event this package owns. */
type PlatformReferenceEvent =
  | SessionEvent<'asset/read'>
  | SessionEvent<'asset/register'>
  | SessionEvent<'platform/approval/transition'>

/** Whether one session event is a platform reference event. */
export function isPlatformReferenceEvent(event: SessionEvent): event is PlatformReferenceEvent {
  return event.type === 'asset/read'
    || event.type === 'asset/register'
    || event.type === 'platform/approval/transition'
}

/**
 * Validate one committed reference event against the control-plane store.
 * @param ctx - context carrying the active platformShell service.
 * @param event - the reference event to validate.
 * @throws Error describing the violated construction guarantee.
 */
export function validateReferenceEvent(ctx: Context, event: PlatformReferenceEvent): void {
  if (event.type === 'asset/read' || event.type === 'asset/register') {
    if (!ctx.platformShell.assetExists(event.data.assetId)) {
      throw new Error(
        `${event.type} references ${event.data.assetId}, which the platform store does not hold`,
      )
    }
    return
  }
  const committed = ctx.platformShell.ticketStatus(event.data.ticketId)
  if (committed !== event.data.to) {
    throw new Error(
      `platform/approval/transition claims ${event.data.ticketId} reached ${event.data.to}, but the store reports ${String(committed)}`,
    )
  }
}

/** Validate every already-committed reference event of one session. */
function seedSession(ctx: Context, session: Session): void {
  for (const event of session.events) {
    if (isPlatformReferenceEvent(event)) validateReferenceEvent(ctx, event)
  }
}

/** Install the platform-shell reference checks on a child context. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) seedSession(ctx, session)

  ctx.on('session/created', (session) => {
    seedSession(ctx, session)
  }, { global: true })

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (!isPlatformReferenceEvent(event)) return
    try {
      validateReferenceEvent(ctx, event)
    } catch (error: unknown) {
      /* v8 ignore next -- validateReferenceEvent throws Error instances. */
      const message = error instanceof Error ? error.message : String(error)
      fail(`session ${session.id} event ${event.seq} violates the lineage bridge: ${message}`)
    }
  }, { global: true })
}, { inject: ['sessions', 'platformShell'] })

/** Cordis companion plugin name. */
export const name = 'platform-shell-invariant'
/** Invariant registry required by the companion. */
export const inject = ['invariants']

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
