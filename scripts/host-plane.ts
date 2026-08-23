/**
 * Activates the host-plane `ctx.sessions` face in the host aggregate program.
 * `tsconfig.host.json` includes every `scripts/**&#47;*.ts`, so this module is part of
 * the host typecheck; `tsconfig.client.json` lists only specific script files
 * and never reaches it. The host face therefore stays a compile-time fact of
 * host programs (package src via explicit `@deepseek-ai/dsh-session/context`
 * imports, tests/examples/scripts via this ambient) while client programs see
 * only `@deepseek-ai/dsh-client-runtime`'s `ISessions`. Keep both sides aligned
 * when a new Context key is plane-split.
 */
import type {} from '@deepseek-ai/dsh-session/context'
