/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-project-bundle`.
 * @module @deepseek-ai/dsh-project-bundle/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-project-bundle'

/** Cordis companion plugin name. */
export const name = 'project-bundle-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry is a file-backed CRUD store; persist
 * refuses a bad document, and connector enable is a best-effort call into
 * `ctx.connectors`.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
