/**
 * Cascade session deletion: `ctx.sessionDeletion.deleteSession(id)` removes a
 * session's durable log together with its whole subagent descendant tree.
 * Live scope members are disposed first (stop-then-delete), the delete refuses
 * only when a member remains live after disposal, and each deletion is
 * recorded in a durable ledger domain. Consumers (the projection cache, the
 * workspace registry) clean their per-session state through optional service
 * calls, so the deletion feature depends on them, never the reverse.
 * @module @deepseek-ai/dsh-session-deletion
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session/context'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionProjectionCache } from '@deepseek-ai/dsh-session-projection-cache'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { cascadeScope } from './cascade.ts'
import { sessionDeletionDomainSpec, type DeletionRecord } from './spec.ts'

export { cascadeScope } from './cascade.ts'
export { sessionDeletionDomainSpec, type DeletionRecord } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionDeletion: SessionDeletion
  }
}

/** Options for one delete operation. */
export interface DeleteSessionOptions {
  /** Optional human-readable reason recorded in the deletion ledger. */
  reason?: string
}

/** The outcome of one delete operation over a cascade scope. */
export interface DeleteSessionResult {
  /** Scope members whose durable logs were removed, root first. */
  deleted: SessionId[]
  /** Scope members that had no durable artifact (absent). */
  notFound: SessionId[]
}

/**
 * A delete was refused because part of the target tree is still live after
 * disposal. Live sessions re-materialize their durable log on the next flush,
 * so the whole operation is rejected before anything is removed; the caller
 * must dispose the listed members first.
 */
export class SessionDeletionError extends Error {
  /**
   * @param liveSessions - the scope members currently live, in scope order.
   */
  constructor(readonly code: 'live', readonly liveSessions: readonly SessionId[]) {
    super(`cannot delete ${liveSessions.length > 1 ? 'sessions' : 'session'} while live: ${liveSessions.join(', ')}`)
    this.name = 'SessionDeletionError'
  }
}

/**
 * The cascade-deletion service. Opens the `session_deletion` ledger domain at
 * init; a deployment without storage-domain routing for it cannot mount this
 * plugin (loud misconfiguration, per repo convention).
 */
export class SessionDeletion extends Service {
  static inject = ['storageDomain', 'sessions', 'sessionPersistence']

  private table?: import('@deepseek-ai/dsh-storage-domain').KvTable<SessionId, DeletionRecord>

  constructor(ctx: Context) {
    super(ctx, 'sessionDeletion')
  }

  /** The injected persistence seam; the typed accessor keeps the package augmentation in scope. */
  private get persistence(): SessionPersistence {
    return this.ctx.sessionPersistence
  }

  /** Open the deletion ledger domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sessionDeletionDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'sessionDeletion.domainClose')
    this.table = domain.table('deletions')
  }

  /**
   * Physically delete one session and its entire subagent descendant tree.
   * The scope is computed once from the merged live + persisted header corpus.
   * Live scope members are disposed first — agent-owned sessions through the
   * agent factory (`ctx.agents.disposeAgent`), bare live sessions directly via
   * `ctx.sessions.dispose` — so the persistence coordinator's own live guard
   * passes; if any member remains live after disposal the whole operation
   * refuses ({@link SessionDeletionError}) and nothing is removed. Otherwise
   * each member's durable log is deleted root-first through the persistence
   * seam, the operation is recorded in the ledger (when at least one member
   * existed), and mounted consumers clean their per-session state.
   * @param id - the root session to delete.
   * @param options - optional ledger reason.
   * @returns the removed and absent scope members.
   * @throws {@link SessionDeletionError} when any scope member is still live after disposal.
   */
  async deleteSession(id: SessionId, options: DeleteSessionOptions = {}): Promise<DeleteSessionResult> {
    const headers = await this.headerCorpus()
    const scope = cascadeScope(id, headers)

    // Stop-then-delete: dispose every live scope member before removing durable
    // logs. An agent-owned session drains through the agent factory (its
    // composite teardown ends in detachSession); a bare live session is
    // detached directly. A dispose rejection is logged and left to the
    // liveness re-check below — the agent teardown already detached the session
    // in its `finally`, so the re-check decides instead of the rejection
    // aborting the whole delete.
    const agents = this.ctx.get('agents') as { disposeAgent(id: SessionId): Promise<boolean> } | undefined
    for (const member of scope) {
      if (this.ctx.sessions.get(member) === undefined) continue
      try {
        if (agents !== undefined) await agents.disposeAgent(member)
      } catch (error: unknown) {
        this.ctx.logger.warn(`session "${member}": disposeAgent rejected before delete: ${String(error)}`)
      }
      // Re-fetch: disposeAgent detaches the session when it succeeds, so the
      // pre-dispose liveness check above is stale by the time we get here.
      const stillLive = this.ctx.sessions.get(member)
      if (stillLive !== undefined) await this.ctx.sessions.dispose(stillLive)
    }

    const liveMembers = scope.filter(member => this.ctx.sessions.get(member) !== undefined)
    if (liveMembers.length > 0) {
      throw new SessionDeletionError('live', liveMembers)
    }

    const deleted: SessionId[] = []
    const notFound: SessionId[] = []
    for (const member of scope) {
      if (await this.persistence.delete(member)) deleted.push(member)
      else notFound.push(member)
    }

    if (deleted.length > 0) {
      await this.requireTable().put(id, {
        id,
        deletedAt: Date.now(),
        scope,
        deleted,
        notFound,
        ...options.reason === undefined ? {} : { reason: options.reason },
      })
      await this.forgetConsumers(deleted)
    }

    return { deleted, notFound }
  }

  /**
   * Read the durable deletion ledger, newest first. The ledger is diagnostic:
   * it answers "was this id deleted, and when", not "what happened to every
   * session" — a recreated id's later deletion overwrites its earlier record.
   * @returns one record per delete operation, most recent first.
   */
  listDeletions(): DeletionRecord[] {
    return [...this.requireTable().entries()].map(([, record]) => record).reverse()
  }

  private async headerCorpus(): Promise<SessionHeader[]> {
    const live = this.ctx.sessions.list().map(session => session.header)
    const persisted = await this.persistence.list()
    return [...live, ...persisted]
  }

  private requireTable(): import('@deepseek-ai/dsh-storage-domain').KvTable<SessionId, DeletionRecord> {
    if (this.table === undefined) {
      throw new Error('session deletion ledger is not initialized')
    }
    return this.table
  }

  private async forgetConsumers(deleted: readonly SessionId[]): Promise<void> {
    for (const id of deleted) {
      const cache: SessionProjectionCache | undefined = this.ctx.get('sessionProjectionCache')
      if (cache !== undefined) await cache.evict(id)
      const workspace: WorkspaceRegistry | undefined = this.ctx.get('workspaceRegistry')
      if (workspace !== undefined) await workspace.forgetSession(id)
    }
  }
}

export default SessionDeletion
