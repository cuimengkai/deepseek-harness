# Agent Note: Per-kind model-route bindings

Status: implemented

English | [中文](2026-08-23-model-kind-route-bindings.zh.md)

## Problem

A model has both a role kind — text, image, audio, embedding — and the content it accepts (its input modalities), but nothing modeled either on an Agent's route. The wire `ModelCatalogModel` dropped `inputModalities` entirely, and routing was a single flat `(provider, model)` pair everywhere: one route per Agent, however heterogeneous the work. The flow canvas node inspector could bind one provider and model, and no place existed to say "route image work to the vision model, everything else to the fast text model".

## Decision

Three layers now carry per-kind model facts, all additive.

1. **The llm domain names model kinds.** `ModelKindMap` (`packages/llm/llm/src/types.ts`) is a merge-extensible map of the four known kinds — `text`, `image`, `audio`, `embedding` — and `LlmModelInfo.kinds?: readonly ModelKind[]` declares a model's role kinds. DeepSeek's static catalog declares `text`; an omitted `kinds` defaults to `['text']`, so existing models stay text-only without config changes.

2. **The wire projects kinds and modalities.** `ModelCatalogModel` and its Zod schema gain `kinds` and `inputModalities`; `buildModelCatalog` (`api-proxy.ts`) projects both, so the Models settings page can group and filter by kind, and the model selector can show a model's kinds beside its provider and description. The discovery adopt path keeps whatever the provider disclosed, storing `inputModalities` and `kinds` in the profile beside id, name, and capacities.

3. **Per-Agent per-kind binding.** `FlowAgentNode.agentOptions` gains optional `modelKinds?: Partial<Record<ModelKind, { provider, model }>>`. The addition is additive: the flow validator never rejects unknown fields and persistence gates on `FLOW_FORMAT_VERSION` only, so no version bump. The compiler serializes the bag into the worker's agent call; the worker runtime's `readModelKinds` validates it structurally (an object keyed by kind; each binding an object holding only `provider`/`model`, each a non-empty string, at least one field bound) and forwards it through `ChildStartRequest.modelKinds`; the host's `resolveChildAgentOptions` spreads the requested options wholesale into core `AgentOptions.modelKinds`. The flow canvas node inspector binds per-kind models through four rows (the UI enumerates the four known kinds locally, since `ModelKindMap` is merge-extensible); the store preserves the plain `provider`/`model` route while editing per-kind rows and drops empty rows and empty bags.

## Alternatives considered

- **Route per-kind at request time now** — consuming the per-kind binding is the Phase B/C follow-on: no image or audio tools exist yet, and the Dify-style orchestration that would dispatch by kind is unbuilt. Shipping the binding seam first keeps the foundation small and verifiable.
- **A `modalities` field on each binding** — the binding's job is routing by role kind, and kind and modality are different axes; input content acceptance stays the model's own `inputModalities`, not a routing concern.
- **A separate top-level agent-options key** — `modelKinds` lives inside `agentOptions` where the plain route already lives, so the compiler's existing forwarding path, the worker's supported-option set, and the host's `...requested` spread all cover it with no new plumbing.

## Consequences

- The binding is **declaration-only**: a bound per-kind route reaches core `AgentOptions.modelKinds` and persists with the flow, but no request router consumes it yet. Because it never reaches a model request, it adds no new model-visible input and requires no snapshot.
- Existing flow files load unchanged; an empty bag serializes as absent, so flows without per-kind bindings are byte-identical on the plain route.
- `AgentOptions.modelKinds` is the single seam a future per-kind router reads, so the Phase B/C work changes no existing binding surface.
