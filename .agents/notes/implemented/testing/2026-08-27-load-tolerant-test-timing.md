# Agent Note: Calibrate load-sensitive test timing to causality, not wall-clock luck

Status: implemented

English | [中文](2026-08-27-load-tolerant-test-timing.zh.md)

## Problem

Multi-process suites passed on an idle laptop and failed when the host was saturated — during full local runs, Windows coverage concurrency, or deliberate CPU storms. Four distinct failure modes hid behind "flaky timeouts": per-test budgets calibrated only to unloaded spawn latency; fixed sleeps that assumed a child would finish a protocol step within the sleep; production batching windows that a loaded host's child startup could outlast; and one failure that was not a timeout at all — a fixed `setTimeout(300)` abort in the LSP cancel-grace test landed while the initialize handshake was still pending, and aborting a pending handshake tears the instance down by design, so `dead` became `true` in 329ms.

## Decision

Multi-process suites carry per-suite budgets sized to their worst legitimate runtime: Git-fixture and tsx-driver suites use 20-30s, the lefthook installer's multi-worktree cases 60s, and the persistent-bash loader composition mirrors its pwsh twin's 8s terminal / 20s tool deadlines. Pure unit tests keep the 5s default so genuine hangs still surface quickly.

Synchronization where test phases depend on child progress observes causality instead of elapsed time. The LSP cancel-grace server writes a marker file when the definition request arrives, and the test polls the marker before aborting, so the request is provably in flight and the abort can never land inside the handshake window.

Test-scoped plugin config widens windows that production defaults size for throughput, not for assertions. The tool-bash lazy-materialization test sets `writeBatchMaxDelayMs: 60_000` so the JSONL live-event coalescing window (200ms by default) cannot materialize the file before the bash child answers under load; `sessions.flush` after the turn remains the durability barrier the test asserts, which is the contract it always meant to pin. The same test raises its LSP `killGraceMs` override to 10s so a saturated host's child-response latency stays inside the grace the case exercises.

## Alternatives considered

**Raise the global vitest testTimeout.** Uniformly generous budgets would hide real deadlocks in fast unit suites; per-suite budgets keep quick-fail semantics where they matter and generous ones only where child processes set the floor.

**Keep the fixed sleeps and only raise the surrounding timeouts.** The LSP failure completed in 329ms — no budget increase fixes a phase inversion. Only causality-ordered synchronization (marker + poll) makes the phase deterministic.

**Change production defaults (`DEFAULT_WRITE_BATCH_MAX_DELAY_MS`, LSP kill grace).** The defaults are correct for deployment throughput and teardown pacing; the defect was test calibration, not product behavior. Production values stay fixed.

**Skip or quarantine the flaky cases.** The failures were calibration defects with real coverage value; skipping would trade coverage for silence.

## Consequences

The nine affected files pass both idle and under a deliberate 8-CPU-burner storm (131 passed, 2 skipped, 0 failed), and genuine regressions in those suites still fail through their behavior assertions rather than through timing. Two costs are accepted: a real deadlock in the multi-process suites now takes up to its per-suite budget to surface, and the tool-bash test's widened coalescing window means an actual regression in flush-as-barrier semantics would be caught by the explicit `sessions.flush` assertion rather than by incidental elapsed-time materialization — which is the stronger contract anyway.
