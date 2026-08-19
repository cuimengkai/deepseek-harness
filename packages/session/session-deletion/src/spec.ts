/**
 * The session-deletion ledger domain: one `deletions` table keyed by the root
 * session id of each delete operation, recording the intended scope and the
 * durable result. The spec is the single source of the domain's identity,
 * version, and record schema; the storage-domain routing decides the medium
 * (the shipped composition's json backend lands it at
 * `<root>/session_deletion.json`, beside `workspace.json`).
 * @module @deepseek-ai/dsh-session-deletion/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * One deletion operation's durable record. Keyed by the root session id, so
 * re-deleting a recreated id overwrites the previous record — the ledger
 * answers "was this id deleted, and when", not "how many times".
 */
export const deletionRecord = z.object({
  /** The root session id this record is keyed by. */
  id: z.string(),
  /** Epoch-ms timestamp of the delete operation. */
  deletedAt: z.number().int().nonnegative(),
  /** The full intended cascade scope, root first (including absent members). */
  scope: z.array(z.string()).min(1),
  /** The scope members whose durable logs were actually removed. */
  deleted: z.array(z.string()).min(1),
  /** The scope members that had no durable artifact (absent). */
  notFound: z.array(z.string()),
  /** Optional human-readable reason supplied by the caller. */
  reason: z.string().optional(),
})

/** One durable deletion record, inferred from {@link deletionRecord}. */
export type DeletionRecord = z.infer<typeof deletionRecord>

/**
 * The session-deletion ledger domain. Version bumps discard the whole medium —
 * a deletion ledger is diagnostic, never load-bearing, so a stale record costs
 * a wrong "was it deleted" answer, not a wrong value.
 */
export const sessionDeletionDomainSpec = defineDomain({
  name: 'session_deletion',
  version: 1,
  tables: { deletions: domainTable<SessionId, DeletionRecord>(deletionRecord) },
})
