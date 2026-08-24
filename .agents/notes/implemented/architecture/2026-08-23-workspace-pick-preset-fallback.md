# Agent Note: Workspace-pick fallback for unservable presets

Status: implemented

English | [中文](2026-08-23-workspace-pick-preset-fallback.zh.md)

## Problem

A workspace pick can name an agent preset (the hero chip stages one before the connect). When that preset could not resolve or mount, the host's fresh-create arm threw `UnknownPresetError` or `PresetMountError`, the whole `session.create` failed, and the pick rolled back with an error. A preset that merely went stale — deleted, or damaged so it cannot mount — turned a routine workspace switch into a hard failure.

Separately, the client's `pendingAgentPreset` (set on every stage) was cleared only by `takePendingAgentPreset` inside a connect. A stage that settled WITHOUT a connect — dropped as unservable because the session already started or already runs it, or rejected by the host — left the pending preset in place, and a later unrelated connect silently carried it onto a session the user never picked it for.

## Decision

Two scoped changes make the pick resilient on preset problems without weakening the identity rules.

1. **The fresh-create arm falls back to the deployment default.** `ensureSession`'s `createFreshAgent` tries the requested preset, and on `UnknownPresetError` (from resolve) or `PresetMountError` (from setup's mount) retries with `undefined` — the deployment default. Only the fresh arm uses this fallback: the create rolled back cleanly (a setup rejection publishes neither id), so a same-sessionId retry is safe. Adoption and resume keep strict refusal — they compose the preset the session already runs, and a bad stored composition keeps refusing loud so its owner can repair it. The memoized `sessionCreations` now resolves to `{ agent, effectiveRequest }`, and the final `assertPresetUnchanged` gate compares the yielded agent against the effective request — what the create ACTUALLY honored — so a fallback result (agent on the default) is not rejected as a requested-preset mismatch.

2. **A settled stage clears the workspace pending.** The workspaces service gains `clearPendingAgentPreset()`, and the seat reports stage settlement through a new `onStageSettled` callback fired when a stage is applied, consumed by a session that already runs it, or rejected. The workspace pending is cleared at each, so a stale staged preset never rides a later unrelated connect. A stage made against a session that already started is kept, not settled — a develop pick that precedes an import must reach the next connect ([develop-pick-survives-started-session](../bug-fix/2026-08-24-develop-pick-survives-started-session.md)).

## Alternatives considered

- **Fall back on resolve only, not mount** — the initial fix covered `UnknownPresetError` but not `PresetMountError`, which surfaces from setup's `presets.mount` during `ctx.agents.create`. Wrapping the WHOLE create in the fallback closes both, and the rollback makes the retry safe.
- **Let the final gate keep comparing against the requested preset** — the fallback legitimately yields an agent on the deployment default, so that gate would reject the fallback result as a conflict. Threading the effective request through the memoized creation (per creation, not per invocation) is the correction.
- **Consume the pending on rejection instead of clearing explicitly** — the seat cannot tell a "connect consumed it" from a "connect failed"; the settle-point `clearPendingAgentPreset` is owned by the seat, which knows when a stage is spent.

## Consequences

- A workspace pick that named a bad preset still opens the workspace, on the default composition.
- Adoption and resume keep their strict preset identity: stored-preset-wins and `agent-preset-conflict` are unchanged.
- The `workspaceError` alert in the conversation hero now fires only for genuine failures (cwd conflict, busy subagent, host internal) — preset problems no longer reach it.
- A stage that settles is dropped everywhere, so a later connect starts from the deployment default; a stage still waiting on a started session survives for the connect that consumes it.
