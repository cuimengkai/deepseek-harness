# Agent Note: Manual range compaction (seam verb, /compact range, tab trigger)

Status: implemented

English | [中文](2026-08-27-manual-range-compaction.zh.md)

## Problem

Phase one of the context tab shipped the *sight* of compaction — the surface tree, the compaction-history group, the checkpoint detail — but deliberately deferred the *act*: the tab could not fire a compaction, and `/compact` offered only the retention policy's range. A user who saw "45 tokens of dead weight in rows #2–#9" had no verb that targeted those rows: the argument-free `/compact` would re-run the policy's own selection, and `compactRegion()` is a programmatic seam verb with none of the admission, bracketing, or durability protections a human-initiated compaction requires.

The gap was three-layered: the seam needed a manual range verb, the command needed a range grammar, and the tab needed a range interaction — and each layer had to fail exactly like its argument-free sibling rather than inventing a second error vocabulary.

## Decision

### One new seam verb, `compactNow`'s transaction body

`CompactionEngine.compactRegionNow(start, end, agent, signal, sourceCommandId?)` is the range form of `compactNow`: the caller chooses the range instead of the retention policy. `compaction-basic` implements it as `runManual(agent, signal, (operationSignal) => commitManual(agent, operationSignal, sourceCommandId, { start, end }))` — the same idle-gated standalone `compaction/* { turn: null }` bracket, cancellation mapping, and durability checkpoint as the policy form, with the range resolution inside the maintenance phase (surface reads happen after admission).

`start` and `end` are surface seqs in positional order, inclusive. A missing, reversed, or unbalanced range rejects with a plain `Error` whose message names the violated edge; busy, cancellation, changed-span, summarization, commit, and persistence failures throw `ManualCompactionError` exactly like `compactNow`, so the command's existing error table covers the range form unchanged.

### `/compact <startSeq>:<endSeq>`

