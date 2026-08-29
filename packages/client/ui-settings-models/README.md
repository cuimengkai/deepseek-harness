---
description: "Models settings and product-onboarding plugin for the dsh web client: provider rows, API-key management, model lists, and the DeepSeek first-run dialogs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-models

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-models` is the Models settings page of the dsh web client: users configure API keys (stored write-only under the profile's credential reference), edit each provider's model mapping, and hand-declare custom pi-ai routes, with stacked full-width provider cards in the cc-switch posture — one glance down the list compares providers, and each row carries its default-model switch command at the same right-edge position, with always-visible **Details** and **Duplicate** icon actions beside it. The page joins the provider directory (`llm.listProviders` with `llm.listConfigurableProviders`), the settings document, the credential descriptions, and the host model catalog (`session.modelCatalog`) into one shared snapshot, so a row's state stays consistent across all of them. The default model for future Agents is set from the same cards: one click commits a single catalog model, several open a model menu anchored to the command. It also walks first-run users through two ordered dialogs — a versioned internal-testing notice and the conditional official-DeepSeek credential step.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the Models page from the Settings navigation to see every configured provider as a stacked full-width card — one glance down the list compares providers, and each row carries its switch command at the same right-edge position with always-visible icon actions beside it. A whole-section provider whose key is not configured anywhere renders as its open setup card instead, but only in the first-run posture and only until the user closes that card. Each card kind owns its own open state, so closing one never discards a draft in another. The page keeps one dialog at a time: opening an editor or the add flow replaces the open dialog.

### API keys

The primary field on an editor card is a single **API key** input — the page never asks for an environment-variable name. A typed key stores write-only through `credentials.set` under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile has none, and the pi-ai profile records that derivation as `apiKeyEnv`, so `settings.yaml` never carries a key value. Leaving a new pi-ai provider's key blank saves a reference-free profile and preserves provider-native authentication (for example the Bedrock credential chain or Vertex ADC). A row labels API-key state with a green solid dot only when a referenced credential is confirmed configured, and with a red solid dot only when a named reference is confirmed missing. A successful Apply emits a local accessible status message without echoing secret material.

### Editing a provider

A pi-ai route's identity leads its form flat beside the key — the display name and `baseURL` — and everything else folds behind the collapsed 高级选项 area: the credential reference the key stores under, the custom User-Agent header the route's requests carry, a hand-declared route's **API protocol**, and the **model mapping** behind the endpoint field's own 管理与测试 action. A `llm-deepseek` profile customizes a shipped catalog, so its `baseURL` (placeholder showing the public endpoint) and model catalog stay in that same fold. Clearing the name unsets it and the route falls back to its id, which is what the placeholder shows; the protocol has no such fallback. A catalog route gets neither field — it defaults its name from its catalog entry, and its models each carry their own protocol, so a route-level one could only override every one of them. The Provider ID stays fixed: it is the settings key, the name every other namespace and every logged session references, and the stem of a credential reference the page cannot read back to move. Reasoning effort is deliberately not among the editable fields: it is a per-model capability, so a provider-scoped control could only be set to a value some models reject. Each DeepSeek row edits `id`, optional display `name`, and optional `contextWindow`/`maxTokens`; existing fields outside that curated set survive edits, while every other profile field stays owned by `settings.yaml`.

### Model mapping and endpoint interrogation

A pi-ai profile's `models` list is edited on the card as a fixed **model mapping**: five model roles — Sonnet, Opus, Fable, Haiku, and Subagent — plus one default fallback model, one row each, laid out as a five-column table (role, display name, request model, the fetched-model pick, the 1M declaration). Rows address entries by role, so a stored profile lands in its rows whatever order it was written in, and an entry named something else is neither shown nor dropped: the mapping manages its six rows and leaves every other entry alone. An empty mapping means "serve this route's built-in catalog"; clearing a row removes its entry, while the reset affordance hands the whole array back to the adapter. Two rows naming one model id would be a duplicate the adapter refuses, so the later row names the fault in place and the write is refused while the user is still looking at it.

**管理与测试** asks `llm.discoverModels` about the endpoint the form **currently shows**, including a base URL edited but not yet saved and a key typed but not yet stored, so adding a provider is one pass instead of save-then-return. Opening the dialog is the test request — the interrogation starts on its own — and the reply announces itself: a transient top banner reports how many models arrived and the round-trip time prints in the dialog. The reply is candidates the user picks from, never configuration written behind them: candidates already served start unchecked, and nothing is written until **Add selected**. The fetched listing is also a fact the rows keep — every candidate lands in each row's own pick menu (the chevron before the 1M declaration), and one pick fills that row with the id, the display name, the 1M declaration the candidate's own context window makes true, and every disclosed capacity — the pool survives the dialog closing without an adoption. Adoption fills the mapping's empty rows in display order — Sonnet first, the fallback last — with the role replacing the candidate's own display name, and whatever the provider disclosed riding along (a discovery that reports `inputModalities` stores them on the profile's own `input` field). A full mapping adopts nothing: the button explains itself rather than closing over a silent no-op. A provider that cannot be interrogated is a detour, not a dead end — the adapter's own message appears in the dialog, and the rows wait behind it for hand-entry.

### The default model and card management

The default model for future Agents is set from the row's own one-click command: the provider the composed `agent-default-model` selection names carries a disabled **In use** command and the brand outline, and every other usable provider carries **Set as default** as its primary card button. One catalog model commits on the click; several open a model menu anchored to the button; the write records provider and model while dropping the stored reasoning-effort override, since effort levels are per-model. The outcome lands in the page's status region. The catalog is advisory exactly as the join is: a provider whose group is missing keeps the command disabled with the reason as its title, rather than offering a free-typed id the host would refuse to resolve.

Management rides the card as always-visible icon actions beside the command. **Details** expands the card in place to the read-only facts the join already holds: endpoint, wire protocol (a pi-ai route that names one), the credential reference or its absence, and the serving model list as chips. **Duplicate** copies a providers-dict route's profile to a fresh sibling key (`<id>-copy`, then `-copy-2`, …) through one `settings.mutate`; the copy shares the source's credential reference, because a stored key is write-only and the page cannot re-store it — editing either route's key later re-points only that route. A whole-section route and any non-`providers` dict layout offer no duplicate: there is no sibling key to receive the copy.

### Adding and deleting providers

The add flow is a list tile opening one wide pick dialog over the dormant directory — a bare-mounted `llm-pi-ai` offers its whole installed catalog before any route exists. The presets flow left-to-right then top-to-bottom at their natural width above, and the configuration form continues the same container below, never a second window and never a second card; the embedded form portals its cancel/commit row into the dialog's footer so the actions stay on screen below the scrolling form. Selecting a preset prefills the form with the directory's built-in identity, and selecting another cell simply swaps the form; the dialog opens on the **custom** creation form, so declaring a route is the default. **Add a custom provider** declares a route pi-ai does not ship; the create card asks for a unique **Provider ID** (lowercase-leading, because it is also the stem of the derived credential reference), an endpoint, a protocol, and at least one uniquely-identified model, because nothing can default those. A row is deletable only when the user layer alone carries it (removal restores the composition base), and its confirmation dialog names the provider.

### First-run dialogs

After the versioned notice step completes, the DeepSeek step projects first-run readiness from the same joined snapshot. ANY provider the user can already reach ends it without rendering; only a user with none is asked for the official DeepSeek key. Configure later completes only this coordinator pass, and an absent adapter, inactive route, failed join, read-only deployment, or unusable capability completes the step without rendering — Models remains the diagnostic surface.

### Extension slots

The section declares two seats for plugins distributed outside this repository, typed in [`src/client/slot-contract.ts`](src/client/slot-contract.ts) and exported from `./client`. `settings.models.provider-card` (keyed) renders inside every card that shows a directory row — a saved row's card, its first-run setup posture, and the add-provider draft — dispatched with `entryKey = settingsNs` and owner props carrying the row's `ConfigurableProviderView`, its configured state, and its confirmed api-key credential state, so one registration under an adapter family's namespace receives every card of that family, hand-declared routes included; the hand-declared draft card has no directory row yet and dispatches nothing until saved. `settings.models.footer` (list) renders after the rows and the add controls. A registrant activates through `ctx.slots.inject` with a type-only import of this package's `/client` entry; without registrants both seats render nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page never holds a full settings section: it holds only the REDACTED descriptor, so every edit lands as `settings.mutate` path ops against the stored section — a set per changed field, an unset per cleared one, and a single unset for a deleted provider row.

### Validation

A typed API key is judged on its own field: after trimming, it must be non-empty and every character must be printable ASCII (`[\x21-\x7E]`), which is exactly what an HTTP header value can carry — the twin of `normalizeApiKey` in `@deepseek-ai/dsh-llm`, mirrored here because the source-plane split forbids importing it. A value matching a pasted `NAME=value` environment line or wrapped in matching quotes is refused as the same format failure. Empty ids, duplicate ids, empty explicit names, and unreadable, non-positive, or fractional capacities fail before any write. DeepSeek's `models` is one replace-by-value array: the editor shows inherited effective rows until the first model edit materializes the complete array in the user layer, while reset unsets that override.

### Concurrency and credentials

Each settings write carries the card's current `revision`, so a concurrent write from another tab or an external `settings.yaml` edit is refused as `settings-conflict`. After settings commit, the card adopts the returned redacted user subtree and revision before storing the credential, so a failed credential stage retries only that stage. Deletion removes a configured, writable credential only when the profile names the page's derived `<ROUTE>_API_KEY` target, then unsets the profile; both operations are idempotent. Once loaded, the page subscribes to forwarded `settings/document-updated`, `credentials/reference-updated`, and `llm/adapters-updated` owner events, plus local `connection/reset`, so external edits converge without polling.

### Onboarding coordinator

The notice step owns its exact copy in `src/client/locales.ts` and its acknowledgement version in `src/onboarding-copy.ts`; on loopback it compares and writes `ui-onboarding.welcomeNoticeVersion` through the existing settings API, and only an explicit Continue records the current version. A non-loopback browser cannot use that Host-only namespace, so acknowledgement is process-local and the notice returns after reload. The DeepSeek step renders the existing `ProviderEditor` in credential-only mode inside the shared onboarding modal; `credentials.set` stays the only secret write, and no provider settings are changed.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings base, the seams this page joins, and the design rationale.

- [ui-settings](../ui-settings/README.md) — the domain base whose scope and schema services this page builds on.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.
- [credentials](../../credentials/README.md) — the credential-reference seam this page writes keys through.
- [llm](../../llm/README.md) — the adapter registry whose providers this page configures.
- [Web config plane](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md) — the hand-written editor's design rationale.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the editor's field coverage and the page's reach; they are current package constraints, not a settings roadmap.

- **Only the API key and curated fold fields are editable on the card** — the hand-written editor traded schema-generic field coverage for the mockup layout. Retry policy, timeouts, DeepSeek model descriptions, and other advanced fields remain in `settings.yaml`; existing model fields the editor does not show are preserved.
- **Credential cleanup is intentionally narrow** — deleting a row removes the configured, writable credential only when its reference is the exact `<ROUTE>_API_KEY` target this page derives. Custom references, environment credentials, and unidentifiable targets are retained because the row cannot prove ownership of them.
- **Only pi-ai routes can be hand-declared** — the custom-provider card writes into `llm-pi-ai`, the one namespace whose profiles describe a whole provider. A `llm-deepseek` route is a composition fact, not something this page can create.
- **cc-switch's connectivity test, usage stats, and drag-reorder have no seam here** — a stored key is write-only, so no client command can authenticate a probe against a stored endpoint (`llm.discoverModels` answers a described route from the adapter registry without a network call); no wire domain reports provider usage; and providers are settings-namespace keyed with no order field to write, so the list keeps directory declaration order.
- **Interrogation covers OpenAI-compatible endpoints** — the adapter reads only that model-list response format, so a gateway speaking another protocol reports that it cannot be asked and its models are entered by hand.
- **Undeclared live routes render nowhere** — a route registered without a configurable-provider declaration has no settings address; it stays visible in pickers but not on this page's rows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
