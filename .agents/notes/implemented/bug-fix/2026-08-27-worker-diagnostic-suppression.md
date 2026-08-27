# Agent Note: Worker diagnostics stay out of the captured log ledger

Status: implemented

English | [中文](2026-08-27-worker-diagnostic-suppression.zh.md)

## Problem

`WorkerThreadCodeRuntime` spawns one worker per run whose entry (`src/worker.ts`, unbuilt) loads through Node's native type stripping. On Node versions where that feature is still experimental — v24.0.0, inside the repo's supported `>=24` range — every fresh worker prints `(node) ExperimentalWarning: Type Stripping is an experimental feature` to its stderr. The runtime's backstop pipe capture treats native stderr writes as stray logs and appends them to the model-run log ledger, so on those versions every run carried ~150 bytes of Node's own diagnostic that the program never wrote. Eighteen runtime specs asserting exact log contents failed, and the spill-policy backpressure test deadlocked: its 100-byte inline budget turned the warning itself into a spill against the hung backend, so the lane never reached the dispatch the test gates on.

## Decision

The worker spawn passes `execArgv: ['--disable-warning=ExperimentalWarning']` (previously `[]`). The ledger's contract is that it contains the program's output, not host-process diagnostics, and that contract must hold on every Node version the engines range allows; the flag removes the warning at its source while keeping the spawn hermetic — nothing is inherited from the host runner's execArgv. The workflow worker is unaffected: it loads through tsx transforms, not native type stripping.

## Alternatives considered

- **Filter the warning text out of the stray-stderr capture** — the capture would have to parse Node's diagnostic format, which is not a stable interface; a wording change silently reintroduces the pollution.
- **Treat v24.0.0 as unsupported** — the engines range deliberately allows it, and the warning is a property of the runtime, not of the model code the ledger exists to record.

## Consequences

- Worker log capture is deterministic across the supported Node range; runs on v24.0.0 no longer carry the diagnostic.
- Other experimental-feature warnings from Node internals inside the worker are silenced too — acceptable, because the worker is hermetic by design: model code gets no ambient channel, and no test or consumer reads Node diagnostics off the worker pipes.
- The execArgv no longer being literally empty is visible in the spawn comment; the hermeticity rule it documents (no host loader hooks) still holds.
