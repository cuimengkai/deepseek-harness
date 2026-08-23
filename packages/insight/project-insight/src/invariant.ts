/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-project-insight`.
 * @module @deepseek-ai/dsh-project-insight/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-project-insight'

/** Cordis companion plugin name. */
export const name = 'project-insight-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: scanner determinism is a pure-function property proven
 * by unit tests, and the only event/data relation — emit `project-insight/updated`
 * after the atomic write commits — is enforced structurally at the single emit
 * site rather than re-verified by a listener.
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
