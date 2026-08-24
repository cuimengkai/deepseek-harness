# Agent Note: Composer model-kind reference selection

Status: implemented

English | [中文](2026-08-24-composer-model-kind-picker.zh.md)

## Problem

The composer's node inspector had no model surface. The session flow tab that once offered a free-typed provider/model segment was removed (the flow editor's session view retired), so the composer became the only place a per-kind route can be authored — but nothing there referenced the flow domain's binding vocabulary. Hand-typed ids drift: a provider or model typed into a text field need not exist in the deployment, while the Models settings tab already configures exactly the catalog — with per-kind roles — a composer should choose from.

## Decision

The composer's node inspector binds one model kind at a time through a `ModelKindPicker`: each kind (text, image, audio, embedding) a row pairing a provider select with a model select over the configured catalog (`api.llm.models({})` → `{ groups, failures }`) — the same models the Models settings surface configures, chosen rather than typed. A model serves a kind when its explicit `kinds` list includes it, or text by default; a kind no configured provider serves gets no row. Either side of a route may be left on the node's own default (the empty option inherits); choosing a provider clears the model bound under another one, because a route is a provider/model pair. A catalog still loading, or an unavailable host (refusal or dead transport), renders a distinct hint instead of a broken form.

The catalog is resident while a composer or design page is open: `view()` and `beginCompose()` trigger `loadModelCatalog()` (single-flight), and the same event pair the Models settings surface subscribes to — `llm/adapters-updated` and `settings/document-updated` — refreshes it, gated on an overlay being open. Closing the composer or view, or confirming a save, drops the catalog. `updateAgentModelKind(nodeId, kind, field, value)` mutates the draft graph via `setAgentModelKind`, so a route edit wakes Save exactly like a row or layout edit (the dirty check compares per-node `agentOptions`). Persistence is free: `modelKinds` ride the graph node's `agentOptions`, saved to `agent.flow.json` beside the rows. The read-only design page shows the same routes as text. The picker adds no dependency — it consumes the existing `dsh-api-remotes/client` face.

## Alternatives considered

- **Keep the free-typed provider/model input** (what the removed session flow editor offered) — rejected: a hand-typed id need not resolve against the deployment, and the Models settings tab already owns the catalog with per-kind roles; referencing it keeps the composer from drifting from what is configured.
- **Reuse the session flow editor's inspector segment** — rejected: that editor and its model segment retired with the session view, and its input was free text, not a catalog reference.
- **Load the catalog once when the composer opens and never refresh** — rejected: adapter topology and settings documents both feed the catalog, and a stale list would let the user select a provider or model the deployment just removed; the resident refresh matches the Models surface's own contract.
- **Route requests by kind now** — deferred, not chosen: `modelKinds` stays declaration-only until request routing consumes kinds (a Phase B/C follow-on); this change authors and carries the binding so a later routing slice has it.

## Consequences

- The picker surfaces the configured catalog, so a route is always one the deployment can serve; a refused or dead host degrades to a hint, never a broken form.
- A bound kind is carried, not routed: it rides in `agent.flow.json` across a normal save, but a layout regeneration from rows (`rowsToGraph`) rebuilds nodes without `agentOptions`, so a hand edit that outdates the layout drops the routes (README Known Limitations).
- The composer is now the home of per-kind model authoring after the session flow tab's removal; the design page reads the same routes as text.
- Tests pin the mutations (bind/preserve/clear/inherit), the catalog states (ready/refusal/dead transport/single-flight), the event-driven refresh, and the read-only render; the save path carries `modelKinds` through the wire.
