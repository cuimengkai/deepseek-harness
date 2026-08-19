/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-deletion`.
 * @module @deepseek-ai/dsh-session-deletion/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-deletion'

/** Cordis companion plugin name. */
export const name = 'session-deletion-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: deletion is an explicit user-initiated destructive
 * operation whose only owner state is the ledger, and the ledger write is the
 * commit point of the same operation that removes the durable logs. The
 * persistence seam's own `listSnapshots` reconciliation is what downstream
 * consumers (search index, projections, workspace) converge on; the
 * cascade-scope relation is a pure function covered directly by tests.
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
