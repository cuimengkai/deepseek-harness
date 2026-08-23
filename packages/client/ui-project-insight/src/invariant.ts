/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-project-insight`.
 * @module @deepseek-ai/dsh-client-ui-project-insight/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-project-insight'

/** Cordis companion plugin name. */
export const name = 'client-ui-project-insight-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-consumer plugin — it emits no cordis events and
 * owns no cross-plugin state. Its view-slot registrations are plain effects
 * whose disposal the slot ledger's own specs observe; the modes-visibility
 * projection is asserted by ui-conversation's view-filter behavior specs, and
 * the poll-until-fresh state machine by this package's store tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
