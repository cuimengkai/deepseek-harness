/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-agent-modes`.
 * @module @deepseek-ai/dsh-agent-modes/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-modes'

/** Cordis companion plugin name. */
export const name = 'agent-modes-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: modes are a discovery/bind roster over files; the
 * session header and projection own durability, and flow validation owns graph
 * well-formedness at save/read time. There is no live mutable registry relation
 * to assert beyond what those owners already enforce.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
