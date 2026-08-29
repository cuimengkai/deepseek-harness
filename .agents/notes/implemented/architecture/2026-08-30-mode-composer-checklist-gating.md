# Agent Note: Live Checklist and Publish gating in ModeComposer

Status: implemented

English | [中文](2026-08-30-mode-composer-checklist-gating.zh.md)

## Problem

[ModeComposer](../../../../packages/client/ui-agent-mode/src/client/ModeComposer.tsx) only ran `validateFlow` inside `saveFlow`, so a broken draft graph surfaced its structural errors as a save-time throw. Dify's Checklist panel shows findings continuously while editing and blocks Publish until they clear; this repo's `validateFlow` ([packages/workflow/flow/src/validate.ts](../../../../packages/workflow/flow/src/validate.ts)) already computes the same findings but had no read-only, non-persisting entry point for the client to poll.

## Decision

1. **`AgentModes.validate` Remote method** ([packages/preset/agent-modes/src/index.ts](../../../../packages/preset/agent-modes/src/index.ts)) wraps `validateFlow` and returns `{ errors: readonly string[] }` for an unsaved graph; it never writes, so a draft that fails validation can be checked freely without blocking edits.
2. **`section-store` debounces the check.** `ComposeDraft.checklist` holds the latest findings (`undefined` until the first check resolves). `patchGraph` calls `scheduleChecklist()`, which clears and resets a 400 ms timer before calling `refreshChecklist()`; `beginCompose` triggers an immediate check on open, and `closeCompose` clears the pending timer. A monotonic `checklistGeneration` counter discards a response superseded by a later edit, so a slow validate call for the previous graph never overwrites newer findings.
3. **ModeComposer surfaces a Checklist button and panel** next to Publish, with an error-count badge; the panel lists every finding or an "issues found: none" state while a check is pending. **Publish is disabled whenever `checklist` has one or more entries**, with a `title` attribute stating the reason.

## Alternatives considered

- **Validate on every keystroke with no debounce** — rejected: `validateFlow` walks the whole graph, and section-store already serializes graph mutations through `patchGraph`; a per-keystroke round trip would flood the Remote channel during rapid drag or type bursts.
- **Client-side-only validation (`validateFlow` runs in the browser, no Remote call)** — `validateFlow` is a pure, dependency-free function and could run in the browser bundle directly. Kept the round trip through `AgentModes.validate` instead, matching every other `agentModes` read/write path (list/read/saveFlow/tryRun) so the client has one remote-face shape to mock in tests and one place (`agent-modes`) that owns flow-graph business rules; the added latency is one Remote hop debounced at 400 ms, not per keystroke.

## Consequences

- The Checklist reflects only structural findings `validateFlow` already computes (dangling edges, missing start/end, branch-exclusivity violations, empty prompts); it gained no new validation rules.
- Publish gating is client-enforced only; `saveFlow`'s own `validateFlow` call on the Host remains the authoritative gate against direct Remote calls that skip the UI.
- `modelKinds` request routing and join-after-parallel fan-out remain deferred ([engine followups](../../proposed/architecture/2026-08-29-mode-orchestration-engine-followups.md)); the Checklist reports today's exclusivity-violation errors as-is until A3 changes what counts as valid.

## Testing

Keyless: `packages/preset/agent-modes/tests/service.spec.ts` (the new `validate` Remote method against a valid and a broken graph), `packages/client/ui-agent-mode/tests/section-store.client.spec.ts` (immediate check on open, debounced re-check, the stale-generation guard, and the timer teardown on close). `ModeComposer.tsx`'s own render path — the Checklist button/panel and the disabled Publish button — has no direct unit test yet; `apps/web/tests/orchestration-studio.e2e.ts` exercises the composer's Settings/Last Run chrome but does not assert Checklist/Publish specifically.
