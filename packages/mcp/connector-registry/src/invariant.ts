/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-connector-registry`.
 * @module @deepseek-ai/dsh-connector-registry/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-connector-registry'

/** Cordis companion plugin name. */
export const name = 'connector-registry-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry is a file-backed CRUD store; mcp-client
 * owns the live tool registrations, and persist refuses a bad document.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
