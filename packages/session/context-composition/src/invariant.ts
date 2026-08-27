/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-context-composition`.
 * @module @deepseek-ai/dsh-context-composition/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-context-composition'

/** Cordis companion plugin name. */
export const name = 'context-composition-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the read is a pure fold over the durable log and owns
 * no events or mutable state. Its pricing correctness — equality with the
 * token-meter's figures — is a pure-function property proven by unit tests.
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
