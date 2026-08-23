# Agent Note: Stop-then-delete for session deletion

Status: implemented

English | [中文](2026-08-23-stop-then-delete-session-deletion.zh.md)

## Problem

The cascade-deletion service from [the original session-deletion note](2026-08-19-session-deletion.md) refuses the whole operation while any scope member is live. In the web app, sessions stay live forever: the host's `ensureSession` discards the returned agent handle, so every used session keeps its live `Session` and `Agent` registered. Deleting such a session always hit the refusal, and the client swallowed the refusal with a console note, so the Delete action appeared to do nothing.

## Decision

`deleteSession` now disposes live scope members before removing durable logs (stop-then-delete), and refuses only when a member remains live after disposal. The change lands across four seams.

1. **The factory seam learns disposal.** `AgentFactory` gains a required `disposeAgent(id): Promise<boolean>`; `AgentLoop` implements it by tracking each created agent's teardown in a `byId` map and awaiting it, and `AgentRegistry.disposeAgent` delegates defensively (`?.` so a factory compiled against the older interface still reports false). The agent-loop's composite teardown already ends by detaching the session, so a successful disposal removes the session from `ctx.sessions`.
2. **Session disposal as the inverse of `enter`.** `SessionStore.dispose(session)` detaches a live entry, emitting `session/disposed` so the persistence coordinator retires and final-flushes before the delete runs.
3. **Dispose-then-delete in `deleteSession`.** For each live scope member: `agents.disposeAgent(member)` when the agent service is mounted, then re-fetch and `sessions.dispose` any still-live session (the pre-dispose liveness check is stale by then). A dispose rejection is logged, not fatal — the agent teardown already detaches the session in its `finally`, so the liveness re-check decides. If any member is still live after the loop, the whole operation refuses (`SessionDeletionError`, code `live`) and deletes nothing.
4. **The client surfaces refusal.** `WorkspaceBrowser` renders a session-delete failure as an alert instead of a silent console note.

Why this shape: the refusal existed because a live session re-materializes its log on the next flush, so deleting under it would be immediately undone. Disposing first makes the delete coincide with the last flush — the persistence coordinator's `waitForRetirement` already serializes flush-before-delete, so no new ordering barrier exists. The remaining refusal is a defensive backstop for a member that cannot be disposed (for example a foreign live session with no agent factory).

## Alternatives considered

- **Fix the host to dispose agents on use** — closes the leak but does not cover sessions already live at delete time, and couples the host's session lifecycle to the deletion feature; a general dispose seam on the factory is useful to other consumers regardless.
- **Require the caller to dispose first** — pushes teardown knowledge onto every deletion surface; the service owns the loop, so it should own the ordering.
- **Delete despite the live guard** — impossible without weakening `LiveSessionError`, which exists to stop a delete from being undone by the next flush.

## Consequences

- Deleting a used session works end to end: the agent drains (cancel → idle → scope disposal → session detach), the coordinator retires and final-flushes, then the durable log is removed.
- The agent-loop's `disposeAgent` is safe for concurrent callers: the composite dispose is memoized, so two simultaneous disposals share one drain and both observe success.
- A delete can still refuse when a scope member is live but not agent-owned (no factory mounted, or the factory reports false) — that refusal is now an alert in the UI, not a silent no-op.
