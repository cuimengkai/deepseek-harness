/** Package-owned invariant companion for the engine-isolation package. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-engine-isolation'

/** Cordis companion plugin name. */
export const name = 'engine-isolation-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']

/** No runtime invariant: platform-shell owns the isolation record's durability. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