`command-compact` parses the argument with a strict `^\s*(\d+)\s*:\s*(\d+)\s*$` grammar and routes to `compactRegionNow(start, end, invocation.agent, invocation.signal, invocation.commandId)`. The argument-free form is untouched; anything else is a usage error whose `USAGE` line now names both forms. A rejected range (the engine's plain `Error`) surfaces verbatim as the command's error text — the message already names the violated edge, and rewording it client-side would fork the vocabulary.

### The tab sends the same string a composer would

`ui-context` gained a `compactRange(start, end)` callback on its injected face: it calls `ctx.remote.commands.execute(sessionId, \`/compact ${start}:${end}\`, [])` and returns `null` for an admitted execution or the failure line otherwise (error strings stay English — error-surface policy). No new RPC, no new wire surface: the command path is already model-visible⟺logged and its lifecycle folds into the chat view's command node.

The interaction is anchor-based: a plain click selects and re-anchors (clearing any range); a shift-click on a surface row extends from the anchor, so ranges can grow in either direction. An anchor that a compaction refresh has dropped re-anchors on the clicked row rather than issuing a range the engine must reject. The action bar shows the inclusive span (covered row count, summed tokens — the composition's own figures, no re-estimation) with trigger/clear actions; a rejected execution keeps the range so the user can adjust and retry, an admitted one clears it and the revision-driven re-read renders the shrunken surface and the new history row.

### The fixture commits the real durable sequence

The fixture's `/compact a:b` arm writes the sequence the engine writes: a `compaction/summary` event carrying the shadowed range, token count, and writer route, then the replacement `user/message` with `surfaceOp: { op: 'replace', start, end }` and `compactCheckpointSource(compactionId, commandId)` — so the offline lane exercises the composition re-read, the surface fold's shadowing, and the checkpoint detail end to end. Range validation mirrors the positional fold (`foldSurface` order, `indexOf` endpoints). The argument-free form stays the documented fake no-op.

### Bundle purity: one whitelisted cross-plugin value import

The fixture's value import of `@deepseek-ai/dsh-compaction/checkpoint` (for `compactCheckpointSource`) needed `tsdown.client.ts`'s new `INLINE_SAFE_OUTLETS` pattern — a package-level exception beside the existing `INLINE_SAFE` allowlist. The outlet stays a types-only subpath for every other client consumer; only the fixture's dispatch path imports its runtime value.

## Alternatives considered

### Why not route the tab through `compactRegion()`?

`compactRegion` is the forced programmatic verb: no idle gate, no standalone `turn: null` manual bracket, no `sourceCommandId`, a different error vocabulary (raw throws). A human-initiated compaction needs exactly the admission and durability semantics of `compactNow` — which is why `compactRegionNow` shares `runManual`/`commitManual` rather than `commitRegion`'s body. Reusing `compactRegion` would have given the same user action two failure vocabularies and none of the queueing guarantees the queued-manual-compaction note owns.

### Why not a dedicated `contextComposition.compact` RPC?

The commands Remote already carries `/compact` across the wire, the command executor already records the `command/run`/`command/done` pair and forwards cancellation, and the chat view already folds the lifecycle into its checkpoint node. A second RPC would duplicate all three and add a wire surface to maintain; typing the range as command text keeps one admission path and exercises the same path a composer-entered `/compact` would.

### Why not pre-validate the range client-side (pairing, shadowed membership)?

The host's surface fold owns that truth; a client-side copy would drift the moment the fold learns a new rule, and the engine must validate anyway. The tab sends raw endpoints and renders the engine's rejection verbatim — the surface-invariant rule that the authoritative stream, not a derived copy, answers the question.

### Why not keep the fixture range arm a no-op like the argument-free arm?

Phase two's acceptance is the durable visible shrink: 194 rows → 192, a compaction-history row, a checkpoint detail. A no-op would render a success line while the tree stayed frozen — the composition re-read, the replace shadowing, and the checkpoint fold would all stay untested in the offline lane.

## Consequences

The seam gained a fifth verb (the abstract contract and every mock in tests grow by one method — the cost of a closed Service Definition). The command's usage text changed shape (`/compact (no arguments)` → the two-form `USAGE`), which is a user-visible string change, not a contract change. The tab's injected face grew one callback, so every `conversation.view` consumer of `ui-context`'s inject sees it (the props are explicit, not optional).

The range validation boundary is worth stating precisely: the UI never rejects a range the engine would admit, and never admits one the engine would reject — it defers entirely, so any engine-side rule change (pairing snaps, shadow membership) reaches the tab without a client change. The trade is that a user can compose a doomed range (an unbalanced edge) and learn it only on trigger; the action bar's span summary makes the attempt cheap.

## Verification

- Seam + backend: `compaction-basic` `manual-compaction.spec.ts` — the explicit-range transaction admits a balanced range, rejects a reversed range, and maps edge failures; `compaction` spec pins the abstract surface on a stub engine.
- Command: `command-compact.spec.ts` — range grammar routing (verbatim range rejection, malformed-argument usage error), command-identity forwarding, cancellation and disposal unchanged.
- Fixture: `fixture-commands.client.spec.ts` — the `/compact a:b` arm writes the summary + replace pair, emits the mux frames, and invalidates out-of-range args.
- Tab: `context-view.client.spec.tsx` — anchor/extend semantics (both directions), trigger wiring with inclusive endpoints, admission-clear vs rejection-keep, dropped-anchor re-anchor, clear action.
- Assembled lane: `apps/web/tests/context-tab.snapshot.ts` pins the range bar, the trigger, the post-compaction tree (192 surface rows, `Compaction #553` history row, `Log revision 556`), and the checkpoint detail. The golden re-queries the live `[data-context-view]` element after the trigger because the reload can remount the view body — a captured pre-compaction reference reads a detached DOM node and the snapshot would false-fail.
- `pnpm run build:lib:client` green with the `INLINE_SAFE_OUTLETS` exception; `scripts/client-bundle-purity.spec.ts` (the tsdown build-time gate's spec) still passes.

## Related

- [Context composition view (phase one)](2026-08-26-context-composition-view.md) — the read-only tab this trigger extends; its deferred-work item for phase two is retired by this note.
- [Queued manual compaction](2026-07-30-queued-manual-compaction.md) — the admission, lock, and durability semantics `compactRegionNow` shares.
