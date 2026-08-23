/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-router`.
 * @module @deepseek-ai/dsh-client-ui-router/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-router'

/** Cordis companion plugin name. */
export const name = 'client-ui-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the router is a browser-history wrapper whose
 * URL↔page-route consistency (the one relationship it owns) is asserted
 * directly by this package's router and apply specs, not by a Cordis runtime
 * relationship.
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
