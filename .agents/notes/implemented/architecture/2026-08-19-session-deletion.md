# Agent Note: Cascade physical session deletion with a durable deletion ledger

Status: implemented

English | [中文](2026-08-19-session-deletion.zh.md)

The delete operation's live-refusal contract is superseded by [stop-then-delete](2026-08-23-stop-then-delete-session-deletion.md).

## Problem

Session persistence is event-sourced and append-only: a durable log is never rewritten, so sessions and disk usage accumulate without bound and there is no official cleanup path. `SessionPersistence` had no delete operation; the only "removal" was manual file deletion, which the search index already reconciles (`persistentDeletes`) but nothing triggered officially.

## Decision

Add a physical-delete capability split across three layers.

1. **The persistence seam** (`SessionPersistence.delete(id)`): removes exactly one session's durable log, returns whether an artifact existed, and refuses while that id is live (`LiveSessionError`). The coordinator waits out a retiring tail, serializes onto the per-id chain, refuses a live owner and an in-flight resume preparation, invalidates the prepared view, then calls a new `PersistenceBackend.deleteStored` hook. JSONL removes the whole session directory (never just the transcript); SQLite runs one `DELETE FROM sessions` relying on the declared `ON DELETE CASCADE`. A deleted id behaves as never-created: `load` reports not found, `list` omits it, and a later `create` may reuse it with a fresh lifecycle.

2. **A cascade-deletion service** (`@deepseek-ai/dsh-session-deletion`): the user-facing orchestrator. `deleteSession(id)` computes the transitive subagent closure from the merged live + persisted header corpus, refuses the WHOLE operation if any member is live (so no partial tree is left orphaned), deletes members root-first, and writes a durable ledger record. Consumers (projection cache, workspace registry) clean their per-session state through optional `evict`/`forgetSession` calls.

3. **User surfaces**: a `/session-delete` slash command and a `session.delete` host RPC, both mapping `LiveSessionError` to a stable human/wire outcome.

Deletion is an explicit user-initiated exception to append-only, not a retention policy: store-level wipe/retention is deferred to the container deployment phase.

## Alternatives considered

- **Soft delete / tombstone**: preserves audit and undo but does not free disk, which defeats the motivation. The chosen design records a small durable ledger entry instead of retaining content, so accountability survives a physical delete at negligible cost.
- **Cascade inside the seam**: `SessionPersistence` stays single-concern (one session per delete); lineage is a Consumer concern, so the closure lives in the deletion service, not the backend.
- **Reusing `ctx.subagents.listDescendants` for the closure**: it requires the projection registry and folds every candidate, which a delete does not need and which a corrupt child log would block. A lightweight header walk mirrors its lineage rule instead.
- **Ledger keyed by record id (append history)**: a recreated id's earlier deletion would accumulate; keying by root id overwrites, answering "was this id deleted" without unbounded growth.
- **An event (`session/deleted`) for consumer cleanup**: direct optional calls keep the dependency direction "new feature depends on existing infra", which is cheaper than existing infra depending on the new event type.

## Consequences

- The seam's `delete` is backend-agnostic and the coordinator handles all race states; both backends and all test fakes implement `deleteStored`.
- The cascade rule mirrors the subagent lineage (`origin === 'subagent'` + `parentSession`), so a full-tree delete never orphans a live child and never breaks the "model-visible ⟺ logged" reconstructability invariant (a child's continuation is self-contained).
- `session-query` needs no change: its `persistentDeletes` path already reconciles a vanished session on the next query.
- Physical delete is unrecoverable; the ledger is the only trace, and the surface requires an explicit id (no current-session default).
