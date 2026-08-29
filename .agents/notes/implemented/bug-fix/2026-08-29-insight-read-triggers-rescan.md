# A stale or absent insight read schedules the debounced rescan

**Date:** 2026-08-29
**Kind:** bug-fix
**Area:** insight

## Symptom

A develop-mode session restored from the log after a host restart showed the
project-insight banner「项目已变化,正在重新扫描…」forever. The browser tab polls
`projectInsight.read` every 2 s while the document is `none`/`stale`, but no scan
ever committed: the committed `.dsh/insight/` document stayed at its old
`scannedAt` until a manual scan rewrote it.

## Root cause

The auto-scan trigger was events-only: `session/created` (session publication)
and a fresh `agent-preset/selected` append. A session restored from the log is
re-entered through `sessions.enter` without `announce`, so after a host restart
it fires neither event. The web client keeps the old session (its preset comes
from the replayed log), the tab polls a stale document, and nothing on the host
ever schedules the rebuild. The pre-merge design codified this in
`service.spec.ts` as "a read never schedules a re-scan" — deliberate while every
live session reliably produced a trigger event, but stranded after the merged
restore path arrived.

## Fix

`ProjectInsight.read` now schedules the debounced, single-flight background scan
when it observes an absent (`none`) or stale document — the same `scheduleScan`
path the `ProjectInsightVersionError` branch already used. The polling reader
converges on a fresh document within one scan of the restart, and repeated
polls cannot stampede (per-root debounce plus in-flight single-flight). A read
that observes no waiting session commits silently: `announce` notifies only
sessions in the waiting set, so `project-insight/updated` stays session-driven
and no session event is logged (model-visible inputs are unchanged — no
snapshot impact).

## Alternatives rejected

- Announcing restored sessions in `agent-loop` (`enter` → `announce`) would
  change loop semantics and require docs/architecture.md updates for a gap one
  service can heal locally.
- A client-side scan RPC would widen the Remote surface the polling tab does
  not need.

## Verification

- `packages/insight/project-insight/tests/service.spec.ts` replaced the
  "read never schedules" test with two: a stale read heals to `fresh` without
  any session event, and a `none` read scans a never-scanned project.
- Live probe against the running web host: `agentPresets/list` returns the
  five-preset roster; a manual scan of the harness repo itself commits and
  reads `fresh`.
