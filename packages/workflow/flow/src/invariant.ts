/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-flow`.
 * @module @deepseek-ai/dsh-flow/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-flow'

/** Cordis companion plugin name. */
export const name = 'flow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the flow engine is a pure derivation over the
 * `workflow/*` event stream, whose pairing integrity (start/agent/end) is
 * owned by `@deepseek-ai/dsh-workflow/invariant`; the flow-side node-status
 * and outcome-coherence derivation has no second same-process relation to
 * assert — graph validity and compilation are proven by the validation and
 * compile tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the flow invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
