# @deepseek-ai/dsh-session-deletion

English | [中文](README.zh.md)

Cascade physical session deletion with a durable deletion ledger. `ctx.sessionDeletion.deleteSession(id)` removes a session's durable log together with its whole subagent descendant tree, refuses while any member is live, and records each deletion in a ledger domain.

## Why deletion exists

Session persistence is event-sourced and append-only: a durable log is never rewritten, so sessions accumulate forever and no official cleanup path exists. Deletion is the explicit, user-initiated exception that physically removes a session's log. It deletes the **whole subagent tree** because a subagent session's resumability depends on its lineage, and a physical delete of a parent with an orphaned live child would leave an unresumable session. Because a child's continuation state is self-contained (it folds only its own suffix), removing the whole tree preserves the "model-visible ⟺ logged" reconstructability invariant — nothing that reaches a model request becomes unreconstructable.

## Contract

- `deleteSession(id, options?)` returns `{ deleted, notFound }` — the scope members whose durable logs were removed (root first) and the members that had no durable artifact.
- **Live refusal**: if ANY scope member is live (`ctx.sessions.get(member)` resolves), the whole operation throws `SessionDeletionError` (`code: 'live'`) and nothing is removed. Live sessions re-materialize their log on the next flush, so a delete under them would be immediately undone.
- **Cascade scope**: the root plus every header with `origin: 'subagent'` whose `parentSession` chain reaches it, in breadth-first pre-order (cycle-safe, sweeps already-orphaned children). Computed once from the merged live + persisted header corpus.
- **Ledger**: when at least one member was deleted, a `DeletionRecord` is written to the `session_deletion` domain, keyed by the root id. The ledger is diagnostic — it answers "was this id deleted, and when", not "what happened to every session".
- **Consumer cleanup**: after a successful delete, the optional `sessionProjectionCache.evict(id)` and `workspaceRegistry.forgetSession(id)` run per deleted member, so no stale projection row or workspace `sessionIds` membership survives. Absent consumers (no mount) are skipped.

## Composition

The producer injects `storageDomain`, `sessions`, and `sessionPersistence`. Mount one storage-domain backend (the web-app bundle's json backend lands the ledger at `$DSH_HOME/storages/session_deletion.json`):

```yaml
- id: storage-domain
  name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json

- id: session-deletion
  name: '@deepseek-ai/dsh-session-deletion'
```

Pair it with [`@deepseek-ai/dsh-command-session-delete`](../command-session-delete/README.md) for the `/session-delete` slash command, or expose `session.delete` through the host API proxy.

## Error model

| Error | Condition |
|---|---|
| `SessionDeletionError` (`code: 'live'`) | A scope member is live; the whole operation refused. |

Absence is not an error: an unknown root id returns `{ deleted: [], notFound: [id] }` and writes no ledger record.

## Known Limitations and Deferred Work

- **The ledger is per-id, not per-history** — a recreated session id's later deletion overwrites its earlier record, so the ledger keeps the latest deletion per id rather than the full deletion history.
- **Consumer cleanup runs only at delete time** — a projection cache or workspace registry not mounted when the delete executes keeps its per-session state; deletion cannot reach back and clean it later.
