/** The package's node half: an empty host body and an explained empty invariant companion. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as FlowEditorInvariant from '@deepseek-ai/dsh-client-ui-flow-editor/invariant'

describe('invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(FlowEditorInvariant).await()).resolves.toBeDefined()
  })

  it('has an empty node half', async () => {
    const { apply } = await import('@deepseek-ai/dsh-client-ui-flow-editor')

    // The host body exists only so the plugin appears in the host cordis.yml;
    // every behavior this package ships lives in the browser half.
    apply()

    expect(typeof apply).toBe('function')
  })
})
