# Agent Note: Read freshness is judged by a stat-only signature; the content fingerprint is scan-time only

Status: implemented

English | [中文](2026-08-24-read-freshness-stat-signature.zh.md)

## Problem

`readDocument` answered fresh vs stale by recomputing the content fingerprint on every read: a bounded walk plus a bounded content read of every walked file (sha256 over sorted `(relativePath, size, content)` triples). The workbench polls `projectInsight.read` every 2000 ms and on every tab switch, so each poll re-read the bytes of up to `MAX_FINGERPRINT_FILES` (5000) files. The perceived "scan on every switch" was exactly this read-path cost — the auto-scan itself was already debounced per root and single-flight.

## Decision

Split the tree identity in two, and move the cheap one onto the read path.

- `statProject` (walk.ts) walks the same bounded set but hashes only the stat projection — sorted `rel\0size\0mtimeMs` lines, no content reads — into a `{ maxMtime, count, signature }` result. `mtimeMs` rides free beside `size` from the same `stat` the walk already performs.
- `readDocument` compares the stored `statSignature` against the freshly computed stat signature; equal → fresh, otherwise stale. A document committed before `statSignature` existed has none, so it reads stale and is re-scanned once.
- The content fingerprint stays, but only at scan time: `scanProject` computes and stores both `contentFingerprint` and `statSignature`, and the fresh-no-op (unchanged-skip) dedup now rides the cheap stat signature.
- `projectContentFingerprint` is removed from the package surface — its only production caller was `readDocument`; the content identity is reachable through `fingerprintOf` inside the scanner and through `doc.contentFingerprint`.
- The wire mirrors: the host apiproxy `projectInsightDocSchema` gains `statSignature`, and the three `ProjectInsightDoc` fixtures (apiproxy spec, ui-project-insight store spec, connection fixture) gain the field.

## Alternatives considered

- **Keep the content fingerprint on the read path** — rejected: reading content is the cost being removed; the bounded walk alone (stats, no byte reads) is the cheap invariant.
- **Judge staleness by `maxMtime` alone** — rejected: one mtime cannot detect the addition or removal of a file whose mtime is older than the tree's max, so a per-file signature is required.

## Consequences

- A `read` (poll or tab switch) walks the tree but never reads file bytes; the content fingerprint is recomputed only when a scan runs.
- A same-size, same-mtime content edit reads fresh until the next scan — the stat signature is blind to it. The content fingerprint recomputed at scan time is the backstop, and the limitation is recorded in the package README.
- `statProject` returns `maxMtime` and `count` as identity metadata; no current consumer compares them, they exist for diagnostics and regression tests.
