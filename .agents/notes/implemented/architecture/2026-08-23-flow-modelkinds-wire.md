# Agent Note: Per-kind model bindings survive the flow wire

Status: implemented

English | [中文](2026-08-23-flow-modelkinds-wire.zh.md)

## Problem

The flow canvas node inspector sends per-kind model routes (`agentOptions.modelKinds`) on every graph-carrying `flow.*` call, but `flowAgentNodeSchema` (`packages/host/apiproxy/src/api/flow.schema.ts`) declared only `provider`/`model` under `agentOptions`. Zod object schemas drop unknown keys by default, so the per-kind binding was silently stripped on save and never appeared in run, get, or list read-back — the client believed it persisted a route the engine never received.

## Decision

`flowAgentNodeSchema` now declares `modelKinds: z.record(z.string(), z.object({ provider: z.string().optional(), model: z.string().optional() })).optional()` and the anchored `satisfies z.ZodType<Wire<...>>` type gains the matching `Record<string, { provider?, model? }>`. Keys are arbitrary strings because the wire does not know the merge-extensible `ModelKindMap`; the record value schema rejects a malformed binding instead of dropping it. Because save, run, get, and list all share `flowGraphSchema`, this one schema edit fixes the whole surface.

## Alternatives considered

- **Finite enum of `ModelKind`** — `ModelKindMap` is merge-extensible by design, so a closed `z.enum` would reject future kinds and force a wire change per kind addition; arbitrary string keys keep the wire open while the value schema still validates shape.
- **Silently drop (status quo)** — the defect was exactly the silent strip; a `z.record` value schema refuses a malformed binding at the boundary instead of losing it on save.
- **`Record<string, unknown>` value** — loses the provider/model-string validation that the anchored `satisfies z.ZodType<Wire<...>>` type promises; the record value schema keeps runtime and type aligned.
- **Bump `FLOW_FORMAT_VERSION`** — the field is additive and that constant gates persistence only, so no format bump is warranted.

## Consequences

- Per-kind routes round-trip verbatim; a binding that is not an object of provider/model strings is refused at the wire boundary rather than silently dropped.
- No version bump: the field is additive and `FLOW_FORMAT_VERSION` gates persistence only.
