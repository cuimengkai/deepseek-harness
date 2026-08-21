// Scripted approval answerer for the platform-agent-demo keyless prototype.
//
// The demo proves the T6 approval seam without a human: a real deployment
// answers `approval/request` through a UI answerer, but this plugin stands in
// for it deterministically. It approves exactly the sandbox-escalation the
// mock dev agent issues (a strictly-wider `danger-full-access` retry of a
// sandbox-denied write), delegating everything else to the next answerer so
// the fail-closed `unavailable` default stays intact.

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

export const name = 'platform-demo-mock-approval'

/** The one escalation the mock chain issues: a wider retry of a denied write. */
const ESCALATION_REASON = 'escalate sandbox to danger-full-access'

export function apply(ctx: Context): void {
  ctx.on('approval/request', (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
    // The mock dev agent escalates its denied out-of-workspace write; the
    // scripted answerer approves exactly that, delegating every other ask so
    // the composed chain keeps its fail-closed default.
    if (req.reason !== undefined && req.reason.includes(ESCALATION_REASON)) {
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    }
    return next()
  })
}
