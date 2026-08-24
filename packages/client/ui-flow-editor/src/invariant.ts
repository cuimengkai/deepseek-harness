/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-flow-editor`.
 * @module @deepseek-ai/dsh-client-ui-flow-editor/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-flow-editor'

/** Cordis companion plugin name. */
export const name = 'client-ui-flow-editor-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure component provider — it emits no cordis events,
 * owns no cross-plugin state, and its empty `apply` mounts nothing. The canvas
 * gesture↔surface mapping is asserted by this package's own rf-map and
 * editor-dom specs, and the vendored React Flow base stylesheet's
 * touch-action by the styles spec.
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
